# Load test results

k6 against the production Docker stack — the same images and container-to-container
topology that runs on the VPS (k6 joins the compose `internal` network; no host
NAT in the measured path; Postgres and Redis are real, not mocked).

**All thresholds passed.** Full scenario definitions and assertions:
[`load/rate-guard.k6.js`](load/rate-guard.k6.js).

## Results

| Scenario | VUs | RPS | p50 | p95 | p99 | errors |
| --- | --- | --- | --- | --- | --- | --- |
| `steady_load` — 10 tenants, generous quotas | ~2 per tenant (20 pool) | **200** (60s hold; 30s ramp-up, 15s ramp-down) | 0.68 ms | **1.96 ms** | 2.71 ms | **0 / 16,500** |
| `over_limit` — 1 tenant, quota 5 req/60s | 2 | ~9.8 offered | 3.24 ms | 5.67 ms | 8.61 ms | 0 / 1,030 |
| **total** | 22 | 167 avg over 105s | 0.70 ms | 2.76 ms | — | **0 / 17,552** |

## Assertions (k6 thresholds — the run fails if violated)

| Assertion | Threshold | Measured |
| --- | --- | --- |
| p95 latency at 200 req/s | < 50 ms | **1.96 ms** (25× headroom) |
| Error rate (transport + 5xx) | < 0.1 % | **0.00 %** |
| Requests admitted past a 5 req/60s quota in 105s | ≤ 11 (5 × 2 sliding windows + 1 boundary slack) | **exactly 10** — the limiter is precise, and deterministic across runs |
| Malformed 429s (missing `Retry-After`, `X-RateLimit-Remaining: 0`, or body shape) | 0 | **0** of 1,020 rejections |

Notes worth reading into the numbers:

- Every request in the measured path does real work: API-key auth (Redis-cached
  tenant config), the atomic sliding-window Lua script in Redis, and quota
  headers on the response.
- The over-limit percentiles are higher than steady because each 429 also
  writes an idempotent violation-log row to Postgres — the audit trail costs
  ~2.5 ms and is paid only by rejected requests.
- 429s are counted as *correct* responses, never as errors; the error rate
  covers transport failures and 5xx only.

## Environment

- Date: 2026-07-05 · k6 in Docker (`grafana/k6:latest`), summary export committed from this run
- Host: Intel Core i5-13400 (16 threads), Docker Desktop on Windows 11
- Stack: production images from `docker-compose.yml` (webpack-bundled NestJS on Bun,
  Postgres 17, Redis 8 with AOF), `LOG_LEVEL=info` — request logging on, like production

## Reproduce

```bash
docker compose up -d
docker compose -f docker-compose.yml -f docker-compose.load.yml run --rm k6
docker compose down -v   # test tenants live in the stack's own db volume
```
