import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { DatabaseService } from '../../database/database.service';
import { TenantConfigService } from '../auth/tenant-config.service';
import { RateLimiterService } from '../rate-limiter/rate-limiter.service';
import {
  DEFAULT_RATE_LIMIT,
  DEFAULT_WINDOW_MS,
} from '../rate-limiter/rate-limiter.constants';

const VIOLATION_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const RECENT_VIOLATIONS_LIMIT = 20;

export interface QuotaUpdateDto {
  max_requests?: unknown;
  window_seconds?: unknown;
}

@Injectable()
export class AdminService {
  constructor(
    private readonly db: DatabaseService,
    private readonly tenants: TenantConfigService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  listTenants() {
    // api_key deliberately not selected: it is shown exactly once, in the
    // create response.
    return this.db.tenant.findMany({
      select: {
        id: true,
        name: true,
        created_at: true,
        quotaConfigs: {
          select: { max_requests: true, window_seconds: true },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async createTenant(name: unknown) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new BadRequestException('name is required');
    }

    try {
      // The only response that ever contains the api key — store it now.
      return await this.db.tenant.create({
        data: {
          name: name.trim(),
          api_key: `rk_${randomBytes(24).toString('hex')}`,
        },
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException(`tenant '${name.trim()}' already exists`);
      }
      throw error;
    }
  }

  async getQuota(tenantId: string) {
    const tenant = await this.db.tenant.findUnique({
      where: { id: tenantId },
      include: { quotaConfigs: true },
    });
    if (!tenant) {
      throw new NotFoundException(`tenant ${tenantId} not found`);
    }

    return {
      tenantId,
      max_requests: tenant.quotaConfigs?.max_requests ?? DEFAULT_RATE_LIMIT,
      window_seconds:
        tenant.quotaConfigs?.window_seconds ?? DEFAULT_WINDOW_MS / 1000,
      configured: tenant.quotaConfigs !== null,
    };
  }

  /** Live snapshot for the dashboard: window usage plus violation history. */
  async getStats(tenantId: string) {
    const tenant = await this.db.tenant.findUnique({
      where: { id: tenantId },
      include: { quotaConfigs: true },
    });
    if (!tenant) {
      throw new NotFoundException(`tenant ${tenantId} not found`);
    }

    const max_requests = tenant.quotaConfigs?.max_requests ?? DEFAULT_RATE_LIMIT;
    const window_seconds =
      tenant.quotaConfigs?.window_seconds ?? DEFAULT_WINDOW_MS / 1000;
    const since = new Date(Date.now() - VIOLATION_LOOKBACK_MS);

    const [current, last24h, recent] = await Promise.all([
      // Reads the same sorted set the Lua script maintains, without
      // consuming quota — the dashboard poll must not count as traffic.
      this.rateLimiter.currentUsage(tenantId, window_seconds * 1000),
      this.db.violationLog.count({
        where: { tenantId, created_at: { gte: since } },
      }),
      this.db.violationLog.findMany({
        where: { tenantId },
        orderBy: { created_at: 'desc' },
        take: RECENT_VIOLATIONS_LIMIT,
        select: { id: true, request_id: true, path: true, created_at: true },
      }),
    ]);

    return {
      tenantId,
      name: tenant.name,
      quota: {
        max_requests,
        window_seconds,
        configured: tenant.quotaConfigs !== null,
      },
      usage: {
        current,
        remaining: Math.max(0, max_requests - current),
      },
      violations: {
        last_24h: last24h,
        recent,
      },
    };
  }

  async updateQuota(tenantId: string, dto: QuotaUpdateDto) {
    const max_requests = requirePositiveInt(dto?.max_requests, 'max_requests');
    const window_seconds = requirePositiveInt(
      dto?.window_seconds,
      'window_seconds',
    );

    const tenant = await this.db.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) {
      throw new NotFoundException(`tenant ${tenantId} not found`);
    }

    const quota = await this.db.quotaConfigs.upsert({
      where: { tenantId },
      update: { max_requests, window_seconds },
      create: { tenantId, max_requests, window_seconds },
    });

    // Drop the cached config so the new limit applies to the very next
    // request instead of after the cache TTL.
    await this.tenants.invalidate(tenant.api_key);

    return {
      tenantId,
      max_requests: quota.max_requests,
      window_seconds: quota.window_seconds,
      configured: true,
    };
  }
}

function requirePositiveInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new BadRequestException(`${field} must be a positive integer`);
  }
  return value;
}
