import axios, { type AxiosResponse } from 'axios';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { Client } from 'pg';

/**
 * End-to-end proof of the rate limiting engine against the running server,
 * real Postgres and real Redis: quota enforcement, response headers, and
 * idempotent violation logging.
 *
 * Requires the stack from `nx e2e` (server + db + redis reachable via
 * apps/server/.env).
 */
describe('rate limiting (e2e)', () => {
  jest.setTimeout(30_000);

  const TENANT_NAME = 'e2e-rate-limit-tenant';
  const API_KEY = 'e2e-rate-limit-api-key';
  const LIMIT = 5;
  const WINDOW_SECONDS = 10;

  let db: Client;
  let redis: Redis;
  let tenantId: string;

  const request = (headers: Record<string, string> = {}) =>
    axios.get('/api', {
      headers: { 'x-api-key': API_KEY, ...headers },
      // We assert on status codes ourselves, including 429.
      validateStatus: () => true,
    });

  const clearWindow = async () => {
    await redis.del(`rate-limit:${tenantId}`);
  };

  beforeAll(async () => {
    db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

    // Re-seed the test tenant from scratch (order respects FKs).
    await db.query(
      `DELETE FROM "ViolationLog" WHERE "tenantId" IN (SELECT id FROM "Tenant" WHERE name = $1)`,
      [TENANT_NAME],
    );
    await db.query(
      `DELETE FROM "QuotaConfigs" WHERE "tenantId" IN (SELECT id FROM "Tenant" WHERE name = $1)`,
      [TENANT_NAME],
    );
    await db.query(`DELETE FROM "Tenant" WHERE name = $1`, [TENANT_NAME]);

    tenantId = randomUUID();
    await db.query(
      `INSERT INTO "Tenant" (id, name, api_key) VALUES ($1, $2, $3)`,
      [tenantId, TENANT_NAME, API_KEY],
    );
    await db.query(
      `INSERT INTO "QuotaConfigs" (id, "tenantId", max_requests, window_seconds, updated_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [randomUUID(), tenantId, LIMIT, WINDOW_SECONDS],
    );
  });

  beforeEach(clearWindow);

  afterAll(async () => {
    await db.query(`DELETE FROM "ViolationLog" WHERE "tenantId" = $1`, [
      tenantId,
    ]);
    await db.query(`DELETE FROM "QuotaConfigs" WHERE "tenantId" = $1`, [
      tenantId,
    ]);
    await db.query(`DELETE FROM "Tenant" WHERE id = $1`, [tenantId]);
    await clearWindow();
    await db.end();
    redis.disconnect();
  });

  it(`allows the first ${LIMIT} requests, then denies with correct headers`, async () => {
    const responses: AxiosResponse[] = [];
    for (let i = 0; i < 10; i++) {
      responses.push(await request());
    }

    const statuses = responses.map((r) => r.status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429, 429, 429, 429, 429]);

    // Allowed responses count the quota down: 4, 3, 2, 1, 0.
    responses.slice(0, LIMIT).forEach((res, i) => {
      expect(res.headers['x-ratelimit-limit']).toBe(String(LIMIT));
      expect(res.headers['x-ratelimit-remaining']).toBe(String(LIMIT - 1 - i));
      expect(Number(res.headers['x-ratelimit-reset'])).toBeGreaterThan(
        Date.now() / 1000,
      );
    });

    // Denied responses: quota exhausted, Retry-After within the window.
    for (const res of responses.slice(LIMIT)) {
      expect(res.headers['x-ratelimit-remaining']).toBe('0');
      const retryAfter = Number(res.headers['retry-after']);
      expect(retryAfter).toBeGreaterThanOrEqual(1);
      expect(retryAfter).toBeLessThanOrEqual(WINDOW_SECONDS);
      expect(res.data).toMatchObject({ statusCode: 429 });
    }
  });

  it('logs a violation exactly once per request id (idempotent insert)', async () => {
    // Exhaust the quota.
    for (let i = 0; i < LIMIT; i++) {
      await request();
    }

    // The same logical request, retried: one violation row, not two.
    const requestId = `e2e-idem-${randomUUID()}`;
    const first = await request({ 'x-request-id': requestId });
    const retry = await request({ 'x-request-id': requestId });
    expect(first.status).toBe(429);
    expect(retry.status).toBe(429);
    // The correlation id is echoed back, joining response, logs and DB row.
    expect(first.headers['x-request-id']).toBe(requestId);

    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS count FROM "ViolationLog" WHERE request_id = $1`,
      [requestId],
    );
    expect(rows[0].count).toBe(1);

    // And the row carries the tenant and path of the denied call.
    const { rows: logRows } = await db.query(
      `SELECT "tenantId", path FROM "ViolationLog" WHERE request_id = $1`,
      [requestId],
    );
    expect(logRows[0]).toEqual({ tenantId, path: '/api' });
  });
});
