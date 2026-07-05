// =============================================================================
// rate-guard load test (k6)
//
// Run inside the deploy stack's network (same topology as the VPS):
//   docker compose -f docker-compose.yml -f docker-compose.load.yml run --rm k6
//
// Scenarios:
//   steady_load — open model (arrival rate): ramp 0 -> 200 req/s over 30s,
//     hold 200 req/s for 60s, ramp down 15s. Requests spread over
//     STEADY_TENANTS tenants with quotas far above the offered load, so
//     every 429 here is a real error. ~2 VUs per tenant at steady state.
//   over_limit — closed model: 2 VUs on one tenant with a 5 req / 60s
//     quota. Proves the limiter under load: at most limit×⌈t/window⌉
//     requests ever pass, every rejection is a well-formed 429.
//
// Thresholds (the test FAILS if violated):
//   p95 latency < 50ms at 200 req/s · error rate < 0.1% ·
//   0 malformed 429s · allowed count on the throttled tenant within bound.
// =============================================================================

import http from 'k6/http';
import exec from 'k6/execution';
import { sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';
const ADMIN_KEY = __ENV.ADMIN_API_KEY || 'dev-admin-key';

const STEADY_TENANTS = 10;
const OVER_LIMIT_QUOTA = { max_requests: 5, window_seconds: 60 };
// 105s of test vs a 60s sliding window -> at most 2 windows can admit
// requests; allow +1 slack for the window boundary.
const MAX_ALLOWED_OVER_LIMIT =
  OVER_LIMIT_QUOTA.max_requests * Math.ceil(105 / OVER_LIMIT_QUOTA.window_seconds) + 1;

// 429 is an expected, correct response for this system — only transport
// errors and 5xx should count into http_req_failed.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 299 }, 429));

const steadyLatency = new Trend('steady_latency', true);
const steadyErrors = new Rate('steady_errors');
const overLimitLatency = new Trend('overlimit_latency', true);
const overLimitAllowed = new Counter('overlimit_allowed');
const overLimitDenied = new Counter('overlimit_denied');
const overLimitBad = new Counter('overlimit_bad');

export const options = {
  scenarios: {
    steady_load: {
      executor: 'ramping-arrival-rate',
      startRate: 0,
      timeUnit: '1s',
      preAllocatedVUs: 2 * STEADY_TENANTS,
      maxVUs: 6 * STEADY_TENANTS,
      stages: [
        { target: 200, duration: '30s' },
        { target: 200, duration: '60s' },
        { target: 0, duration: '15s' },
      ],
      exec: 'steady',
    },
    over_limit: {
      executor: 'constant-vus',
      vus: 2,
      duration: '105s',
      exec: 'overLimit',
    },
  },
  thresholds: {
    // p(99) listed so it lands in the summary export alongside p(95).
    steady_latency: ['p(95)<50', 'p(99)<250'],
    // No pass/fail intent — declared so p(99) shows up in the export.
    overlimit_latency: ['p(99)<1000'],
    steady_errors: ['rate<0.001'],
    http_req_failed: ['rate<0.001'],
    overlimit_bad: ['count==0'],
    overlimit_allowed: [`count<=${MAX_ALLOWED_OVER_LIMIT}`],
  },
};

function adminPost(path, body) {
  const res = http.post(`${BASE_URL}${path}`, JSON.stringify(body), {
    headers: { 'x-admin-key': ADMIN_KEY, 'Content-Type': 'application/json' },
  });
  if (res.status >= 300) {
    exec.test.abort(`admin ${path} failed: ${res.status} ${res.body}`);
  }
  return res.json();
}

function adminPut(path, body) {
  const res = http.put(`${BASE_URL}${path}`, JSON.stringify(body), {
    headers: { 'x-admin-key': ADMIN_KEY, 'Content-Type': 'application/json' },
  });
  if (res.status >= 300) {
    exec.test.abort(`admin ${path} failed: ${res.status} ${res.body}`);
  }
}

export function setup() {
  const runId = Date.now();
  const steadyKeys = [];
  for (let i = 0; i < STEADY_TENANTS; i++) {
    const tenant = adminPost('/api/admin/tenants', {
      name: `k6-steady-${i}-${runId}`,
    });
    // Quota far above the per-tenant share of 200 req/s so the steady
    // scenario never legitimately sees a 429.
    adminPut(`/api/admin/tenants/${tenant.id}/quota`, {
      max_requests: 1_000_000,
      window_seconds: 60,
    });
    steadyKeys.push(tenant.api_key);
  }

  const overTenant = adminPost('/api/admin/tenants', {
    name: `k6-overlimit-${runId}`,
  });
  adminPut(`/api/admin/tenants/${overTenant.id}/quota`, OVER_LIMIT_QUOTA);

  return { steadyKeys, overKey: overTenant.api_key, runId };
}

export function steady(data) {
  const key = data.steadyKeys[(exec.vu.idInTest - 1) % data.steadyKeys.length];
  const res = http.get(`${BASE_URL}/api`, {
    headers: { 'x-api-key': key },
    tags: { name: 'steady /api' },
  });
  steadyLatency.add(res.timings.duration);
  steadyErrors.add(res.status !== 200);
}

export function overLimit(data) {
  const res = http.get(`${BASE_URL}/api`, {
    headers: { 'x-api-key': data.overKey },
    tags: { name: 'overlimit /api' },
  });
  overLimitLatency.add(res.timings.duration);

  if (res.status === 200) {
    overLimitAllowed.add(1);
  } else if (res.status === 429) {
    overLimitDenied.add(1);
    // A correct 429 always carries Retry-After and an exhausted quota.
    const retryAfter = Number(res.headers['Retry-After']);
    const remaining = res.headers['X-Ratelimit-Remaining'];
    const body = res.json();
    if (
      !(retryAfter >= 1) ||
      remaining !== '0' ||
      body.statusCode !== 429 ||
      typeof body.retryAfter !== 'number'
    ) {
      overLimitBad.add(1);
    }
  } else {
    overLimitBad.add(1);
  }
  sleep(0.2);
}
