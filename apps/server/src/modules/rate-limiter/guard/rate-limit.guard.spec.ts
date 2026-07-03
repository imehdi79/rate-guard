import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { RateLimitGuard } from './rate-limit.guard';
import { RateLimiterService } from '../rate-limiter.service';
import { DatabaseService } from '../../../database/database.service';
import {
  DEFAULT_RATE_LIMIT,
  DEFAULT_WINDOW_MS,
} from '../rate-limiter.constants';

describe('RateLimitGuard', () => {
  const NOW = 1_700_000_000_000;
  const RESET_AT = NOW + 42_000;

  let guard: RateLimitGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let rateLimiter: { consume: jest.Mock };
  let db: {
    quotaConfigs: { findUnique: jest.Mock };
    violationLog: { createMany: jest.Mock };
  };

  const tenant = {
    id: 'tenant-1',
    quotaConfigs: { max_requests: 5, window_seconds: 30 },
  };

  interface HttpMocks {
    req: Record<string, unknown>;
    res: { setHeader: jest.Mock };
    ctx: ExecutionContext;
  }

  const createContext = (reqOverrides: Record<string, unknown>): HttpMocks => {
    const req = { headers: {}, path: '/api/data', ...reqOverrides };
    const res = { setHeader: jest.fn() };
    const ctx = {
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
    } as unknown as ExecutionContext;
    return { req, res, ctx };
  };

  beforeEach(async () => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);

    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    rateLimiter = {
      consume: jest
        .fn()
        .mockResolvedValue({ allowed: true, remaining: 4, resetAt: RESET_AT }),
    };
    db = {
      quotaConfigs: { findUnique: jest.fn().mockResolvedValue(null) },
      violationLog: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RateLimitGuard,
        { provide: Reflector, useValue: reflector },
        { provide: RateLimiterService, useValue: rateLimiter },
        { provide: DatabaseService, useValue: db },
      ],
    }).compile();

    guard = moduleRef.get(RateLimitGuard);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('bypasses public routes without touching the limiter', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const { ctx } = createContext({ tenant });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(rateLimiter.consume).not.toHaveBeenCalled();
  });

  it('allows requests without a tenant — rejecting them is the auth guard job', async () => {
    const { ctx } = createContext({});

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(rateLimiter.consume).not.toHaveBeenCalled();
  });

  it('consumes with the tenant quota config attached by the auth guard', async () => {
    const { ctx } = createContext({ tenant });

    await guard.canActivate(ctx);

    expect(rateLimiter.consume).toHaveBeenCalledWith('tenant-1', 5, 30_000);
    expect(db.quotaConfigs.findUnique).not.toHaveBeenCalled();
  });

  it('looks the quota up in the database when the tenant lacks it', async () => {
    db.quotaConfigs.findUnique.mockResolvedValue({
      max_requests: 7,
      window_seconds: 10,
    });
    const { ctx } = createContext({ tenant: { id: 'tenant-1' } });

    await guard.canActivate(ctx);

    expect(db.quotaConfigs.findUnique).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1' },
    });
    expect(rateLimiter.consume).toHaveBeenCalledWith('tenant-1', 7, 10_000);
  });

  it('falls back to the default quota when no config exists', async () => {
    const { ctx } = createContext({
      tenant: { id: 'tenant-1', quotaConfigs: null },
    });

    await guard.canActivate(ctx);

    expect(rateLimiter.consume).toHaveBeenCalledWith(
      'tenant-1',
      DEFAULT_RATE_LIMIT,
      DEFAULT_WINDOW_MS,
    );
  });

  it('sets the X-RateLimit headers on allowed requests', async () => {
    const { ctx, res } = createContext({ tenant });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);

    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 5);
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 4);
    expect(res.setHeader).toHaveBeenCalledWith(
      'X-RateLimit-Reset',
      Math.ceil(RESET_AT / 1000),
    );
  });

  describe('when the limit is exceeded', () => {
    beforeEach(() => {
      rateLimiter.consume.mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: RESET_AT,
      });
    });

    it('throws 429 with a Retry-After header', async () => {
      const { ctx, res } = createContext({ tenant });

      await expect(guard.canActivate(ctx)).rejects.toMatchObject({
        status: HttpStatus.TOO_MANY_REQUESTS,
      });
      await expect(
        guard.canActivate(createContext({ tenant }).ctx),
      ).rejects.toBeInstanceOf(HttpException);

      // 42s until resetAt, rounded up
      expect(res.setHeader).toHaveBeenCalledWith('Retry-After', 42);
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 0);
    });

    it('logs the violation idempotently, keyed on the caller request id', async () => {
      const { ctx } = createContext({
        tenant,
        headers: { 'x-request-id': 'req-123' },
        path: '/api/orders',
      });

      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        HttpException,
      );

      expect(db.violationLog.createMany).toHaveBeenCalledWith({
        data: [
          {
            tenantId: 'tenant-1',
            request_id: 'req-123',
            path: '/api/orders',
          },
        ],
        skipDuplicates: true,
      });
    });

    it('generates a request id when the caller sent none', async () => {
      const { ctx } = createContext({ tenant });

      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        HttpException,
      );

      expect(db.violationLog.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ request_id: expect.any(String) })],
        skipDuplicates: true,
      });
    });

    it('still returns 429 when writing the violation log fails', async () => {
      db.violationLog.createMany.mockRejectedValue(
        new Error('connection lost'),
      );
      const { ctx } = createContext({ tenant });

      await expect(guard.canActivate(ctx)).rejects.toMatchObject({
        status: HttpStatus.TOO_MANY_REQUESTS,
      });
    });
  });
});
