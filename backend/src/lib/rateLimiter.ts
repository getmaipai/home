// Home's own rate limiter: ONE shared instance across every integration
// (.github/CLAUDE.md's "Third-party services: we are the user" - "every
// integration gets a rate limiter at its single choke point"), keyed
// per destination host so one slow integration never throttles another.
// The token-bucket logic lives in @maipai/core/src/rateLimiter now
// (core-v0.1.0).
import { createRateLimiter, type TokenBucketOptions } from "@maipai/core/src/rateLimiter";

export type { TokenBucketOptions };

const limiter = createRateLimiter();

export function tryConsume(key: string, opts: TokenBucketOptions, nowMs?: number): boolean {
  return limiter.tryConsume(key, opts, nowMs);
}

export const __resetRateLimiterForTests = limiter.__resetForTests;
export const __setRateLimiterClockForTests = limiter.__setClockForTests;
