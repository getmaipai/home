import { describe, expect, test, beforeEach } from "bun:test";
import {
  validateFaviconHost,
  fetchFaviconBytes,
  getFavicon,
  sweepFavicons,
  __setFaviconEntryForTests,
  __getFaviconEntryForTests,
  __clearFaviconCacheForTests,
} from "@/lib/favicons";

beforeEach(() => __clearFaviconCacheForTests());

function pngResponse(bytes: number, contentType = "image/png"): Response {
  return new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": contentType } });
}

describe("validateFaviconHost", () => {
  test("accepts a bare public hostname", async () => {
    const result = await validateFaviconHost("wikipedia.org");
    expect(result).toEqual({ ok: true, host: "wikipedia.org" });
  });

  test("rejects an empty domain", async () => {
    const result = await validateFaviconHost("");
    expect(result.ok).toBe(false);
  });

  test("rejects a path", async () => {
    const result = await validateFaviconHost("wikipedia.org/favicon.ico");
    expect(result.ok).toBe(false);
  });

  test("rejects credentials", async () => {
    const result = await validateFaviconHost("user:pass@wikipedia.org");
    expect(result.ok).toBe(false);
  });

  test("rejects localhost", async () => {
    const result = await validateFaviconHost("localhost");
    expect(result.ok).toBe(false);
  });

  test("rejects a private IP", async () => {
    const result = await validateFaviconHost("192.168.1.1");
    expect(result.ok).toBe(false);
  });

  test("rejects a loopback IP", async () => {
    const result = await validateFaviconHost("127.0.0.1");
    expect(result.ok).toBe(false);
  });
});

describe("fetchFaviconBytes", () => {
  test("returns the first candidate that answers with an image", async () => {
    const calls: string[] = [];
    const fetchFn = async (url: string) => {
      calls.push(url);
      return pngResponse(100);
    };
    const result = await fetchFaviconBytes("example.com", fetchFn);
    expect(result).toEqual({ kind: "found", bytes: expect.any(Uint8Array), contentType: "image/png" });
    expect(calls).toEqual(["https://example.com/favicon.ico"]);
  });

  test("falls back to apple-touch-icon.png when favicon.ico 404s", async () => {
    const calls: string[] = [];
    const fetchFn = async (url: string) => {
      calls.push(url);
      if (url.endsWith("/favicon.ico")) return new Response(null, { status: 404 });
      return pngResponse(50);
    };
    const result = await fetchFaviconBytes("example.com", fetchFn);
    expect(result.kind).toBe("found");
    expect(calls).toEqual(["https://example.com/favicon.ico", "https://example.com/apple-touch-icon.png"]);
  });

  test("a non-image content type is rejected as confirmed-absent, not passed through", async () => {
    const fetchFn = async () => new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } });
    const result = await fetchFaviconBytes("example.com", fetchFn);
    expect(result).toEqual({ kind: "confirmed_absent" });
  });

  test("a body over the 64 KB cap is rejected as confirmed-absent", async () => {
    const fetchFn = async () => pngResponse(64 * 1024 + 1);
    const result = await fetchFaviconBytes("example.com", fetchFn);
    expect(result).toEqual({ kind: "confirmed_absent" });
  });

  test("every candidate answers with a real 404: confirmed-absent, not a throw", async () => {
    const fetchFn = async () => new Response(null, { status: 404 });
    const result = await fetchFaviconBytes("example.com", fetchFn);
    expect(result).toEqual({ kind: "confirmed_absent" });
  });

  test("every candidate answers with a 503: network_failure, not confirmed-absent (the server is in trouble, not the site missing an icon)", async () => {
    const fetchFn = async () => new Response(null, { status: 503 });
    const result = await fetchFaviconBytes("example.com", fetchFn);
    expect(result).toEqual({ kind: "network_failure" });
  });

  test("a connection drop mid-body-read is a network failure, not confirmed-absent, even though headers arrived first", async () => {
    const fetchFn = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("connection reset"));
          },
        }),
        { status: 200, headers: { "content-type": "image/png" } },
      );
    const result = await fetchFaviconBytes("example.com", fetchFn);
    expect(result).toEqual({ kind: "network_failure" });
  });

  test("every candidate times out or fails at the network level: network_failure, not confirmed-absent", async () => {
    const fetchFn = async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    };
    const result = await fetchFaviconBytes("example.com", fetchFn);
    expect(result).toEqual({ kind: "network_failure" });
  });

  test("one candidate answers for real, a later one fails at the network level: still confirmed-absent", async () => {
    const fetchFn = async (url: string) => {
      if (url.endsWith("/favicon.ico")) return new Response(null, { status: 404 });
      throw new Error("timed out");
    };
    const result = await fetchFaviconBytes("example.com", fetchFn);
    expect(result).toEqual({ kind: "confirmed_absent" });
  });
});

