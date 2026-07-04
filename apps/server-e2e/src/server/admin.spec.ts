import axios from 'axios';
import Redis from 'ioredis';
import { Client } from 'pg';

/**
 * End-to-end coverage of the admin API: separate admin key, tenant CRUD,
 * quota reads/updates — and the proof that a quota update invalidates the
 * Redis-cached tenant config, so new limits bind on the very next request
 * instead of after the cache TTL.
 */
describe('admin API (e2e)', () => {
  jest.setTimeout(30_000);

  const TENANT_NAME = 'e2e-admin-tenant';
  const ADMIN_KEY = process.env.ADMIN_API_KEY ?? '';

  let db: Client;
  let redis: Redis;
  let tenantId: string;
  let tenantApiKey: string;

  const admin = (headers: Record<string, string> = {}) => ({
    headers: { 'x-admin-key': ADMIN_KEY, ...headers },
    validateStatus: () => true,
  });

  const cleanupTenant = async () => {
    await db.query(
      `DELETE FROM "ViolationLog" WHERE "tenantId" IN (SELECT id FROM "Tenant" WHERE name = $1)`,
      [TENANT_NAME],
    );
    await db.query(
      `DELETE FROM "QuotaConfigs" WHERE "tenantId" IN (SELECT id FROM "Tenant" WHERE name = $1)`,
      [TENANT_NAME],
    );
    await db.query(`DELETE FROM "Tenant" WHERE name = $1`, [TENANT_NAME]);
  };

  beforeAll(async () => {
    expect(ADMIN_KEY).not.toBe('');
    db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
    await cleanupTenant();
  });

  afterAll(async () => {
    await cleanupTenant();
    if (tenantId) {
      await redis.del(`rate-limit:${tenantId}`);
    }
    if (tenantApiKey) {
      await redis.del(`tenant-config:${tenantApiKey}`);
    }
    await db.end();
    redis.disconnect();
  });

  it('denies admin routes without the admin key', async () => {
    const missing = await axios.get('/api/admin/tenants', {
      validateStatus: () => true,
    });
    const wrong = await axios.get(
      '/api/admin/tenants',
      admin({ 'x-admin-key': 'not-the-key' }),
    );

    expect(missing.status).toBe(403);
    expect(wrong.status).toBe(403);
  });

  it('a tenant api key does not grant admin access', async () => {
    const res = await axios.get('/api/admin/tenants', {
      headers: { 'x-api-key': 'some-tenant-key' },
      validateStatus: () => true,
    });

    expect(res.status).toBe(403);
  });

  it('creates a tenant, returning the api key exactly once', async () => {
    const res = await axios.post(
      '/api/admin/tenants',
      { name: TENANT_NAME },
      admin(),
    );

    expect(res.status).toBe(201);
    expect(res.data.id).toBeDefined();
    expect(res.data.api_key).toMatch(/^rk_/);
    tenantId = res.data.id;
    tenantApiKey = res.data.api_key;

    const dup = await axios.post(
      '/api/admin/tenants',
      { name: TENANT_NAME },
      admin(),
    );
    expect(dup.status).toBe(409);
  });

  it('lists tenants without exposing api keys', async () => {
    const res = await axios.get('/api/admin/tenants', admin());

    expect(res.status).toBe(200);
    const entry = res.data.find((t: { id: string }) => t.id === tenantId);
    expect(entry).toBeDefined();
    expect(entry.api_key).toBeUndefined();
  });

  it('reports default quota for an unconfigured tenant', async () => {
    const res = await axios.get(
      `/api/admin/tenants/${tenantId}/quota`,
      admin(),
    );

    expect(res.status).toBe(200);
    expect(res.data).toEqual({
      tenantId,
      max_requests: 100,
      window_seconds: 60,
      configured: false,
    });
  });

  it('validates quota updates and unknown tenants', async () => {
    const badBody = await axios.put(
      `/api/admin/tenants/${tenantId}/quota`,
      { max_requests: -1, window_seconds: 10 },
      admin(),
    );
    const unknown = await axios.get(
      '/api/admin/tenants/00000000-0000-0000-0000-000000000000/quota',
      admin(),
    );
    const unknownStats = await axios.get(
      '/api/admin/tenants/00000000-0000-0000-0000-000000000000/stats',
      admin(),
    );

    expect(badBody.status).toBe(400);
    expect(unknown.status).toBe(404);
    expect(unknownStats.status).toBe(404);
  });

  it('quota updates invalidate the config cache and bind immediately', async () => {
    // Prime the tenant-config cache: this request is authenticated and rate
    // limited under the default quota (limit 100).
    const prime = await axios.get('/api', {
      headers: { 'x-api-key': tenantApiKey },
      validateStatus: () => true,
    });
    expect(prime.status).toBe(200);
    expect(prime.headers['x-ratelimit-limit']).toBe('100');

    // Tighten the quota. Without invalidation the cached limit=100 would
    // stick around for up to the cache TTL (60s).
    const update = await axios.put(
      `/api/admin/tenants/${tenantId}/quota`,
      { max_requests: 2, window_seconds: 10 },
      admin(),
    );
    expect(update.status).toBe(200);
    expect(update.data).toEqual({
      tenantId,
      max_requests: 2,
      window_seconds: 10,
      configured: true,
    });

    // The very next request must already run under limit=2. The priming
    // request still counts inside the window, so this one fills the quota…
    const second = await axios.get('/api', {
      headers: { 'x-api-key': tenantApiKey },
      validateStatus: () => true,
    });
    expect(second.status).toBe(200);
    expect(second.headers['x-ratelimit-limit']).toBe('2');
    expect(second.headers['x-ratelimit-remaining']).toBe('0');

    // …and the one after is denied.
    const third = await axios.get('/api', {
      headers: { 'x-api-key': tenantApiKey },
      validateStatus: () => true,
    });
    expect(third.status).toBe(429);

    // The admin view reflects the new config.
    const quota = await axios.get(
      `/api/admin/tenants/${tenantId}/quota`,
      admin(),
    );
    expect(quota.data).toMatchObject({
      max_requests: 2,
      window_seconds: 10,
      configured: true,
    });
  });

  it('stats report live window usage and violations without consuming quota', async () => {
    // State from the previous test: quota 2/10s, two allowed requests still
    // inside the window (the denied third was rolled back), one violation.
    const res = await axios.get(
      `/api/admin/tenants/${tenantId}/stats`,
      admin(),
    );

    expect(res.status).toBe(200);
    expect(res.data.tenantId).toBe(tenantId);
    expect(res.data.name).toBe(TENANT_NAME);
    expect(res.data.quota).toEqual({
      max_requests: 2,
      window_seconds: 10,
      configured: true,
    });
    expect(res.data.usage).toEqual({ current: 2, remaining: 0 });
    expect(res.data.violations.last_24h).toBe(1);
    expect(res.data.violations.recent).toHaveLength(1);
    expect(res.data.violations.recent[0]).toMatchObject({ path: '/api' });
    expect(res.data.violations.recent[0].request_id).toBeDefined();

    // Polling stats is read-only: usage must not grow from the poll itself.
    const again = await axios.get(
      `/api/admin/tenants/${tenantId}/stats`,
      admin(),
    );
    expect(again.data.usage.current).toBe(2);
  });
});
