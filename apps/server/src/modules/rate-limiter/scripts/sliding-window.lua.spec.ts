import { readFileSync } from 'fs';
import RedisMock from 'ioredis-mock';
import { SLIDING_WINDOW_SCRIPT_PATH } from '../rate-limiter.constants';

/**
 * Executes the real Lua script against ioredis-mock (fengari-based Lua VM),
 * so the sliding window logic itself is under test — no Redis server needed.
 * The mock backs TIME with the JS clock; jest fake timers pin it, and
 * jest.setSystemTime() slides the window without real waiting. TIME has
 * second granularity, so all offsets are whole seconds.
 */
describe('sliding-window.lua', () => {
  const script = readFileSync(SLIDING_WINDOW_SCRIPT_PATH, 'utf8');
  const KEY = 'rate-limit:lua-spec';
  const START = 1_700_000_000_000;

  let redis: InstanceType<typeof RedisMock>;
  let seq: number;

  const run = async (
    limit: number,
    windowMs: number,
  ): Promise<[number, number, number]> =>
    (await redis.eval(
      script,
      1,
      KEY,
      limit,
      windowMs,
      `member-${seq++}`,
    )) as [number, number, number];

  beforeEach(async () => {
    jest.useFakeTimers({ now: START });
    // ioredis-mock instances with identical connection options share one
    // data store — flush it so tests cannot pollute each other.
    redis = new RedisMock();
    await redis.flushall();
    seq = 0;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('allows requests up to the limit with a decreasing remaining count', async () => {
    await expect(run(3, 10_000)).resolves.toEqual([1, 2, START + 10_000]);
    await expect(run(3, 10_000)).resolves.toEqual([1, 1, START + 10_000]);
    await expect(run(3, 10_000)).resolves.toEqual([1, 0, START + 10_000]);
  });

  it('denies the request after the limit is reached', async () => {
    for (let i = 0; i < 3; i++) {
      await run(3, 10_000);
    }

    const [allowed, remaining, resetAt] = await run(3, 10_000);

    expect(allowed).toBe(0);
    expect(remaining).toBe(0);
    // Slot frees when the oldest request (made at START) leaves the window.
    expect(resetAt).toBe(START + 10_000);
  });

  it('does not let denied requests consume quota', async () => {
    await run(1, 10_000);

    // Hammer while blocked: every attempt is denied...
    for (let i = 0; i < 5; i++) {
      expect((await run(1, 10_000))[0]).toBe(0);
    }

    // ...and none of them extended the block: the moment the original
    // request ages out (inclusive boundary), the next one is allowed.
    jest.setSystemTime(START + 10_000);
    expect((await run(1, 10_000))[0]).toBe(1);
  });

  it('slides the window instead of resetting it in fixed steps', async () => {
    await run(2, 10_000); // t = 0
    jest.setSystemTime(START + 6_000);
    await run(2, 10_000); // t = 6s — window full

    // t = 8s: first request still in window — denied.
    jest.setSystemTime(START + 8_000);
    const denied = await run(2, 10_000);
    expect(denied[0]).toBe(0);
    // reset_at points at the oldest entry (t=0) leaving the window.
    expect(denied[2]).toBe(START + 10_000);

    // t = 11s: the t=0 request slid out, one slot free — allowed.
    jest.setSystemTime(START + 11_000);
    const allowed = await run(2, 10_000);
    expect(allowed[0]).toBe(1);
    expect(allowed[1]).toBe(0);
    // Now the oldest is the t=6s request.
    expect(allowed[2]).toBe(START + 6_000 + 10_000);
  });

  it('counts concurrent same-millisecond requests individually', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => run(5, 10_000)),
    );

    const allowedCount = results.filter(([allowed]) => allowed === 1).length;
    expect(allowedCount).toBe(5);
  });

  it('expires the key with the window so idle tenants leak nothing', async () => {
    await run(3, 10_000);

    const ttl = await redis.pttl(KEY);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(10_000);
  });
});