describe("getFavicon", () => {
  test("a miss calls through and caches; the next call is served from cache with no fetch", async () => {
    let calls = 0;
    const fetchFn = async () => {
      calls++;
      return pngResponse(10);
    };
    const first = await getFavicon("cache-hit.example.com", fetchFn);
    const second = await getFavicon("cache-hit.example.com", fetchFn);
    expect(first.found).toBe(true);
    expect(second.found).toBe(true);
    expect(calls).toBe(1);
  });

  test("a confirmed absence is also cached, so a favicon-less site is asked once", async () => {
    let calls = 0;
    const fetchFn = async () => {
      calls++;
      return new Response(null, { status: 404 });
    };
    const first = await getFavicon("no-icon.example.com", fetchFn);
    const second = await getFavicon("no-icon.example.com", fetchFn);
    expect(first.found).toBe(false);
    expect(second.found).toBe(false);
    // The first call tries both candidates (favicon.ico, then
    // apple-touch-icon.png) before giving up; the second call is a
    // cache hit and makes no network call at all.
    expect(calls).toBe(2);
  });

  test("a network failure (timeout, DNS) is never cached - the next call retries for real", async () => {
    let calls = 0;
    const fetchFn = async () => {
      calls++;
      throw new Error("getaddrinfo ENOTFOUND");
    };
    const first = await getFavicon("flaky.example.com", fetchFn);
    const second = await getFavicon("flaky.example.com", fetchFn);
    expect(first.found).toBe(false);
    expect(second.found).toBe(false);
    // Both calls hit the network for real (2 candidates each) - unlike
    // the confirmed-absence case above, nothing here was ever cached.
    expect(calls).toBe(4);
    expect(__getFaviconEntryForTests("flaky.example.com")).toBeUndefined();
  });
});

describe("sweepFavicons", () => {
  test("an entry unused for over 30 days is swept; a fresh one stays", () => {
    const now = new Date("2026-09-22T00:00:00.000Z");
    __setFaviconEntryForTests("stale.example.com", { ext: "png", contentType: "image/png", bytes: 10, lastUsedAt: "2026-08-01T00:00:00.000Z" });
    __setFaviconEntryForTests("fresh.example.com", { ext: "png", contentType: "image/png", bytes: 10, lastUsedAt: "2026-09-21T00:00:00.000Z" });

    const result = sweepFavicons(now);

    expect(result.expired).toBe(1);
    expect(__getFaviconEntryForTests("stale.example.com")).toBeUndefined();
    expect(__getFaviconEntryForTests("fresh.example.com")).toBeDefined();
  });

  test("over the 20 MB cap: oldest-unused entries are evicted until back under budget", () => {
    const now = new Date("2026-09-22T00:00:00.000Z");
    const big = 8 * 1024 * 1024; // 8 MB each, three of them tips 20 MB
    __setFaviconEntryForTests("a.example.com", { ext: "png", contentType: "image/png", bytes: big, lastUsedAt: "2026-09-19T00:00:00.000Z" });
    __setFaviconEntryForTests("b.example.com", { ext: "png", contentType: "image/png", bytes: big, lastUsedAt: "2026-09-20T00:00:00.000Z" });
    __setFaviconEntryForTests("c.example.com", { ext: "png", contentType: "image/png", bytes: big, lastUsedAt: "2026-09-21T00:00:00.000Z" });

    const result = sweepFavicons(now);

    expect(result.evicted).toBeGreaterThan(0);
    // The oldest-unused entry is the one that goes first.
    expect(__getFaviconEntryForTests("a.example.com")).toBeUndefined();
    expect(__getFaviconEntryForTests("c.example.com")).toBeDefined();
  });
});
