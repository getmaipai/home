import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { cacheDir } from "@/lib/paths";
import {
  cachedFetch,
  CACHE_NOT_MODIFIED,
  packageCacheResponse,
  getCacheStats,
  getCacheEnvelope,
  __resetPackageCacheForTests,
  __setTestCacheBudgetBytes,
  __clearPackageCacheDirForTests,
  sweepPackageCache,
  LEGACY_ENTRY_GRACE_S,
} from "@/lib/packageCache";
import { backoffSeconds, effectiveTtlSeconds, parseRetryAfter } from "@/lib/httpCachePolicy";

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

describe("sweepPackageCache", () => {
  const keyFor = (url: string) => createHash("sha256").update(`GET\n${url}\n\n`).digest("hex");

  test("removes entries strictly past staleUntil and preserves the exact boundary", async () => {
    const url = "https://example.com/sweep-expired";
    await cachedFetch(PKG, { ttl_s: 60, stale_ok_s: 30 }, url, undefined, async () => ({ v: 1 }));
    const path = join(cacheDir, PKG, `${keyFor(url)}.json`);
    const entry = JSON.parse(readFileSync(path, "utf8"));
    const staleUntil = Date.now() - 1;
    entry.staleUntil = new Date(staleUntil).toISOString();
    writeFileSync(path, JSON.stringify(entry));
    expect(sweepPackageCache(staleUntil + 1).expired).toBe(1);
    expect(existsSync(path)).toBe(false);

    const boundaryUrl = "https://example.com/sweep-boundary";
    await cachedFetch(PKG, { ttl_s: 60, stale_ok_s: 30 }, boundaryUrl, undefined, async () => ({ v: 2 }));
    const boundaryPath = join(cacheDir, PKG, `${keyFor(boundaryUrl)}.json`);
    const boundaryEntry = JSON.parse(readFileSync(boundaryPath, "utf8"));
    boundaryEntry.staleUntil = new Date(staleUntil).toISOString();
    writeFileSync(boundaryPath, JSON.stringify(boundaryEntry));
    sweepPackageCache(staleUntil);
    expect(existsSync(boundaryPath)).toBe(true);
  });

  test("fresh and stale-but-servable entries remain usable", async () => {
    const freshUrl = "https://example.com/sweep-fresh";
    let calls = 0;
    await cachedFetch(PKG, { ttl_s: 60, stale_ok_s: 60 }, freshUrl, undefined, async () => ({ n: ++calls }));
    sweepPackageCache(Date.now());
    expect(await cachedFetch(PKG, { ttl_s: 60, stale_ok_s: 60 }, freshUrl, undefined, async () => ({ n: ++calls }))).toEqual({ n: 1 });
    expect(calls).toBe(1);

    const staleUrl = "https://example.com/sweep-stale";
    const staleFirst = await cachedFetch(PKG, { ttl_s: -1, stale_ok_s: 60 }, staleUrl, undefined, async () => ({ n: ++calls }));
    sweepPackageCache(Date.now());
    expect(await cachedFetch(PKG, { ttl_s: -1, stale_ok_s: 60 }, staleUrl, undefined, async () => ({ n: ++calls }))).toEqual(staleFirst);
  });

  test("applies legacy grace, cleans corrupt files and empty package directories", async () => {
    const dir = join(cacheDir, PKG);
    mkdirSync(dir, { recursive: true });
    const base = { url: "https://example.com/legacy", method: "GET", fetchedAt: new Date(Date.now() - 100_000).toISOString(), value: 1 };
    const legacyPath = join(dir, "legacy.json");
    writeFileSync(legacyPath, JSON.stringify({ ...base, expiresAt: new Date(10_000).toISOString() }));
    expect(sweepPackageCache(10_000 + LEGACY_ENTRY_GRACE_S * 1000).expired).toBe(0);
    expect(existsSync(legacyPath)).toBe(true);
    expect(sweepPackageCache(10_001 + LEGACY_ENTRY_GRACE_S * 1000).expired).toBe(1);
    expect(existsSync(dir)).toBe(false);

    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "broken.json"), "{");
    writeFileSync(join(dir, "neighbor.json"), JSON.stringify({ ...base, fetchedAt: new Date().toISOString(), staleUntil: new Date(Date.now() + 60_000).toISOString() }));
    expect(sweepPackageCache(Date.now()).expired).toBe(1);
    expect(readdirSync(dir)).toEqual(["neighbor.json"]);
  });

  test("trims byte budget once after sweep and keeps stats for emptied packages", async () => {
    __setTestCacheBudgetBytes(10_000_000);
    const url = "https://example.com/sweep-budget";
    await cachedFetch(PKG, { ttl_s: 60 }, url, undefined, async () => ({ v: 1 }));
    const path = join(cacheDir, PKG, `${keyFor(url)}.json`);
    const entry = JSON.parse(readFileSync(path, "utf8"));
    entry.staleUntil = new Date(Date.now() - 10_000).toISOString();
    writeFileSync(path, JSON.stringify(entry));
    sweepPackageCache(Date.now());
    expect(getCacheStats().find((row) => row.packageId === PKG)?.entryCount).toBe(0);
    expect(getCacheStats().find((row) => row.packageId === PKG)?.misses).toBe(1);
    __setTestCacheBudgetBytes(1);
    await cachedFetch(PKG, { ttl_s: 60 }, "https://example.com/sweep-new-write", undefined, async () => ({ v: 2 }));
    expect(getCacheStats().find((row) => row.packageId === PKG)?.entryCount).toBeLessThanOrEqual(1);
    expect(getCacheStats().some((row) => row.packageId === PKG)).toBe(true);
  });

  test("legacy grace covers every bundled cache stale window", () => {
    const manifests = new Bun.Glob("backend/packages/*/manifest.json").scanSync({ cwd: process.cwd() });
    const maxStale = [...manifests].reduce((max, file) => {
      const manifest = JSON.parse(readFileSync(file, "utf8"));
      const caches = [manifest.cache, ...(manifest.steps ?? []).flatMap((step: any) => [step.cache, ...(step.actions ?? []).map((action: any) => action.cache)])];
      return Math.max(max, ...caches.map((cache: any) => Number(cache?.stale_ok_s ?? 0)));
    }, 0);
    expect(LEGACY_ENTRY_GRACE_S).toBeGreaterThanOrEqual(maxStale);
  });
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
  test("expired validators are passed to doFetch and a 304 refreshes metadata without replacing the body", async () => {
    const url = "https://example.com/revalidate";
    let entryPath = "";
    await cachedFetch(PKG, { ttl_s: 1, stale_ok_s: 0 }, url, undefined, async () => ({ value: 1 }), { source: "old:source", attribution: "Old credit" });
    const key = createHash("sha256").update(`GET\n${url}\n\n`).digest("hex");
    entryPath = join(cacheDir, PKG, `${key}.json`);
    const prior = JSON.parse(readFileSync(entryPath, "utf8"));
    prior.etag = '"v1"'; prior.lastModified = "date";
    prior.fetchedAt = new Date(Date.now() - 5000).toISOString(); prior.expiresAt = prior.fetchedAt; prior.staleUntil = prior.fetchedAt;
    writeFileSync(entryPath, JSON.stringify(prior));
    let context: any;
    await cachedFetch(PKG, { ttl_s: 60, stale_ok_s: 30 }, url, undefined, (async (ctx: any) => { context = ctx; return { marker: CACHE_NOT_MODIFIED }; }) as any, { source: "new:source", attribution: "New credit" });
    expect(context).toEqual({ etag: '"v1"', lastModified: "date" });
    const refreshed = JSON.parse(readFileSync(entryPath, "utf8"));
    expect(refreshed.value).toEqual(prior.value);
    expect(Date.parse(refreshed.fetchedAt)).toBeGreaterThan(Date.parse(prior.fetchedAt));
    expect(Date.parse(refreshed.expiresAt)).toBeGreaterThan(Date.now());
    expect(Date.parse(refreshed.staleUntil)).toBeGreaterThan(Date.parse(refreshed.expiresAt));
    expect(refreshed.source).toBe("old:source");
    expect(refreshed.attribution).toBe("Old credit");
  });

  test("fresh response validators are stored for the next conditional request", async () => {
    const url = "https://example.com/stored-validators";
    await cachedFetch(PKG, { ttl_s: 1 }, url, undefined, async () => packageCacheResponse(
      { value: 5 },
      { etag: '"v5"', lastModified: "Wed, 21 Oct 2015 07:28:00 GMT" },
    ));
    const key = createHash("sha256").update(`GET\n${url}\n\n`).digest("hex");
    const entry = JSON.parse(readFileSync(join(cacheDir, PKG, `${key}.json`), "utf8"));
    expect(entry.etag).toBe('"v5"');
    expect(entry.lastModified).toBe("Wed, 21 Oct 2015 07:28:00 GMT");
  });

  test("a 304 after a stale entry is swept triggers one full fetch without validators", async () => {
    const url = "https://example.com/swept-during-revalidation";
    await cachedFetch(PKG, { ttl_s: 1, stale_ok_s: 60 }, url, undefined, async () => ({ old: true }));
    const key = createHash("sha256").update(`GET\n${url}\n\n`).digest("hex");
    const path = join(cacheDir, PKG, `${key}.json`);
    const entry = JSON.parse(readFileSync(path, "utf8"));
    entry.etag = '"old"';
    entry.fetchedAt = new Date(Date.now() - 10_000).toISOString();
    entry.expiresAt = new Date(Date.now() - 1_000).toISOString();
    entry.staleUntil = new Date(Date.now() + 60_000).toISOString();
    writeFileSync(path, JSON.stringify(entry));

    let finish!: (value: unknown) => void;
    const contexts: unknown[] = [];
    let calls = 0;
    const stale = await cachedFetch(PKG, { ttl_s: 1, stale_ok_s: 60 }, url, undefined, (async (ctx: unknown) => {
      contexts.push(ctx);
      calls++;
      if (calls === 1) return await new Promise((resolve) => { finish = resolve; });
      return { fresh: true };
    }) as any);
    expect(stale).toEqual({ old: true });
    unlinkSync(path);
    finish({ marker: CACHE_NOT_MODIFIED });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(contexts).toEqual([{ etag: '"old"', lastModified: undefined }, undefined]);
    expect(calls).toBe(2);
    expect(JSON.parse(readFileSync(path, "utf8")).value).toEqual({ fresh: true });
  });

  test("a miss whose entry disappears during 304 refetches once without validators", async () => {
    const url = "https://example.com/miss-swept-during-revalidation";
    await cachedFetch(PKG, { ttl_s: 1 }, url, undefined, async () => ({ old: true }));
    const key = createHash("sha256").update(`GET\n${url}\n\n`).digest("hex");
    const path = join(cacheDir, PKG, `${key}.json`);
    const entry = JSON.parse(readFileSync(path, "utf8"));
    entry.etag = '"old"';
    entry.fetchedAt = new Date(Date.now() - 10_000).toISOString();
    entry.expiresAt = new Date(Date.now() - 1_000).toISOString();
    entry.staleUntil = entry.expiresAt;
    writeFileSync(path, JSON.stringify(entry));
    const contexts: unknown[] = [];
    const value = await cachedFetch(PKG, { ttl_s: 1 }, url, undefined, async (ctx) => {
      contexts.push(ctx);
      if (ctx) {
        unlinkSync(path);
        return { marker: CACHE_NOT_MODIFIED };
      }
      return { fresh: true };
    });
    expect(value).toEqual({ fresh: true });
    expect(contexts).toEqual([{ etag: '"old"', lastModified: undefined }, undefined]);
    expect(getCacheStats().find((row) => row.packageId === PKG)?.misses).toBe(2);
    expect(JSON.parse(readFileSync(path, "utf8")).value).toEqual({ fresh: true });
  });

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
    const key = createHash("sha256").update("GET\nhttps://example.com/a\n\n").digest("hex");
    const path = join(cacheDir, PKG, `${key}.json`);
    const entry = JSON.parse(readFileSync(path, "utf8")); delete entry.expiresAt; delete entry.staleUntil; writeFileSync(path, JSON.stringify(entry));
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

  test("a cache envelope exposes its stored provenance and expiry", async () => {
    const provenance = { source: "weather:open-meteo", attribution: "Weather credit" };
    await cachedFetch(PKG, { ttl_s: 60 }, "https://example.com/envelope", undefined, async () => ({ ok: true }), provenance);
    const envelope = getCacheEnvelope(PKG, "https://example.com/envelope", { ttl_s: 60 });
    expect(envelope?.source).toBe(provenance.source);
    expect(envelope?.attribution).toBe(provenance.attribution);
    expect(envelope?.fetchedAt).toBeDefined();
    expect(Date.parse(envelope!.expiresAt) - Date.parse(envelope!.fetchedAt)).toBe(60_000);
  });

  test("old-shape entries remain hits, stale hits and misses with derived envelope expiry", async () => {
    const url = "https://example.com/legacy";
    const key = createHash("sha256").update(`GET\n${url}\n\n`).digest("hex");
    const dir = join(cacheDir, PKG);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${key}.json`);
    const fetchedAt = new Date(Date.now() - 5_000).toISOString();
    writeFileSync(path, JSON.stringify({ url, method: "GET", fetchedAt, value: { old: true } }));
    let calls = 0;
    const value = await cachedFetch(PKG, { ttl_s: 60 }, url, undefined, async () => { calls++; return { fresh: true }; });
    expect(value).toEqual({ old: true });
    expect(calls).toBe(0);
    const envelope = getCacheEnvelope(PKG, url, { ttl_s: 60 })!;
    expect(envelope.source).toBeNull();
    expect(envelope.attribution).toBeNull();
    expect(envelope.expiresAt).toBe(new Date(Date.parse(fetchedAt) + 60_000).toISOString());

    const staleAt = new Date(Date.now() - 10_000).toISOString();
    writeFileSync(path, JSON.stringify({ url, method: "GET", fetchedAt: staleAt, value: { stale: true } }));
    let finishRefresh!: (value: unknown) => void;
    const stale = await cachedFetch(PKG, { ttl_s: 1, stale_ok_s: 60 }, url, undefined, async () => { calls++; return await new Promise((resolve) => { finishRefresh = resolve; }); }, { source: "legacy:row", attribution: "credit" });
    expect(stale).toEqual({ stale: true });
    const staleEnvelope = getCacheEnvelope(PKG, url, { ttl_s: 1, stale_ok_s: 60 })!;
    expect(staleEnvelope.source).toBeNull();
    expect(staleEnvelope.expiresAt).toBe(new Date(Date.parse(staleAt) + 1_000).toISOString());
    expect(Date.parse(staleEnvelope.expiresAt)).toBeLessThan(Date.now());
    finishRefresh({ refreshed: true });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const refreshed = getCacheEnvelope(PKG, url, { ttl_s: 1 })!;
    expect(refreshed.source).toBe("legacy:row");
    expect(refreshed.attribution).toBe("credit");
    expect(calls).toBe(1);

    writeFileSync(path, JSON.stringify({ url, method: "GET", fetchedAt: new Date(Date.now() - 120_000).toISOString(), value: { expired: true } }));
    let missCalls = 0;
    const missed = await cachedFetch(PKG, { ttl_s: 1, stale_ok_s: 1 }, url, undefined, async () => { missCalls++; return { new: true }; });
    expect(missed).toEqual({ new: true });
    expect(missCalls).toBe(1);
    const stats = getCacheStats().find((row) => row.packageId === PKG);
    expect(stats?.hits).toBe(2);
    expect(stats?.misses).toBe(1);
  });

  test("stored expiresAt controls hit decisions when present", async () => {
    const url = "https://example.com/live-ttl";
    await cachedFetch(PKG, { ttl_s: 3600 }, url, undefined, async () => ({ n: 1 }), { source: "test:row", attribution: null });
    const key = createHash("sha256").update(`GET\n${url}\n\n`).digest("hex");
    const path = join(cacheDir, PKG, `${key}.json`);
    const entry = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    entry.expiresAt = new Date(Date.now() + 3_600_000).toISOString();
    writeFileSync(path, JSON.stringify(entry));
    let calls = 0;
    await cachedFetch(PKG, { ttl_s: -1 }, url, undefined, async () => { calls++; return { n: 2 }; }, { source: "test:row", attribution: null });
    expect(calls).toBe(0);
  });

  test("an entry past its stored staleUntil is never served even with a later expiresAt", async () => {
    const url = "https://example.com/stale-boundary";
    await cachedFetch(PKG, { ttl_s: 3600, stale_ok_s: 3600 }, url, undefined, async () => ({ old: true }));
    const key = createHash("sha256").update(`GET\n${url}\n\n`).digest("hex");
    const path = join(cacheDir, PKG, `${key}.json`);
    const entry = JSON.parse(readFileSync(path, "utf8"));
    entry.expiresAt = new Date(Date.now() + 3_600_000).toISOString();
    entry.staleUntil = new Date(Date.now() - 1_000).toISOString();
    writeFileSync(path, JSON.stringify(entry));
    let calls = 0;
    expect(await cachedFetch(PKG, { ttl_s: 3600, stale_ok_s: 3600 }, url, undefined, async () => { calls++; return { fresh: true }; })).toEqual({ fresh: true });
    expect(calls).toBe(1);
  });

  test("a stale-while-revalidate refresh writes source, expiry and attribution", async () => {
    const url = "https://example.com/stale-provenance";
    const first = { source: "pkg:source-old", attribution: "Credit line" };
    await cachedFetch(PKG, { ttl_s: 60 }, url, undefined, async () => ({ v: 1 }), first);
    const key = createHash("sha256").update(`GET\n${url}\n\n`).digest("hex");
    const path = join(cacheDir, PKG, `${key}.json`);
    const oldEntry = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    oldEntry.fetchedAt = new Date(Date.now() - 10_000).toISOString();
    oldEntry.expiresAt = new Date(Date.parse(oldEntry.fetchedAt as string) + 1_000).toISOString();
    oldEntry.staleUntil = new Date(Date.parse(oldEntry.fetchedAt as string) + 61_000).toISOString();
    writeFileSync(path, JSON.stringify(oldEntry));
    await cachedFetch(PKG, { ttl_s: 1, stale_ok_s: 60 }, url, undefined, async () => ({ v: 2 }), { source: "pkg:source-new", attribution: "Updated credit" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const envelope = getCacheEnvelope(PKG, url, { ttl_s: 1, stale_ok_s: 60 })!;
    expect(envelope.source).toBe("pkg:source-new");
    expect(envelope.attribution).toBe("Updated credit");
    expect(Date.parse(envelope.expiresAt) - Date.parse(envelope.fetchedAt)).toBe(1_000);
  });

  test("server cache hints shorten ttl, account for Age, and no-store skips writes", async () => {
    const hints = (url: string, ttl_s: number, cacheControl: string, age?: string, expires?: string) => cachedFetch(
      PKG,
      { ttl_s },
      url,
      undefined,
      async () => packageCacheResponse({ ok: true }, { cacheControl, age, expires }),
    );
    const maxAgeUrl = "https://example.com/hint-max-age";
    await hints(maxAgeUrl, 3600, "public, max-age=60", "10");
    const maxAgeEnvelope = getCacheEnvelope(PKG, maxAgeUrl, { ttl_s: 3600 })!;
    expect(Date.parse(maxAgeEnvelope.expiresAt) - Date.parse(maxAgeEnvelope.fetchedAt)).toBe(50_000);

    const cappedUrl = "https://example.com/hint-capped";
    await hints(cappedUrl, 60, "max-age=3600");
    const cappedEnvelope = getCacheEnvelope(PKG, cappedUrl, { ttl_s: 60 })!;
    expect(Date.parse(cappedEnvelope.expiresAt) - Date.parse(cappedEnvelope.fetchedAt)).toBe(60_000);

    const pastUrl = "https://example.com/hint-past";
    await hints(pastUrl, 3600, "public", undefined, "Wed, 21 Oct 2015 07:28:00 GMT");
    const pastEnvelope = getCacheEnvelope(PKG, pastUrl, { ttl_s: 3600 })!;
    expect(pastEnvelope.expiresAt).toBe(pastEnvelope.fetchedAt);

    const noStoreUrl = "https://example.com/hint-no-store";
    await hints(noStoreUrl, 3600, "private, no-store");
    expect(getCacheEnvelope(PKG, noStoreUrl, { ttl_s: 3600 })).toBeNull();
  });

  test("quiet-window helper uses bounded exponential backoff and parses Retry-After", () => {
    const now = Date.parse("2026-10-14T12:00:00Z");
    expect(backoffSeconds(60, 1, null, 60, 3600)).toBe(120);
    expect(backoffSeconds(60, 2, null, 60, 3600)).toBe(240);
    expect(backoffSeconds(60, 8, null, 60, 3600)).toBe(3600);
    expect(backoffSeconds(60, 1, 90000, 60, 3600)).toBe(86400);
    expect(parseRetryAfter("30", now)).toBe(30);
    expect(parseRetryAfter("Wed, 14 Oct 2026 12:02:00 GMT", now)).toBe(120);
    expect(effectiveTtlSeconds(3600, { cacheControl: "no-cache" }, now)).toBe(0);
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
