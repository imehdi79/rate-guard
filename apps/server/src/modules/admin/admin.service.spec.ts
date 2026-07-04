import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AdminService } from './admin.service';
import { DatabaseService } from '../../database/database.service';
import { TenantConfigService } from '../auth/tenant-config.service';
import {
  DEFAULT_RATE_LIMIT,
  DEFAULT_WINDOW_MS,
} from '../rate-limiter/rate-limiter.constants';

describe('AdminService', () => {
  const tenant = { id: 'tenant-1', name: 'acme', api_key: 'rk_secret' };

  let service: AdminService;
  let db: {
    tenant: { findMany: jest.Mock; findUnique: jest.Mock; create: jest.Mock };
    quotaConfigs: { upsert: jest.Mock };
  };
  let tenants: { invalidate: jest.Mock };

  beforeEach(async () => {
    db = {
      tenant: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(tenant),
        create: jest.fn().mockResolvedValue(tenant),
      },
      quotaConfigs: {
        upsert: jest
          .fn()
          .mockResolvedValue({ max_requests: 9, window_seconds: 30 }),
      },
    };
    tenants = { invalidate: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: DatabaseService, useValue: db },
        { provide: TenantConfigService, useValue: tenants },
      ],
    }).compile();

    service = moduleRef.get(AdminService);
  });

  describe('listTenants', () => {
    it('never selects api keys', async () => {
      await service.listTenants();

      const select = db.tenant.findMany.mock.calls[0][0].select;
      expect(select.api_key).toBeUndefined();
      expect(select.id).toBe(true);
    });
  });

  describe('createTenant', () => {
    it('creates a tenant with a generated rk_ api key', async () => {
      await service.createTenant('  acme  ');

      const data = db.tenant.create.mock.calls[0][0].data;
      expect(data.name).toBe('acme');
      expect(data.api_key).toMatch(/^rk_[0-9a-f]{48}$/);
    });

    it('rejects a missing or blank name', async () => {
      await expect(service.createTenant(undefined)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.createTenant('   ')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('maps the unique-name violation to 409', async () => {
      db.tenant.create.mockRejectedValue(
        Object.assign(new Error('unique'), { code: 'P2002' }),
      );

      await expect(service.createTenant('acme')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('getQuota', () => {
    it('returns 404 for an unknown tenant', async () => {
      db.tenant.findUnique.mockResolvedValue(null);

      await expect(service.getQuota('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('reports defaults when no quota is configured', async () => {
      db.tenant.findUnique.mockResolvedValue({ ...tenant, quotaConfigs: null });

      await expect(service.getQuota('tenant-1')).resolves.toEqual({
        tenantId: 'tenant-1',
        max_requests: DEFAULT_RATE_LIMIT,
        window_seconds: DEFAULT_WINDOW_MS / 1000,
        configured: false,
      });
    });

    it('reports the configured quota', async () => {
      db.tenant.findUnique.mockResolvedValue({
        ...tenant,
        quotaConfigs: { max_requests: 9, window_seconds: 30 },
      });

      await expect(service.getQuota('tenant-1')).resolves.toMatchObject({
        max_requests: 9,
        window_seconds: 30,
        configured: true,
      });
    });
  });

  describe('updateQuota', () => {
    const dto = { max_requests: 9, window_seconds: 30 };

    it('rejects non-positive or non-integer values', async () => {
      for (const bad of [
        { max_requests: 0, window_seconds: 30 },
        { max_requests: 9, window_seconds: -1 },
        { max_requests: 1.5, window_seconds: 30 },
        { max_requests: '9', window_seconds: 30 },
        {},
      ]) {
        await expect(
          service.updateQuota('tenant-1', bad as never),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
      expect(db.quotaConfigs.upsert).not.toHaveBeenCalled();
    });

    it('returns 404 for an unknown tenant', async () => {
      db.tenant.findUnique.mockResolvedValue(null);

      await expect(service.updateQuota('nope', dto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('upserts the quota config', async () => {
      await service.updateQuota('tenant-1', dto);

      expect(db.quotaConfigs.upsert).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
        update: { max_requests: 9, window_seconds: 30 },
        create: { tenantId: 'tenant-1', max_requests: 9, window_seconds: 30 },
      });
    });

    it('invalidates the tenant config cache so the change is immediate', async () => {
      await service.updateQuota('tenant-1', dto);

      expect(tenants.invalidate).toHaveBeenCalledWith('rk_secret');
    });
  });
});
