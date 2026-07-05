# Architecture Decision Records

Three decisions carry most of this system's weight. Each was made before the
code existed and survived contact with the load tests ([LOAD_TEST.md](LOAD_TEST.md)).

---

## 1. Sliding window, not token bucket

**Context.** A tenant's quota ("N requests per M seconds") must hold as a hard
guarantee — it is the product. Candidates: fixed window (cheap, but admits 2×N
bursts straddling a window boundary), token bucket (smooth, O(1) state, but its
contract is "average rate plus burst allowance" — a full bucket admits an
instant burst by design), sliding window (exact: at most N requests inside
*any* M-second interval).

**Decision.** Sliding window over a Redis sorted set: one member per admitted
request, scored by server timestamp; expired members evicted on every call;
`ZCARD` is the truth. Denied requests are rolled back (`ZREM`) so a client
retrying while blocked never consumes quota it didn't get.

**Consequences.** Memory is O(limit) per tenant instead of token bucket's O(1)
— acceptable because keys carry `PEXPIRE` and quotas are per-tenant, not
per-IP-of-the-internet. In exchange the limit is *exact and explainable*: k6
measured precisely 5 admissions per 60s window on a 5-req quota, twice in a
row, and `X-RateLimit-Reset` can state truthfully when the oldest request
leaves the window. A token bucket cannot make either statement.

## 2. One Lua script, not client-side orchestration

**Context.** The decision is a read-modify-write across four Redis commands
(evict → add → count → maybe roll back). Two concurrent requests interleaving
between those steps both see "under limit" and both pass — the race exists
precisely at the moment the limiter matters most. Alternatives: `WATCH`/`MULTI`
(optimistic — retries storm exactly under the contention we're built for),
distributed locks (extra round trips and a second consistency problem),
approximate `INCR` schemes (give up exactness, see decision 1).

**Decision.** The whole read-modify-write is one Lua script, loaded once and
invoked by `EVALSHA` (with `NOSCRIPT` reload). Redis executes scripts
single-threaded, so admission is serialized by construction — no locks, no
retries. The script also reads `TIME` inside Redis: one clock for every server
replica, immune to app-host clock skew.

**Consequences.** One network round trip per decision — the measured hot path
is p95 1.96ms *end to end* at 200 req/s. The cost is operational coupling:
Redis ≥ 5 (effect replication for the non-deterministic `TIME`), and the
script is a deployment artifact that must ship next to the bundle. Concurrency
was verified empirically: 10 parallel invocations against limit 5 admit
exactly 5.

## 3. Violations in Postgres, not Redis-only

**Context.** Every 429 must be attributable after the fact — which tenant,
which path, when, correlated with logs. Keeping it in Redis looks convenient
(the data is born there) but is wrong on capacity policy alone: the Redis
instance runs `noeviction` so quota state is never silently dropped, which
means unbounded audit growth would eventually block the hot path's writes.
Audit data and rate-limit state have opposite retention needs.

**Decision.** A `ViolationLog` table in Postgres, written only on denial.
`request_id` is unique — the insert is `ON CONFLICT DO NOTHING`, so client
retries of the same request cannot double-log, and the id equals the
`X-Request-Id` response header and the pino `correlation_id`, making one
incident traceable across response, logs, and audit row. Audit failure is
swallowed (a lost row must not turn a 429 into a 500). Redis keeps only
ephemeral window state.

**Consequences.** The dashboard's "violations last 24h" and "recent
violations" are indexed SQL, joinable to tenants — queries Redis would answer
badly or expensively. The write costs ~2.5ms, paid exclusively by rejected
requests (measured: over-limit p50 3.24ms vs steady 0.68ms); the happy path
never touches Postgres for limiting. Trade-off accepted: under heavy abuse the
table grows one row per denied request — a retention job is the obvious
follow-up, and losing audit rows during a Postgres outage is by-design
(availability of the gateway outranks completeness of the audit).
