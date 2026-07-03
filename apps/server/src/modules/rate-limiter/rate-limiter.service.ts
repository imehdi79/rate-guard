import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import Redis from 'ioredis';
import {
  DEFAULT_RATE_LIMIT,
  DEFAULT_WINDOW_MS,
  RATE_LIMIT_KEY_PREFIX,
  SLIDING_WINDOW_SCRIPT_PATH,
} from './rate-limiter.constants';

export interface RateLimitResult {
  allowed: boolean;
  /** Requests still available inside the current window. */
  remaining: number;
  /** Unix ms when the oldest counted request leaves the window. */
  resetAt: number;
}

/** Reply shape of scripts/sliding-window.lua. */
type SlidingWindowReply = [allowed: 0 | 1, remaining: number, resetAt: number];

@Injectable()
export class RateLimiterService implements OnModuleInit {
  private readonly logger = new Logger(RateLimiterService.name);
  private readonly script = readFileSync(SLIDING_WINDOW_SCRIPT_PATH, 'utf8');
  private scriptSha: string | null = null;

  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.loadScript();
    } catch (error) {
      // Redis may still be connecting during bootstrap; consume() loads
      // the script lazily on first use instead of failing the app start.
      this.logger.warn(`Could not preload sliding window script: ${error}`);
    }
  }

  /**
   * Registers one request for `identifier` and reports whether it fits the
   * quota. Atomic on the Redis side (single EVALSHA), so concurrent requests
   * cannot race each other past the limit.
   */
  async consume(
    identifier: string,
    limit: number = DEFAULT_RATE_LIMIT,
    windowMs: number = DEFAULT_WINDOW_MS,
  ): Promise<RateLimitResult> {
    const key = `${RATE_LIMIT_KEY_PREFIX}${identifier}`;
    // Unique member so requests landing on the same millisecond all count.
    const member = randomUUID();
    const sha = this.scriptSha ?? (await this.loadScript());

    let reply: SlidingWindowReply;
    try {
      reply = (await this.redis.evalsha(
        sha,
        1,
        key,
        limit,
        windowMs,
        member,
      )) as SlidingWindowReply;
    } catch (error) {
      if (!isNoScriptError(error)) {
        throw error;
      }
      // A Redis restart flushes the script cache; reload and retry once.
      const reloadedSha = await this.loadScript();
      reply = (await this.redis.evalsha(
        reloadedSha,
        1,
        key,
        limit,
        windowMs,
        member,
      )) as SlidingWindowReply;
    }

    const [allowed, remaining, resetAt] = reply;
    return { allowed: allowed === 1, remaining, resetAt };
  }

  private async loadScript(): Promise<string> {
    const sha = (await this.redis.script('LOAD', this.script)) as string;
    this.scriptSha = sha;
    return sha;
  }
}

function isNoScriptError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('NOSCRIPT');
}
