// Global sign-in brute-force throttle keyed by client IP. Complements the
// per-profile lockout in routes/auth.ts: without it, one host could hammer
// every profile in parallel (the per-profile counters don't see each
// other), and a PIN is only 4-6 digits. Adapted from the legacy hub's
// lib/pinThrottle.ts (principle 8).

import { getConnInfo } from "hono/bun";
import type { Context } from "hono";
import { TRUST_PROXY } from "@/lib/trustProxy";

const WINDOW_MS = 15 * 60_000;
const MAX_FAILS = 20;
const MAX_BUCKETS = 5_000;

interface Bucket {
  fails: number;
  first: number;
  lockedUntil: number;
}
const buckets = new Map<string, Bucket>();

export function getClientIp(c: Context): string {
  if (TRUST_PROXY) {
    const xff = c.req.header("x-forwarded-for");
    if (xff) return xff.split(",")[0]!.trim();
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function throttleCheck(ip: string): {
  blocked: boolean;
  retryAfter: number;
} {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b) return { blocked: false, retryAfter: 0 };
  if (b.lockedUntil > now)
    return { blocked: true, retryAfter: Math.ceil((b.lockedUntil - now) / 1000) };
  if (now - b.first > WINDOW_MS) buckets.delete(ip);
  return { blocked: false, retryAfter: 0 };
}

export function throttleFail(ip: string): void {
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b || now - b.first > WINDOW_MS) {
    b = { fails: 0, first: now, lockedUntil: 0 };
    if (buckets.size >= MAX_BUCKETS) {
      for (const [k, v] of buckets)
        if (v.lockedUntil <= now && now - v.first > WINDOW_MS) buckets.delete(k);
    }
    buckets.set(ip, b);
  }
  b.fails++;
  if (b.fails >= MAX_FAILS) b.lockedUntil = now + WINDOW_MS;
}

export function throttleReset(ip: string): void {
  buckets.delete(ip);
}

/** Test-only: buckets are process-local module state with no reset hook. */
export function __resetThrottleForTests(): void {
  buckets.clear();
}
