import { Test } from '@nestjs/testing';
import {
  TENANT_CACHE_PREFIX,
  TENANT_CACHE_TTL_SECONDS,
  TenantConfigService,
} from './tenant-config.service';
import { DatabaseService } from '../../database/database.service';
import { RedisService } from '../../redis/redis.service';

describe('TenantConfigService', () => {
  const tenant = {
    id: 'tenant-1',
    name: 'acme',
    api_key: 'rk_secret',
    quotaConfigs: { max_requests: 5, window_seconds: 30 },
  };

  let service: TenantConfigService;
  let redis: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
  let db: { tenant: { findFirst: jest.Mock } };

  beforeEach(async () => {
    redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
    };
    db = { tenant: { findFirst: jest.fn().mockResolvedValue(tenant) } };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantConfigService,
        { provide: RedisService, useValue: redis },
        { provide: DatabaseService, useValue: db },
      ],
    }).compile();

    service = moduleRef.get(TenantConfigService);
  });

  it('serves a cached tenant without touching the database', async () => {
    redis.get.mockResolvedValue(JSON.stringify(tenant));

    await expect(service.findByApiKey('rk_secret')).resolves.toEqual(tenant);

    expect(redis.get).toHaveBeenCalledWith(`${TENANT_CACHE_PREFIX}rk_secret`);
    expect(db.tenant.findFirst).not.toHaveBeenCalled();
  });

  it('falls back to the database on a miss and caches the result with a TTL', async () => {
    await expect(service.findByApiKey('rk_secret')).resolves.toEqual(tenant);

    expect(db.tenant.findFirst).toHaveBeenCalledWith({
      where: { api_key: 'rk_secret' },
      include: { quotaConfigs: true },
    });
    expect(redis.set).toHaveBeenCalledWith(
      `${TENANT_CACHE_PREFIX}rk_secret`,
      JSON.stringify(tenant),
      TENANT_CACHE_TTL_SECONDS,
    );
  });

  it('does not cache unknown api keys', async () => {
    db.tenant.findFirst.mockResolvedValue(null);

    await expect(service.findByApiKey('rk_wrong')).resolves.toBeNull();

    expect(redis.set).not.toHaveBeenCalled();
  });

  it('degrades to a database lookup when Redis reads fail', async () => {
    redis.get.mockRejectedValue(new Error('redis down'));

    await expect(service.findByApiKey('rk_secret')).resolves.toEqual(tenant);
    expect(db.tenant.findFirst).toHaveBeenCalled();
  });

  it('invalidates the cache entry for an api key', async () => {
    await service.invalidate('rk_secret');

    expect(redis.del).toHaveBeenCalledWith(`${TENANT_CACHE_PREFIX}rk_secret`);
  });

  it('swallows Redis errors during invalidation (TTL bounds staleness)', async () => {
    redis.del.mockRejectedValue(new Error('redis down'));

    await expect(service.invalidate('rk_secret')).resolves.toBeUndefined();
  });
});
