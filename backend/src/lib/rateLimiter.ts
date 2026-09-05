// A per-key token bucket (.github/CLAUDE.md's "Third-party services: we
// are the user" - "Budget every service to what one engaged human does:
// a page every few seconds, not dozens a second. Every integration gets
// a rate limiter (token bucket) at its single choke point, and all
// traffic to that service goes through it - never a raw fetch on the
// side"). The first real consumer is packageHost.ts's host.fetch, keyed
// per destination host so one slow integration never throttles another;
// any future integration goes through the same limiter, never a second
// hand-rolled one beside it.

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

// A code review (2026-09-05) found this map had no eviction at all,
// unlike the sibling secretThrottle.ts pattern in the same directory
// (MAX_BUCKETS + a sweep on insert) - unbounded growth for the life of
// the process as packages accumulate distinct permitted destination
// hosts over the hub's uptime. Same fix, same shape: cap the map size,
// and when it's full, sweep out entries nothing has touched in a while
// (STALE_MS) before adding a new one.
const MAX_BUCKETS = 5_000;
const STALE_MS = 10 * 60_000;
const buckets = new Map<string, Bucket>();

/** capacity: the burst size (how many requests can fire back to back
 * before waiting). refillPerSecond: the sustained steady-state rate
 * once the burst is spent - together these are "a page every few
 * seconds," not a fixed interval that can't absorb a normal short burst
 * (a recipe's own fetch+pick+format steps, or a person retrying a skill
 * once). */
export interface TokenBucketOptions {
  capacity: number;
  refillPerSecond: number;
}

function refill(bucket: Bucket, opts: TokenBucketOptions, nowMs: number): void {
  const elapsedSeconds = Math.max(0, (nowMs - bucket.lastRefillMs) / 1000);
  bucket.tokens = Math.min(opts.capacity, bucket.tokens + elapsedSeconds * opts.refillPerSecond);
  bucket.lastRefillMs = nowMs;
}

/** True and consumes one token if the bucket for `key` has one available;
 * false (consuming nothing) otherwise. Never blocks or queues - a
 * caller over budget gets told no immediately, the same "back off on the
 * first signal" posture the household would want from any of its own
 * integrations, rather than a request silently piling up. */
export function tryConsume(key: string, opts: TokenBucketOptions): boolean {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket) {
    if (buckets.size >= MAX_BUCKETS) {
      for (const [k, v] of buckets) if (now - v.lastRefillMs > STALE_MS) buckets.delete(k);
    }
    bucket = { tokens: opts.capacity, lastRefillMs: now };
    buckets.set(key, bucket);
  }
  refill(bucket, opts, now);
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

/** Test-only: forgets every bucket's state so tests don't leak rate-limit
 * exhaustion into each other, the same reset shape __resetLlmSupervisorForTests()
 * and __resetThrottleForTests() already establish for other module-level
 * in-memory state. */
export function __resetRateLimiterForTests(): void {
  buckets.clear();
}
