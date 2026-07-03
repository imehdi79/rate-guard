-- Sliding window rate limiter.
--
-- KEYS[1] - sorted set holding one member per request (e.g. "rate-limit:<tenant>")
-- ARGV[1] - max number of requests allowed inside the window
-- ARGV[2] - window length in milliseconds
-- ARGV[3] - unique member for this request (UUID supplied by the caller)
--
-- Replies with { allowed (1|0), remaining, reset_at (unix ms) }.
--
-- The whole script executes atomically, so concurrent requests cannot
-- interleave between the evict/add/count steps — no race condition and
-- no WATCH/MULTI needed. Requires Redis >= 5 (effect replication) because
-- TIME is non-deterministic.

local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local member = ARGV[3]

-- Use the Redis clock so every server instance shares one time source.
local time = redis.call('TIME')
local now_ms = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)

-- Evict members that slid out of the window.
redis.call('ZREMRANGEBYSCORE', key, 0, now_ms - window_ms)

-- Record this request, then count everything left inside the window.
redis.call('ZADD', key, now_ms, member)
local count = redis.call('ZCARD', key)

-- The set only needs to outlive the window; keeps idle keys from leaking.
redis.call('PEXPIRE', key, window_ms)

local allowed = count <= limit
if not allowed then
  -- Denied requests must not consume quota, otherwise a client that keeps
  -- retrying while blocked would never regain access.
  redis.call('ZREM', key, member)
end

-- A slot frees up when the oldest remaining request leaves the window.
local reset_at = now_ms + window_ms
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
if oldest[2] then
  reset_at = tonumber(oldest[2]) + window_ms
end

if allowed then
  return { 1, limit - count, reset_at }
end
return { 0, 0, reset_at }
