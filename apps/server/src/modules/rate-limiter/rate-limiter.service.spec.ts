import { Test } from '@nestjs/testing';
import { readFileSync } from 'fs';
import { RateLimiterService } from './rate-limiter.service';
import {
  DEFAULT_RATE_LIMIT,
  DEFAULT_WINDOW_MS,
  RATE_LIMIT_KEY_PREFIX,
  SLIDING_WINDOW_SCRIPT_PATH,
} from './rate-limiter.constants';

describe('RateLimiterService', () => {
  let service: RateLimiterService;
  let redis: { script: jest.Mock; evalsha: jest.Mock };

  beforeEach(async () => {
    redis = {
      script: jest.fn().mockResolvedValue('sha-abc'),
      evalsha: jest.fn().mockResolvedValue([1, 9, 1_700_000_060_000]),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RateLimiterService,
        { provide: 'REDIS_CLIENT', useValue: redis },
      ],
    }).compile();

    service = moduleRef.get(RateLimiterService);
  });

  it('loads the sliding window script into Redis on module init', async () => {
    await service.onModuleInit();

    const source = readFileSync(SLIDING_WINDOW_SCRIPT_PATH, 'utf8');
    expect(redis.script).toHaveBeenCalledWith('LOAD', source);
  });

  it('survives module init when Redis is unreachable', async () => {
    redis.script.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });

  it('runs the script with the prefixed key, limit, window and a member', async () => {
    await service.onModuleInit();

    await service.consume('tenant-1', 10, 30_000);

    expect(redis.evalsha).toHaveBeenCalledWith(
      'sha-abc',
      1,
      `${RATE_LIMIT_KEY_PREFIX}tenant-1`,
      10,
      30_000,
      expect.any(String),
    );
  });

  it('falls back to the default quota and window', async () => {
    await service.onModuleInit();

    await service.consume('tenant-1');

    expect(redis.evalsha).toHaveBeenCalledWith(
      'sha-abc',
      1,
      `${RATE_LIMIT_KEY_PREFIX}tenant-1`,
      DEFAULT_RATE_LIMIT,
      DEFAULT_WINDOW_MS,
      expect.any(String),
    );
  });

  it('sends a distinct member per request so same-ms requests all count', async () => {
    await service.onModuleInit();

    await service.consume('tenant-1');
    await service.consume('tenant-1');

    const memberOf = (call: unknown[]) => call[call.length - 1];
    expect(memberOf(redis.evalsha.mock.calls[0])).not.toEqual(
      memberOf(redis.evalsha.mock.calls[1]),
    );
  });

  it('maps an allowed reply', async () => {
    redis.evalsha.mockResolvedValueOnce([1, 4, 1_700_000_060_000]);

    await expect(service.consume('tenant-1', 5)).resolves.toEqual({
      allowed: true,
      remaining: 4,
      resetAt: 1_700_000_060_000,
    });
  });

  it('maps a denied reply', async () => {
    redis.evalsha.mockResolvedValueOnce([0, 0, 1_700_000_090_000]);

    await expect(service.consume('tenant-1', 5)).resolves.toEqual({
      allowed: false,
      remaining: 0,
      resetAt: 1_700_000_090_000,
    });
  });

  it('loads the script lazily when init could not reach Redis', async () => {
    // onModuleInit never ran; the first consume must load the script itself.
    await service.consume('tenant-1');

    expect(redis.script).toHaveBeenCalledTimes(1);
    expect(redis.evalsha).toHaveBeenCalledTimes(1);
  });

  it('reloads and retries once when Redis lost the script cache', async () => {
    await service.onModuleInit();
    redis.evalsha
      .mockRejectedValueOnce(
        new Error('NOSCRIPT No matching script. Please use EVAL.'),
      )
      .mockResolvedValueOnce([0, 0, 1_700_000_090_000]);

    const result = await service.consume('tenant-1');

    expect(redis.script).toHaveBeenCalledTimes(2);
    expect(redis.evalsha).toHaveBeenCalledTimes(2);
    expect(result.allowed).toBe(false);
  });

  it('rethrows errors other than NOSCRIPT', async () => {
    await service.onModuleInit();
    redis.evalsha.mockRejectedValueOnce(new Error('READONLY replica'));

    await expect(service.consume('tenant-1')).rejects.toThrow(
      'READONLY replica',
    );
    expect(redis.evalsha).toHaveBeenCalledTimes(1);
  });
});
