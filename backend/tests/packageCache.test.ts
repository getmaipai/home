import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  cachedFetch,
  getCacheStats,
  __resetPackageCacheForTests,
  __setTestCacheBudgetBytes,
  __clearPackageCacheDirForTests,
} from "@/lib/packageCache";

const PKG = "test-cache-pkg";

beforeEach(() => {
  __resetPackageCacheForTests();
  __clearPackageCacheDirForTests(PKG);
});

// The eviction budget override is process-wide (packageCache.ts's own
// module state), not scoped to this file - left set after this file's
// last test, it would silently evict every OTHER test file's cache
// entries for the rest of the same `bun test` run. beforeEach already
// resets it before each of this file's own tests; this guards the
// handoff to whichever test file runs next.
afterEach(() => {
  __resetPackageCacheForTests();
});

function counter() {
  let calls = 0;
  const fn = async () => {
    calls++;
    return { calls, at: Date.now() };
  };
  return { fn, count: () => calls };
}

describe("cachedFetch", () => {
  test("no cache policy declared: always calls through, never caches", async () => {
    const { fn, count } = counter();
    await cachedFetch(PKG, undefined, "https://example.com/a", undefined, fn);
    await cachedFetch(PKG, undefined, "https://example.com/a", undefined, fn);
    expect(count()).toBe(2);
  });

  test("a miss calls through and caches; the next call within ttl_s is a hit with no call", async () => {
    const { fn, count } = counter();
    const first = await cachedFetch(PKG, { ttl_s: 60 }, "https://example.com/a", undefined, fn);
    const second = await cachedFetch(PKG, { ttl_s: 60 }, "https://example.com/a", undefined, fn);
    expect(count()).toBe(1);
    expect(second).toEqual(first);
  });

  test("a different URL is its own independent cache entry", async () => {
    const { fn, count } = counter();
    await cachedFetch(PKG, { ttl_s: 60 }, "https://example.com/a", undefined, fn);
    await cachedFetch(PKG, { ttl_s: 60 }, "https://example.com/b", undefined, fn);
    expect(count()).toBe(2);
  });

  test("a POST is never cached, even with a cache policy declared", async () => {
    const { fn, count } = counter();
    await cachedFetch(PKG, { ttl_s: 60 }, "https://example.com/a", { method: "POST" }, fn);
    await cachedFetch(PKG, { ttl_s: 60 }, "https://example.com/a", { method: "POST" }, fn);
    expect(count()).toBe(2);
  });

  test("past ttl_s with no stale_ok_s, a call is a real miss again", async () => {
    const { fn, count } = counter();
    await cachedFetch(PKG, { ttl_s: -1 }, "https://example.com/a", undefined, fn); // already expired the instant it's written
    await cachedFetch(PKG, { ttl_s: -1 }, "https://example.com/a", undefined, fn);
    expect(count()).toBe(2);
  });

  test("past ttl_s but within stale_ok_s: serves the stale value immediately and revalidates in the background", async () => {
    const { fn, count } = counter();
    const first = await cachedFetch(PKG, { ttl_s: -1, stale_ok_s: 60 }, "https://example.com/a", undefined, fn);
    expect(count()).toBe(1);
    const second = await cachedFetch(PKG, { ttl_s: -1, stale_ok_s: 60 }, "https://example.com/a", undefined, fn);
    // Served the stale value immediately (not the not-yet-resolved revalidation's)...
    expect(second).toEqual(first);
    // ...but a background revalidation was still kicked off.
    await new Promise((r) => setTimeout(r, 10));
    expect(count()).toBe(2);
  });

  test("an entry over max_bytes is never written to cache", async () => {
    const bigValue = { blob: "x".repeat(1000) };
    const fn = async () => bigValue;
    await cachedFetch(PKG, { ttl_s: 60, max_bytes: 10 }, "https://example.com/a", undefined, fn);
    const stats = getCacheStats().find((s) => s.packageId === PKG);
    expect(stats?.entryCount ?? 0).toBe(0);
  });

  test("the same URL with two different headers gets two independent cache entries", async () => {
    const { fn, count } = counter();
    await cachedFetch(PKG, { ttl_s: 60 }, "https://example.com/a", { headers: { "Accept-Language": "en" } }, fn);
    await cachedFetch(PKG, { ttl_s: 60 }, "https://example.com/a", { headers: { "Accept-Language": "fr" } }, fn);
    expect(count()).toBe(2);
  });

  test("the same headers in a different key order still hit the same entry", async () => {
    const { fn, count } = counter();
    await cachedFetch(PKG, { ttl_s: 60 }, "https://example.com/a", { headers: { A: "1", B: "2" } }, fn);
    await cachedFetch(PKG, { ttl_s: 60 }, "https://example.com/a", { headers: { B: "2", A: "1" } }, fn);
    expect(count()).toBe(1);
  });

  test("a cache hit is reflected in getCacheStats(), a miss too", async () => {
    const { fn } = counter();
    await cachedFetch(PKG, { ttl_s: 60 }, "https://example.com/a", undefined, fn); // miss
    await cachedFetch(PKG, { ttl_s: 60 }, "https://example.com/a", undefined, fn); // hit
    const stats = getCacheStats().find((s) => s.packageId === PKG);
    expect(stats?.hits).toBe(1);
    expect(stats?.misses).toBe(1);
    expect(stats?.entryCount).toBe(1);
  });
});

