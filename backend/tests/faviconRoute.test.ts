// GET /api/favicon: the HTTP boundary over lib/favicons.ts. Host
// validation is re-verified here through a real request (not just the
// lib-level tests in favicons.test.ts) since that's the actual
// contract a browser hits; the cache-hit test stubs globalThis.fetch
// the same way updates.test.ts's mockGitHubRelease() does, restoring
// it afterward so no other test file's own fetch is affected.
import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __clearFaviconCacheForTests, __setFaviconDnsLookupForTests } from "@/lib/favicons";

beforeEach(() => {
  resetDb();
  __clearFaviconCacheForTests();
  // A fake `*.example.com` test host needs a real DNS answer for
  // assertNotPrivateHost to clear it - stubbed here so this suite stays
  // deterministic and offline instead of depending on live DNS.
  __setFaviconDnsLookupForTests(async () => ({ address: "93.184.216.34", family: 4 }));
});

// The override is module-level state in lib/favicons.ts, not scoped to
// this file - left set, it would silently feed every OTHER test file's
// real hostnames the same fake address for the rest of this `bun test`
// run (packageCache.test.ts's own afterEach comment names the identical
// hazard for its eviction-budget override).
afterEach(() => __setFaviconDnsLookupForTests(null));

async function owner(): Promise<TestClient> {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  return client;
}

function mockImageFetch() {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = mock(() => {
    calls++;
    return Promise.resolve(new Response(new Uint8Array(16), { status: 200, headers: { "content-type": "image/png" } }));
  }) as unknown as typeof fetch;
  return { count: () => calls, restore: () => { globalThis.fetch = originalFetch; } };
}

describe("GET /api/favicon", () => {
  test("not signed in: 401", async () => {
    const client = new TestClient();
    const res = await client.get("/api/favicon?domain=example.com");
    expect(res.status).toBe(401);
  });

  test("rejects an empty domain", async () => {
    const client = await owner();
    const res = await client.get("/api/favicon?domain=");
    expect(res.status).toBe(400);
  });

  test("rejects a domain with a path", async () => {
    const client = await owner();
    const res = await client.get(`/api/favicon?domain=${encodeURIComponent("example.com/x")}`);
    expect(res.status).toBe(400);
  });

  test("rejects localhost", async () => {
    const client = await owner();
    const res = await client.get("/api/favicon?domain=localhost");
    expect(res.status).toBe(400);
  });

  test("rejects a private IP", async () => {
    const client = await owner();
    const res = await client.get(`/api/favicon?domain=${encodeURIComponent("10.0.0.5")}`);
    expect(res.status).toBe(400);
  });

  test("fetches and returns the icon, then serves the second request from cache", async () => {
    const client = await owner();
    const stub = mockImageFetch();
    try {
      const first = await client.get("/api/favicon?domain=route-cache-hit.example.com");
      expect(first.status).toBe(200);
      expect(first.headers.get("content-type")).toBe("image/png");
      expect(stub.count()).toBe(1);

      const second = await client.get("/api/favicon?domain=route-cache-hit.example.com");
      expect(second.status).toBe(200);
      expect(stub.count()).toBe(1); // no second network call
    } finally {
      stub.restore();
    }
  });

  test("no icon: 204", async () => {
    const client = await owner();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => Promise.resolve(new Response(null, { status: 404 }))) as unknown as typeof fetch;
    try {
      const res = await client.get("/api/favicon?domain=route-no-icon.example.com");
      expect(res.status).toBe(204);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
