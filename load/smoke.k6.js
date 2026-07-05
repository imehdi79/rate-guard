// =============================================================================
// CI latency regression gate: 10s at 50 req/s against the production images.
// Fails (non-zero exit -> red pipeline) if p95 latency crosses 80ms or any
// request errors. The full ramp/soak suite lives in rate-guard.k6.js.
//
//   docker compose -f docker-compose.yml -f docker-compose.load.yml \
//     run --rm k6 run smoke.k6.js
// =============================================================================

import http from 'k6/http';
import exec from 'k6/execution';
import { Rate } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';
const ADMIN_KEY = __ENV.ADMIN_API_KEY || 'dev-admin-key';

const smokeErrors = new Rate('smoke_errors');

export const options = {
  scenarios: {
    smoke: {
      executor: 'constant-arrival-rate',
      rate: 50,
      timeUnit: '1s',
      duration: '10s',
      preAllocatedVUs: 10,
      maxVUs: 20,
    },
  },
  thresholds: {
    // The gate: latency regression fails the pipeline. Scoped to the smoke
    // scenario so setup()'s admin calls don't skew the percentile.
    'http_req_duration{scenario:smoke}': ['p(95)<80'],
    smoke_errors: ['rate<0.01'],
    http_req_failed: ['rate<0.01'],
  },
};

export function setup() {
  const headers = { 'x-admin-key': ADMIN_KEY, 'Content-Type': 'application/json' };
  const created = http.post(
    `${BASE_URL}/api/admin/tenants`,
    JSON.stringify({ name: `k6-smoke-${Date.now()}` }),
    { headers },
  );
  if (created.status !== 201) {
    exec.test.abort(`tenant setup failed: ${created.status} ${created.body}`);
  }
  const tenant = created.json();
  // Quota far above 50 req/s so a 429 can only mean a limiter regression.
  const quota = http.put(
    `${BASE_URL}/api/admin/tenants/${tenant.id}/quota`,
    JSON.stringify({ max_requests: 1_000_000, window_seconds: 60 }),
    { headers },
  );
  if (quota.status !== 200) {
    exec.test.abort(`quota setup failed: ${quota.status} ${quota.body}`);
  }
  return { apiKey: tenant.api_key };
}

export default function (data) {
  const res = http.get(`${BASE_URL}/api`, {
    headers: { 'x-api-key': data.apiKey },
  });
  smokeErrors.add(res.status !== 200);
}
