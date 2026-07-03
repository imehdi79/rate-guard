import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { PUBLIC_KEY } from '../../auth/decorator/auth.decorator';
import { DatabaseService } from '../../../database/database.service';
import { RateLimiterService } from '../rate-limiter.service';
import {
  DEFAULT_RATE_LIMIT,
  DEFAULT_WINDOW_MS,
} from '../rate-limiter.constants';

/**
 * Shape the AuthGuard attaches to the request. quotaConfigs is eagerly
 * included there; `undefined` means the tenant was attached without it
 * (e.g. guard used standalone) and triggers a lookup here instead.
 */
interface RateLimitedTenant {
  id: string;
  quotaConfigs?: { max_requests: number; window_seconds: number } | null;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimiter: RateLimiterService,
    private readonly db: DatabaseService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // Public routes carry no tenant identity, so there is nothing to limit.
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const req = ctx.switchToHttp().getRequest();
    const res = ctx.switchToHttp().getResponse();

    const tenant: RateLimitedTenant | undefined = req.tenant;
    if (!tenant) {
      // No tenant attached — rejecting unauthenticated requests is the
      // AuthGuard's decision, not ours.
      return true;
    }

    const quota =
      tenant.quotaConfigs !== undefined
        ? tenant.quotaConfigs
        : await this.db.quotaConfigs.findUnique({
            where: { tenantId: tenant.id },
          });
    const limit = quota?.max_requests ?? DEFAULT_RATE_LIMIT;
    const windowMs = quota ? quota.window_seconds * 1000 : DEFAULT_WINDOW_MS;

    const result = await this.rateLimiter.consume(tenant.id, limit, windowMs);

    // Quota headers go on every response, allowed or denied.
    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000));

    if (result.allowed) {
      return true;
    }

    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((result.resetAt - Date.now()) / 1000),
    );
    res.setHeader('Retry-After', retryAfterSeconds);

    await this.logViolation(tenant.id, req);

    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Rate limit exceeded',
        retryAfter: retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private async logViolation(
    tenantId: string,
    req: { headers: Record<string, unknown>; path?: string; url?: string },
  ): Promise<void> {
    // Reuse the caller's request id when provided, so retries of the same
    // request cannot produce duplicate rows (request_id is unique).
    const header = req.headers['x-request-id'];
    const requestId =
      (Array.isArray(header) ? header[0] : (header as string | undefined)) ??
      randomUUID();

    try {
      // skipDuplicates makes this INSERT ... ON CONFLICT DO NOTHING on
      // request_id — the idempotent insert.
      await this.db.violationLog.createMany({
        data: [
          {
            tenantId,
            request_id: requestId,
            path: req.path ?? req.url ?? '',
          },
        ],
        skipDuplicates: true,
      });
    } catch (error) {
      // Losing an audit row must not turn a 429 into a 500.
      this.logger.error(`Failed to log rate limit violation: ${error}`);
    }
  }
}