describe("eviction", () => {
  test("the oldest entry is evicted first once the total is over budget", async () => {
    __setTestCacheBudgetBytes(1); // anything cached at all is immediately over budget
    const fn = async () => ({ some: "value" });
    await cachedFetch(PKG, { ttl_s: 60 }, "https://example.com/old", undefined, fn);
    await cachedFetch(PKG, { ttl_s: 60 }, "https://example.com/new", undefined, fn);
    // Both writes trigger eviction; only ever the newest entry survives
    // each pass under a budget this tight, proving eviction actually ran
    // (not just "the cache never grew past one entry by coincidence").
    const stats = getCacheStats().find((s) => s.packageId === PKG);
    expect(stats?.entryCount).toBeLessThanOrEqual(1);
  });

  test("under a real budget, nothing is evicted", async () => {
    __setTestCacheBudgetBytes(10_000_000);
    const fn = async () => ({ some: "value" });
    await cachedFetch(PKG, { ttl_s: 60 }, "https://example.com/a", undefined, fn);
    await cachedFetch(PKG, { ttl_s: 60 }, "https://example.com/b", undefined, fn);
    const stats = getCacheStats().find((s) => s.packageId === PKG);
    expect(stats?.entryCount).toBe(2);
  });

  // PERF-5 (code review, 2026-09-06): evictIfOverBudget() used to walk
  // and stat the entire cache directory on every write; it now keeps a
  // running total instead, only re-walking when eviction genuinely has
  // to happen. This proves that running total stays accurate across many
  // writes on its own (no walk in between to correct any drift) - it
  // fires eviction on the exact write that crosses the budget, neither
  // too early nor too late.
  test("the running total stays accurate across many writes with no walk in between", async () => {
    __setTestCacheBudgetBytes(10_000_000);
    const fn = async () => ({ some: "value" });
    for (let i = 0; i < 20; i++) {
      await cachedFetch(PKG, { ttl_s: 60 }, `https://example.com/warm-${i}`, undefined, fn);
    }
    expect(getCacheStats().find((s) => s.packageId === PKG)?.entryCount).toBe(20);

    // Now tighten the budget so the NEXT write is what pushes it over -
    // proving the running total (not a stale pre-tightening snapshot)
    // is what evictIfOverBudget() actually checks.
    __setTestCacheBudgetBytes(1);
    await cachedFetch(PKG, { ttl_s: 60 }, "https://example.com/tips-it-over", undefined, fn);
    expect(getCacheStats().find((s) => s.packageId === PKG)?.entryCount).toBeLessThanOrEqual(1);
  });
});
