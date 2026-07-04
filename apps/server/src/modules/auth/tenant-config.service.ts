import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { RedisService } from '../../redis/redis.service';

export const TENANT_CACHE_PREFIX = 'tenant-config:';
export const TENANT_CACHE_TTL_SECONDS = 60;

export interface TenantConfig {
  id: string;
  name: string;
  api_key: string;
  quotaConfigs: { max_requests: number; window_seconds: number } | null;
}

/**
 * Tenant lookup by api key, cached in Redis so the request hot path
 * (auth + rate limit) normally skips Postgres. Cache entries expire after
 * TENANT_CACHE_TTL_SECONDS and are dropped eagerly via invalidate() when
 * the admin API changes a tenant's quota, so new limits apply immediately.
 * Redis failures degrade to plain database lookups, never to errors.
 */
@Injectable()
export class TenantConfigService {
  private readonly logger = new Logger(TenantConfigService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
  ) {}

  async findByApiKey(apiKey: string): Promise<TenantConfig | null> {
    const cacheKey = this.cacheKey(apiKey);

    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as TenantConfig;
      }
    } catch (error) {
      this.logger.warn(`Tenant cache read failed: ${error}`);
    }

    const tenant = await this.db.tenant.findFirst({
      where: { api_key: apiKey },
      include: { quotaConfigs: true },
    });
    if (!tenant) {
      return null;
    }

    try {
      await this.redis.set(
        cacheKey,
        JSON.stringify(tenant),
        TENANT_CACHE_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn(`Tenant cache write failed: ${error}`);
    }

    return tenant;
  }

  /** Drop the cached record so config changes take effect immediately. */
  async invalidate(apiKey: string): Promise<void> {
    try {
      await this.redis.del(this.cacheKey(apiKey));
    } catch (error) {
      // The TTL still bounds staleness if the eager drop fails.
      this.logger.warn(`Tenant cache invalidation failed: ${error}`);
    }
  }

  private cacheKey(apiKey: string): string {
    return `${TENANT_CACHE_PREFIX}${apiKey}`;
  }
}
