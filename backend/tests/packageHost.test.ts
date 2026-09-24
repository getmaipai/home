import { describe, expect, test, beforeEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { createHost, performHttpFetch, withOneRetry, formatSearxngResults, parseReadablePage, searxngSearch, __resetSearxngEnginesCacheForTests, __resetSearchCacheForTests, type AttemptResult } from "@/lib/packageHost";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { cachedFetch, __resetPackageCacheForTests, __clearPackageCacheDirForTests } from "@/lib/packageCache";
import { assertNotPrivateHost } from "@maipai/core/src/ssrfGuard";
import { setHouseholdSettingValue, setValue } from "@/lib/settings";
import { HostError } from "@maipai/spec/emulators/ts/host-emulator.js";
import { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import { db } from "@/db";
import { people, memoryRecords, scheduledJobs, lists } from "@/db/schema";
import { eq } from "drizzle-orm";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { remember } from "@/lib/memory";
import { listIssues } from "@/lib/issues";

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
  __resetLlmSupervisorForTests();
  // SEARCH-PACE-01: the searxng rate limit tightened to {capacity: 3,
  // refillPerSecond: 1/6} (from {10, 0.5}) - this file's own many
  // sequential real-searxng tests shared one bucket with no reset
  // between them, fine under the old, looser budget and flaky under
  // the new one. Every other caller here already resets explicitly
  // right before it needs to (a no-op, called twice); this just makes
  // every test start with a full bucket regardless of run order.
  __resetRateLimiterForTests();
  __resetSearchCacheForTests();
});

function manifest(overrides: Partial<PackageManifest> = {}): PackageManifest {
  return PackageManifest.parse({
    id: "test-pkg",
    version: "0.1.0",
    kind: "plugin",
    category: "Utilities",
    display: "Test",
    description: "A test package.",
    author: "test",
    license: "AGPL-3.0",
    platforms: ["home"],
    min_role: "child",
    consequential: false,
    offline: "full",
    min_app: "0.1.0",
    tier: 0,
    permissions: [],
    ...overrides,
  });
}

async function owner() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const row = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  return row;
}

function seedMemory(actor: Awaited<ReturnType<typeof owner>>, text: string, person: string | null, scope = "person") {
  const result = remember(actor, {
    text,
    category: "fact",
    tier: "durable",
    scope,
    person,
    source: "test",
    importance: 0.5,
  });
  if (!result.ok) throw new Error(result.error);
  return result.value.id;
}

describe("packageHost memory.remember", () => {
  // CHAT-03: the one content policy reaches a package's own write too.
  test("a credential is refused with the fixed line, and nothing is stored", async () => {
    const actor = await owner();
    const host = createHost(actor, manifest({ permissions: ["memory:write"] }));
    const value = `Jun${"i".repeat(2)}per${20}26`;
    expect(() => host.memory.remember(`the wifi password is ${value}`, "fact", "household")).toThrow(HostError);
    try {
      host.memory.remember(`the wifi password is ${value}`, "fact", "household");
    } catch (err) {
      expect((err as Error).message).toContain("Keep passwords and keys in Credentials");
    }
    expect(db.select().from(memoryRecords).all().some((r) => r.text.includes(value))).toBe(false);
  });

  test("writes through to the real memory store when permitted", async () => {
    const actor = await owner();
    const host = createHost(actor, manifest({ permissions: ["memory:write"] }));
    const id = host.memory.remember("the wifi password is on the fridge", "fact", "household");
    expect(typeof id).toBe("string");

    const listed = await createHost(actor, manifest({ permissions: ["memory:read"] })).memory.recall("wifi password");
    expect(listed.some((r) => r.text.includes("wifi password"))).toBe(true);
  });

  test("throws permission_denied when the manifest didn't declare memory:write", async () => {
    const actor = await owner();
    const host = createHost(actor, manifest({ permissions: [] }));
    expect(() => host.memory.remember("nope", "fact", "household")).toThrow(HostError);
    try {
      host.memory.remember("nope", "fact", "household");
    } catch (err) {
      expect(err).toBeInstanceOf(HostError);
      expect((err as HostError).code).toBe("permission_denied");
    }
  });

  // Step 2: when a recipe step leaves `scope` unset (backend/packages/
  // remember/recipe.json now does), the host auto-detects first-person
  // scope instead of always defaulting to household.
  test("no scope given, first-person text: writes scope person attributed to the actor", async () => {
    const actor = await owner();
    const host = createHost(actor, manifest({ permissions: ["memory:write"] }));
    const id = host.memory.remember("I'm allergic to peanuts", "fact");
    const row = db.select().from(memoryRecords).where(eq(memoryRecords.id, id)).get()!;
    expect(row.scope).toBe("person");
    expect(row.person).toBe(actor.id);
  });

  // A code review (2026-09-05) found the plain word-boundary check
  // misattributed a THIRD PARTY's fact to the speaker's own private
  // scope: "my sister's allergy" contains "my", so it wrote person scope
  // for the actor, filing the sister's allergy as the parent's own secret.
  test("a third party's possessive ('my <noun>'s ...') does not trigger first-person scope on its own", async () => {
    const actor = await owner();
    const host = createHost(actor, manifest({ permissions: ["memory:write"] }));
    const id = host.memory.remember("my sister's allergy is peanuts", "fact");
    const row = db.select().from(memoryRecords).where(eq(memoryRecords.id, id)).get()!;
    expect(row.scope).toBe("household");
  });

  test("no scope given, no first-person marker: still defaults to household, unchanged", async () => {
    const actor = await owner();
    const host = createHost(actor, manifest({ permissions: ["memory:write"] }));
    const id = host.memory.remember("Friday is pizza night", "fact");
    const row = db.select().from(memoryRecords).where(eq(memoryRecords.id, id)).get()!;
    expect(row.scope).toBe("household");
    expect(row.person).toBeNull();
  });

  test("an explicit scope from the recipe step always wins over auto-detection", async () => {
    const actor = await owner();
    const host = createHost(actor, manifest({ permissions: ["memory:write"] }));
    const id = host.memory.remember("I'm allergic to peanuts", "fact", "household");
    const row = db.select().from(memoryRecords).where(eq(memoryRecords.id, id)).get()!;
    expect(row.scope).toBe("household");
  });

  // Step 2 provenance: source is the turn id when createHost() was given
  // one, never `package:<id>` in that case (the schema has no second
  // field for the package id, see createHost()'s own comment).
  test("with a turnId, source is the turn id, not the package id", async () => {
    const actor = await owner();
    const host = createHost(actor, manifest({ permissions: ["memory:write"] }), [], { id: "turn-faketest01" });
    const id = host.memory.remember("the calendar rule about pizza night", "fact", "household");
    const row = db.select().from(memoryRecords).where(eq(memoryRecords.id, id)).get()!;
    expect(row.source).toBe("turn-faketest01");
  });

  test("with no turnId, source falls back to the package id, unchanged", async () => {
    const actor = await owner();
    const host = createHost(actor, manifest({ permissions: ["memory:write"] }));
    const id = host.memory.remember("the calendar rule about pizza night", "fact", "household");
    const row = db.select().from(memoryRecords).where(eq(memoryRecords.id, id)).get()!;
    expect(row.source).toBe("package:test-pkg");
  });

  test("memory.recall defaults to the actor's own person facts and household facts", async () => {
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const actor = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
    const childRes = await client.post("/api/people", { displayName: "Bramble", role: "child" });
    const child = (await childRes.json()) as { id: string };
    const own = seedMemory(actor, "I dislike cilantro", actor.id);
    const sibling = seedMemory(actor, "Bramble dislikes cilantro", child.id);
    const shared = seedMemory(actor, "The household buys cilantro on Fridays", null, "household");
    const host = createHost(actor, manifest({ permissions: ["memory:read"] }));

    const found = await host.memory.recall("cilantro");
    expect(found.map((r) => r.id)).toEqual(expect.arrayContaining([own, shared]));
    expect(found.map((r) => r.id)).not.toContain(sibling);
  });

  test("memory.recall refuses an explicit request for another person's facts", async () => {
    const actor = await owner();
    const host = createHost(actor, manifest({ permissions: ["memory:read"] }));
    await expect(host.memory.recall("allergies", { person: "person-other" })).rejects.toMatchObject({ code: "permission_denied" });
  });
});

describe("packageHost log()", () => {
  test("redacts a registered secret from both message and fields", async () => {
    const actor = await owner();
    const secret = "sk-marker-42";
    const host = createHost(actor, manifest(), [secret]);
    const originalLog = console.log;
    const lines: string[] = [];
    console.log = (line: string) => lines.push(line);
    try {
      host.log("info", `used token ${secret}`, { token: secret, nested: { token: secret } });
    } finally {
      console.log = originalLog;
    }
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(secret);
    expect(lines[0]).toContain("[redacted]");
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.fields.nested.token).toBe("[redacted]");
  });
});

describe("packageHost fetch", () => {
  // Found by review: new URL() ran before the permission check and
  // before any try/catch, so a malformed url threw a raw TypeError
  // instead of a HostError, breaking "the host wraps errors so a
  // package cannot throw an unmapped one past the boundary."
  test("a malformed url raises HostError invalid_input, not a raw TypeError", async () => {
    const actor = await owner();
    const host = createHost(actor, manifest({ permissions: [] }));
    await expect(host.fetch("not a url")).rejects.toThrow(HostError);
    try {
      await host.fetch("not a url");
    } catch (err) {
      expect((err as HostError).code).toBe("invalid_input");
    }
  });

  test("an unsupported scheme (e.g. file://) is refused before any network attempt", async () => {
    const actor = await owner();
    const host = createHost(actor, manifest({ permissions: ["net:etc"] }));
    try {
      await host.fetch("file:///etc/passwd");
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as HostError).code).toBe("invalid_input");
    }
  });

  test("a permission not declared in the manifest is refused before any network attempt", async () => {
    const actor = await owner();
    const host = createHost(actor, manifest({ permissions: [] }));
    try {
      await host.fetch("https://example.com/weather");
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as HostError).code).toBe("permission_denied");
    }
  });

  // The real SSRF guard (lib/ssrfGuard.ts) has its own dedicated,
  // deterministic test file; this just proves createHost() actually
  // wires it in, using a loopback literal (no DNS needed either way).
  test("a loopback target is refused even with the right permission declared", async () => {
    const actor = await owner();
    const host = createHost(actor, manifest({ permissions: ["net:127.0.0.1:9"] }));
    try {
      await host.fetch("http://127.0.0.1:9/");
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as HostError).code).toBe("invalid_input");
      expect((err as HostError).message).toContain("private");
    }
  });

  test("the per-host rate limit is real: enough calls in a burst eventually get rate_limited", async () => {
    __resetRateLimiterForTests();
    const actor = await owner();
    // A loopback target, deliberately: it will always fail its own SSRF
    // check, but the rate limiter runs BEFORE that (packageHost.ts's own
    // comment on why), so the first few calls fail with invalid_input
    // (the real SSRF block) and only calls past the burst capacity ever
    // see rate_limited - proving the limiter's real position in the
    // chain, not just that it exists somewhere.
    const host = createHost(actor, manifest({ permissions: ["net:127.0.0.1:9"] }));
    const codes: string[] = [];
    for (let i = 0; i < 8; i++) {
      try {
        await host.fetch("http://127.0.0.1:9/");
      } catch (err) {
        codes.push((err as HostError).code);
      }
    }
    expect(codes).toContain("rate_limited");
  });
});

describe("packageHost fetch, cache-aware (session-d-packages-and-store.md step 3)", () => {
  test("a cache hit for a declared cache policy skips rate-limit and SSRF entirely", async () => {
    __resetRateLimiterForTests();
    __resetPackageCacheForTests();
    __clearPackageCacheDirForTests("test-pkg");
    const actor = await owner();
    const cacheManifest = manifest({ permissions: ["net:127.0.0.1:9"], cache: { ttl_s: 60 } });
    // Pre-seeds the exact (package id, url) cachedFetch() would key on,
    // bypassing the network entirely - proving createHost()'s fetch()
    // really threads manifest.id/manifest.cache into cachedFetch() the
    // same way a real warm run's first successful fetch would populate
    // it, WITHOUT this test needing a live server. 127.0.0.1:9 is a
    // target that would fail both the rate limiter (after enough calls)
    // and the SSRF guard on a real attempt - if either fired here, this
    // test would fail with the wrong error instead of returning the
    // cached value, proving the cache really sits in front of both.
    await cachedFetch(cacheManifest.id, cacheManifest.cache, "http://127.0.0.1:9/cached", undefined, async () => ({
      ok: true,
    }));
    const host = createHost(actor, cacheManifest);
    const result = await host.fetch("http://127.0.0.1:9/cached");
    expect(result).toEqual({ ok: true });
  });

  test("no cache policy declared: the manifest's own permission/SSRF/rate-limit path is unaffected", async () => {
    __resetRateLimiterForTests();
    __resetPackageCacheForTests();
    const actor = await owner();
    const host = createHost(actor, manifest({ permissions: ["net:127.0.0.1:9"] }));
    try {
      await host.fetch("http://127.0.0.1:9/uncached");
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as HostError).code).toBe("invalid_input");
      expect((err as HostError).message).toContain("private");
    }
  });
});

describe("performHttpFetch (the real HTTP mechanics, no SSRF/permission/rate-limit concern of its own)", () => {
  test("a successful JSON response is parsed and returned", async () => {
    const server = Bun.serve({ port: 0, fetch: () => Response.json({ tempF: 72 }) });
    try {
      const result = await performHttpFetch(`http://127.0.0.1:${server.port}/weather`);
      expect(result).toEqual({ tempF: 72 });
    } finally {
      server.stop(true);
    }
  });

  test("a plain-text response is returned as text, not a JSON-parse failure", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response("just plain text") });
    try {
      const result = await performHttpFetch(`http://127.0.0.1:${server.port}/`);
      expect(result).toBe("just plain text");
    } finally {
      server.stop(true);
    }
  });

  test("sends the real user-agent and any caller-supplied headers", async () => {
    let seenUserAgent = "";
    let seenCustom = "";
    const server = Bun.serve({
      port: 0,
      fetch: (req) => {
        seenUserAgent = req.headers.get("user-agent") ?? "";
        seenCustom = req.headers.get("x-custom") ?? "";
        return Response.json({ ok: true });
      },
    });
    try {
      await performHttpFetch(`http://127.0.0.1:${server.port}/`, { headers: { "x-custom": "value" } });
      expect(seenUserAgent).toContain("MaiPai-Home");
      expect(seenCustom).toBe("value");
    } finally {
      server.stop(true);
    }
  });

  test("a non-2xx response raises HostError network_unreachable, not a silently-returned error body", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response("nope", { status: 503 }) });
    try {
      await expect(performHttpFetch(`http://127.0.0.1:${server.port}/`)).rejects.toThrow(HostError);
    } finally {
      server.stop(true);
    }
  });

  test("a 404 is the typed not_found, never network_unreachable: the host answered and the resource does not exist (#92)", async () => {
    const server = Bun.serve({ port: 0, fetch: (req) => new Response("nope", { status: new URL(req.url).pathname === "/gone" ? 410 : 404 }) });
    try {
      for (const path of ["/missing", "/gone"]) {
        try {
          await performHttpFetch(`http://127.0.0.1:${server.port}${path}`);
          throw new Error("should have thrown");
        } catch (err) {
          expect(err).toBeInstanceOf(HostError);
          expect((err as HostError).code).toBe("not_found");
        }
      }
    } finally {
      server.stop(true);
    }
  });

  test("an oversized response raises HostError rather than being silently truncated", async () => {
    const oversized = "x".repeat(2_100_000);
    const server = Bun.serve({ port: 0, fetch: () => new Response(oversized) });
    try {
      try {
        await performHttpFetch(`http://127.0.0.1:${server.port}/`);
        throw new Error("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(HostError);
        expect((err as HostError).code).toBe("network_unreachable");
      }
    } finally {
      server.stop(true);
    }
  });

  test("an unreachable host raises HostError network_unreachable, never a raw fetch TypeError", async () => {
    // Port 0 is never a real listening port to connect to.
    await expect(performHttpFetch("http://127.0.0.1:0/")).rejects.toThrow(HostError);
  });

  // A code review (2026-09-05) found the size cap was checked AFTER
  // response.text() had already buffered the entire body into memory,
  // so a large or malicious response fully materialized every time
  // regardless of the cap - the streaming rewrite reads and counts real
  // bytes as they arrive, aborting the read itself once the limit is
  // crossed rather than after the fact. This proves the limit is
  // enforced in bytes, not text.length's UTF-16 code units, which would
  // undercount a multi-byte-heavy body against a byte-named limit.
  test("the size cap counts real bytes, not UTF-16 code units - a multi-byte-heavy body over the byte limit is still rejected", async () => {
    // Each euro sign is 1 UTF-16 code unit but 3 UTF-8 bytes: this body's
    // CODE UNIT count (1,000,000) is comfortably UNDER the 2,000,000-byte
    // cap - a text.length-based check would wrongly let it through - but
    // its real BYTE count (3,000,000) is over it.
    const codeUnitCount = 1_000_000;
    const oversizedInBytes = "€".repeat(codeUnitCount); // 1,000,000 code units, 3,000,000 real bytes
    const server = Bun.serve({ port: 0, fetch: () => new Response(oversizedInBytes) });
    try {
      await expect(performHttpFetch(`http://127.0.0.1:${server.port}/`)).rejects.toThrow(HostError);
    } finally {
      server.stop(true);
    }
  });

  test("a POST with a plain object body is sent as JSON with a content-type header", async () => {
    let seenContentType = "";
    let seenBody = "";
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        seenContentType = req.headers.get("content-type") ?? "";
        seenBody = await req.text();
        return Response.json({ ok: true });
      },
    });
    try {
      await performHttpFetch(`http://127.0.0.1:${server.port}/`, { method: "POST", body: { a: 1 } });
      expect(seenContentType).toContain("application/json");
      expect(seenBody).toBe(JSON.stringify({ a: 1 }));
    } finally {
      server.stop(true);
    }
  });

  // A code review (2026-09-05) found the "does the caller already have a
  // content-type header" check was case-sensitive, so a caller-supplied
  // "Content-Type" (capitalized, as most real code writes it) went
  // undetected and a second, lowercase "content-type" got appended
  // alongside it - two content-type headers on the same request.
  test("a caller-supplied Content-Type header (any casing) is respected, never duplicated", async () => {
    let seenContentType = "";
    const server = Bun.serve({
      port: 0,
      fetch: (req) => {
        seenContentType = req.headers.get("content-type") ?? "";
        return Response.json({ ok: true });
      },
    });
    try {
      await performHttpFetch(`http://127.0.0.1:${server.port}/`, {
        method: "POST",
        headers: { "Content-Type": "application/x-custom" },
        body: { a: 1 },
      });
    } finally {
      server.stop(true);
    }
    // A real Headers object folds two same-named headers into one
    // comma-joined value ("application/x-custom, application/json") -
    // exactly single, unjoined value here proves only one was ever sent.
    expect(seenContentType).toBe("application/x-custom");
  });

  // SEC-3 (code review, 2026-09-06): fetch's default redirect: "follow"
  // meant a redirect's own target never passed through the caller's SSRF/
  // permission check at all - only the original url did. Switched to
  // redirect: "manual" plus a manual loop that calls `validateHop` (the
  // caller's own check, real createHost() callers pass
  // assertNotPrivateHost + requirePermission) against every hop's target
  // before following it.
  describe("redirects (SEC-3)", () => {
    test("a redirect is still followed end to end when nothing blocks it", async () => {
      const target = Bun.serve({ port: 0, fetch: () => Response.json({ ok: true }) });
      const origin = Bun.serve({
        port: 0,
        fetch: () => new Response(null, { status: 302, headers: { Location: `http://127.0.0.1:${target.port}/` } }),
      });
      try {
        const result = await performHttpFetch(`http://127.0.0.1:${origin.port}/start`);
        expect(result).toEqual({ ok: true });
      } finally {
        origin.stop(true);
        target.stop(true);
      }
    });

    test("validateHop is called with the redirect's OWN target url, not the original", async () => {
      const target = Bun.serve({ port: 0, fetch: () => Response.json({ ok: true }) });
      const origin = Bun.serve({
        port: 0,
        fetch: () => new Response(null, { status: 302, headers: { Location: `http://127.0.0.1:${target.port}/secret` } }),
      });
      const seenHops: string[] = [];
      try {
        await performHttpFetch(`http://127.0.0.1:${origin.port}/start`, undefined, async (hopUrl) => {
          seenHops.push(hopUrl);
        });
        expect(seenHops).toEqual([`http://127.0.0.1:${target.port}/secret`]);
      } finally {
        origin.stop(true);
        target.stop(true);
      }
    });

    test("a redirect landing on a private/loopback target is refused, never followed", async () => {
      const origin = Bun.serve({
        port: 0,
        fetch: () => new Response(null, { status: 302, headers: { Location: "http://127.0.0.1:9/secret" } }),
      });
      const validateHop = async (hopUrl: string): Promise<void> => {
        await assertNotPrivateHost(new URL(hopUrl).hostname).catch((err: unknown) => {
          throw new HostError("invalid_input", (err as Error).message);
        });
      };
      try {
        await expect(performHttpFetch(`http://127.0.0.1:${origin.port}/start`, undefined, validateHop)).rejects.toThrow(HostError);
      } finally {
        origin.stop(true);
      }
    });

    test("more than the redirect cap is refused, not followed forever", async () => {
      const origin = Bun.serve({
        port: 0,
        fetch: (req) => {
          const url = new URL(req.url);
          const hop = Number(url.pathname.slice(1)) || 0;
          return new Response(null, { status: 302, headers: { Location: `/${hop + 1}` } });
        },
      });
      try {
        await expect(performHttpFetch(`http://127.0.0.1:${origin.port}/0`)).rejects.toThrow(HostError);
      } finally {
        origin.stop(true);
      }
    });
  });
});

// A real, live-verified reliability gap found building the `define`
// plugin (2026-09-05): a real public API (dictionaryapi.dev) failed
// roughly half the time in rigorous back-to-back testing tonight - a
// real third-party host being unreliable, not a bug in host.fetch's own
// networking. The retry POLICY is tested here in complete isolation
// (a fake `attempt`, a near-zero delayMs) rather than against a real
// flaky host or a real 10-second timeout, so these stay fast and
// deterministic while still proving the exact behavior that mattered
// live: a genuine network failure gets one real second chance, nothing
// else does.
describe("withOneRetry", () => {
  function ok(value: unknown): AttemptResult {
    return { ok: true, value };
  }
  function networkFailure(): AttemptResult {
    return { ok: false, networkFailure: true, error: new HostError("network_unreachable", "simulated network failure") };
  }
  function httpError(): AttemptResult {
    return { ok: false, networkFailure: false, error: new HostError("network_unreachable", "simulated HTTP 404") };
  }

  test("a network failure followed by success recovers on the retry - the exact case dictionaryapi.dev's own flakiness needed", async () => {
    let calls = 0;
    const attempt = () => {
      calls++;
      return Promise.resolve(calls === 1 ? networkFailure() : ok("recovered"));
    };
    const result = await withOneRetry(attempt, true, 1);
    expect(result).toEqual({ ok: true, value: "recovered" });
    expect(calls).toBe(2);
  });

  test("two network failures in a row still fail, after exactly one retry - not an infinite or unbounded loop", async () => {
    let calls = 0;
    const attempt = () => {
      calls++;
      return Promise.resolve(networkFailure());
    };
    const result = await withOneRetry(attempt, true, 1);
    expect(result.ok).toBe(false);
    expect(calls).toBe(2);
  });

  test("a real HTTP error response (not a network failure) is never retried - asking again can't change a server's real answer", async () => {
    let calls = 0;
    const attempt = () => {
      calls++;
      return Promise.resolve(httpError());
    };
    const result = await withOneRetry(attempt, true, 1);
    expect(result.ok).toBe(false);
    expect(calls).toBe(1);
  });

  test("a non-idempotent method (retryable=false, the real caller's POST case) is never retried even on a genuine network failure", async () => {
    let calls = 0;
    const attempt = () => {
      calls++;
      return Promise.resolve(networkFailure());
    };
    const result = await withOneRetry(attempt, false, 1);
    expect(result.ok).toBe(false);
    expect(calls).toBe(1);
  });

  test("success on the first try never even considers a retry", async () => {
    let calls = 0;
    const attempt = () => {
      calls++;
      return Promise.resolve(ok("first try"));
    };
    const result = await withOneRetry(attempt, true, 1);
    expect(result).toEqual({ ok: true, value: "first try" });
    expect(calls).toBe(1);
  });
});

describe("home.call_service (2026-09-05, the real Home Assistant integration)", () => {
  test("throws permission_denied when the manifest didn't declare home:<domain>", async () => {
    const actor = await owner();
    const host = createHost(actor, manifest({ permissions: [] }));
    await expect(host.home.call_service("light", "turn_off", {})).rejects.toThrow(HostError);
  });

  test("a security domain (lock) additionally requires consequential: true, even with home:lock declared", async () => {
    const actor = await owner();
    const host = createHost(actor, manifest({ permissions: ["home:lock"], consequential: false }));
    let code = "";
    try {
      await host.home.call_service("lock", "unlock", { entity_id: "lock.front_door" });
    } catch (err) {
      code = (err as HostError).code;
    }
    expect(code).toBe("permission_denied");
  });

  // A review (2026-09-05) found the security-domain check compared the
  // called domain against HOME_ASSISTANT_SECURITY_DOMAINS's lowercase-only
  // entries with no normalization, while requirePermission matched
  // whatever exact casing the manifest declared - a manifest declaring
  // "home:Lock" (non-canonical casing) and calling with matching casing
  // could skip the consequential:true requirement entirely. Fixed by
  // lowercasing the domain once, used for every decision.
  test("the security-domain check isn't bypassed by non-lowercase domain casing", async () => {
    const actor = await owner();
    const host = createHost(actor, manifest({ permissions: ["home:lock"], consequential: false }));
    let code = "";
    try {
      await host.home.call_service("Lock", "unlock", { entity_id: "lock.front_door" });
    } catch (err) {
      code = (err as HostError).code;
    }
    expect(code).toBe("permission_denied");
  });

  test("a security domain (lock) call succeeds once consequential: true is declared", async () => {
    const server = Bun.serve({ port: 0, fetch: () => Response.json({ context: { id: "abc" } }) });
    try {
      const actor = await owner();
      setHouseholdSettingValue("home.base_url", `http://127.0.0.1:${server.port}`);
      setHouseholdSettingValue("home.access_token", "test-token");
      const host = createHost(actor, manifest({ permissions: ["home:lock"], consequential: true }));
      await host.home.call_service("lock", "unlock", { entity_id: "lock.front_door" });
    } finally {
      server.stop(true);
    }
  });

  test("a non-security domain (light) never needs consequential: true", async () => {
    const actor = await owner();
    setHouseholdSettingValue("home.base_url", "http://127.0.0.1:1"); // deliberately unreachable
    setHouseholdSettingValue("home.access_token", "test-token");
    const host = createHost(actor, manifest({ permissions: ["home:light"], consequential: false }));
    let code = "";
    try {
      await host.home.call_service("light", "turn_off", { entity_id: "light.kitchen" });
    } catch (err) {
      code = (err as HostError).code; // fails on the network, not on a bogus consequential requirement
    }
    expect(code).toBe("network_unreachable");
  });

  test("a clear, actionable error when Home Assistant isn't configured yet - not a confusing network error", async () => {
    const actor = await owner();
    setHouseholdSettingValue("home.base_url", "");
    setHouseholdSettingValue("home.access_token", "");
    const host = createHost(actor, manifest({ permissions: ["home:light"] }));
    let code = "";
    try {
      await host.home.call_service("light", "turn_off", {});
    } catch (err) {
      code = (err as HostError).code;
    }
    expect(code).toBe("invalid_input");
  });

  test("calls the real Home Assistant REST shape: POST /api/services/<domain>/<service>, bearer token, target+data merged into the body", async () => {
    let seenPath = "";
    let seenAuth = "";
    let seenBody: unknown = null;
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        seenPath = new URL(req.url).pathname;
        seenAuth = req.headers.get("authorization") ?? "";
        seenBody = await req.json();
        return Response.json({ context: { id: "abc" } });
      },
    });
    try {
      const actor = await owner();
      setHouseholdSettingValue("home.base_url", `http://127.0.0.1:${server.port}`);
      setHouseholdSettingValue("home.access_token", "test-token");
      const host = createHost(actor, manifest({ permissions: ["home:light"] }));
      await host.home.call_service("light", "turn_on", { entity_id: "light.kitchen" }, { brightness_pct: 50 });
      expect(seenPath).toBe("/api/services/light/turn_on");
      expect(seenAuth).toBe("Bearer test-token");
      expect(seenBody).toEqual({ entity_id: "light.kitchen", brightness_pct: 50 });
    } finally {
      server.stop(true);
    }
  });

  test("a non-2xx response raises HostError, not a silently-swallowed failure", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response("not found", { status: 404 }) });
    try {
      const actor = await owner();
      setHouseholdSettingValue("home.base_url", `http://127.0.0.1:${server.port}`);
      setHouseholdSettingValue("home.access_token", "test-token");
      const host = createHost(actor, manifest({ permissions: ["home:light"] }));
      await expect(host.home.call_service("light", "turn_on", {})).rejects.toThrow(HostError);
    } finally {
      server.stop(true);
    }
  });

  test("never retries - a service call is a real action, not an idempotent GET", async () => {
    let calls = 0;
    const server = Bun.serve({
      port: 0,
      fetch: () => {
        calls++;
        return new Response("boom", { status: 500 });
      },
    });
    try {
      const actor = await owner();
      setHouseholdSettingValue("home.base_url", `http://127.0.0.1:${server.port}`);
      setHouseholdSettingValue("home.access_token", "test-token");
      const host = createHost(actor, manifest({ permissions: ["home:light"] }));
      await expect(host.home.call_service("light", "turn_on", {})).rejects.toThrow(HostError);
      expect(calls).toBe(1);
    } finally {
      server.stop(true);
    }
  });
});

describe("integration.call (session-d-packages-and-store.md step 4)", () => {
  test("throws permission_denied when the manifest didn't declare integration:<id>", async () => {
    const actor = await owner();
    const host = createHost(actor, manifest({ permissions: [] }));
    await expect(host.integration.call("home_assistant", "get_state", { entity_id: "light.porch" })).rejects.toThrow(
      HostError,
    );
  });

  test("home_assistant get_state: a real GET to /api/states/<entity_id>, parsed as JSON", async () => {
    let seenPath = "";
    let seenAuth = "";
    const server = Bun.serve({
      port: 0,
      fetch: (req) => {
        seenPath = new URL(req.url).pathname;
        seenAuth = req.headers.get("authorization") ?? "";
        return Response.json({ entity_id: "light.porch", state: "on" });
      },
    });
    try {
      const actor = await owner();
      setHouseholdSettingValue("home.base_url", `http://127.0.0.1:${server.port}`);
      setHouseholdSettingValue("home.access_token", "test-token");
      const host = createHost(actor, manifest({ permissions: ["integration:home_assistant"] }));
      const result = await host.integration.call("home_assistant", "get_state", { entity_id: "light.porch" });
      expect(seenPath).toBe("/api/states/light.porch");
      expect(seenAuth).toBe("Bearer test-token");
      expect(result).toEqual({ entity_id: "light.porch", state: "on" });
    } finally {
      server.stop(true);
    }
  });

  test("home_assistant get_state without entity_id raises invalid_input before any network attempt", async () => {
    const actor = await owner();
    const host = createHost(actor, manifest({ permissions: ["integration:home_assistant"] }));
    try {
      await host.integration.call("home_assistant", "get_state", {});
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as HostError).code).toBe("invalid_input");
    }
  });

  test("home_assistant get_state isn't set up yet: invalid_input, the same message home.call_service gives", async () => {
    const actor = await owner();
    const host = createHost(actor, manifest({ permissions: ["integration:home_assistant"] }));
    try {
      await host.integration.call("home_assistant", "get_state", { entity_id: "light.porch" });
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as HostError).code).toBe("invalid_input");
      expect((err as HostError).message).toContain("isn't set up yet");
    }
  });

  test("a 404 from Home Assistant maps to not_found", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response("not found", { status: 404 }) });
    try {
      const actor = await owner();
      setHouseholdSettingValue("home.base_url", `http://127.0.0.1:${server.port}`);
      setHouseholdSettingValue("home.access_token", "test-token");
      const host = createHost(actor, manifest({ permissions: ["integration:home_assistant"] }));
      try {
        await host.integration.call("home_assistant", "get_state", { entity_id: "light.nonexistent" });
        throw new Error("should have thrown");
      } catch (err) {
        expect((err as HostError).code).toBe("not_found");
      }
    } finally {
      server.stop(true);
    }
  });

  // Same gap class the searxng fix above found and fixed: a
  // `home.base_url` sitting behind an SSO proxy redirects to an HTML
  // login page rather than JSON, and attemptHttpFetch treats "a real
  // server answered with plain text" as success. Without this check that
  // HTML would come back as `result` and any recipe reading `state`/
  // `attributes` off it would silently see `undefined`.
  test("a non-JSON response (e.g. an SSO login page) throws instead of returning HTML as if it were state", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response("<html><body>Log in</body></html>", { headers: { "content-type": "text/html" } }) });
    try {
      const actor = await owner();
      setHouseholdSettingValue("home.base_url", `http://127.0.0.1:${server.port}`);
      setHouseholdSettingValue("home.access_token", "test-token");
      const host = createHost(actor, manifest({ permissions: ["integration:home_assistant"] }));
      try {
        await host.integration.call("home_assistant", "get_state", { entity_id: "light.porch" });
        throw new Error("should have thrown");
      } catch (err) {
        expect((err as HostError).code).toBe("network_unreachable");
        expect((err as HostError).message).toContain("didn't return a JSON response");
      }
    } finally {
      server.stop(true);
    }
  });

  test("an id/method this host doesn't implement yet still reports capability_missing", async () => {
    const actor = await owner();
    const host = createHost(actor, manifest({ permissions: ["integration:spotify"] }));
    try {
      await host.integration.call("spotify", "now_playing", {});
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as HostError).code).toBe("capability_missing");
    }
  });
});

describe("integration.call searxng (session-d-packages-and-store.md step 7, the websearch package's own case)", () => {
  test("isn't set up yet: invalid_input, the same shape home_assistant gives", async () => {
    const actor = await owner();
    const host = createHost(actor, manifest({ permissions: ["integration:searxng"] }));
    try {
      await host.integration.call("searxng", "search", { query: "node.js" });
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as HostError).code).toBe("invalid_input");
      expect((err as HostError).message).toContain("isn't set up yet");
    }
  });

  test("search without a query raises invalid_input before any network attempt", async () => {
    const actor = await owner();
    const host = createHost(actor, manifest({ permissions: ["integration:searxng"] }));
    try {
      await host.integration.call("searxng", "search", {});
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as HostError).code).toBe("invalid_input");
    }
  });

  test("a real GET to /search?q=...&format=json, formatted into a readable numbered list", async () => {
    let seenUrl = new URL("http://placeholder.invalid");
    const server = Bun.serve({
      port: 0,
      fetch: (req) => {
        seenUrl = new URL(req.url);
        return Response.json({
          results: [
            { title: "Node.js", url: "https://nodejs.org/", content: "Node.js is a JavaScript runtime." },
            { title: "Node.js docs", url: "https://nodejs.org/docs", content: "API documentation." },
          ],
        });
      },
    });
    try {
      const actor = await owner();
      setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${server.port}`);
      const host = createHost(actor, manifest({ permissions: ["integration:searxng"] }));
      const result = await host.integration.call("searxng", "search", { query: "node.js runtime" });
      expect(seenUrl.pathname).toBe("/search");
      expect(seenUrl.searchParams.get("q")).toBe("node.js runtime");
      expect(seenUrl.searchParams.get("format")).toBe("json");
      const searchResult = result as {
        text: string;
        rows: { title: string; url: string; snippet: string | null }[];
      };
      expect(searchResult.text).toBe(
        "1. Node.js (https://nodejs.org/) - Node.js is a JavaScript runtime.\n2. Node.js docs (https://nodejs.org/docs) - API documentation.",
      );
      expect(searchResult.rows).toEqual([
        { title: "Node.js", url: "https://nodejs.org/", snippet: "Node.js is a JavaScript runtime." },
        { title: "Node.js docs", url: "https://nodejs.org/docs", snippet: "API documentation." },
      ]);
    } finally {
      server.stop(true);
    }
  });

  // SEARCH-SAFE-01 (Jesse's own ruling, 2026-09-24): with no explicit
  // person-level set, safesearch follows the speaker's own band - child
  // strict (2), teen moderate (1), adult off (0). No image floor: an
  // image search carries exactly the person's own level, nothing more.
  test("with no override, safesearch follows the speaker's own band: child 2, teen 1, adult 0", async () => {
    for (const [role, expected] of [["child", "2"], ["teen", "1"], ["owner", "0"], ["adult", "0"]] as const) {
      let seenUrl = new URL("http://placeholder.invalid");
      const server = Bun.serve({
        port: 0,
        fetch: (req) => {
          seenUrl = new URL(req.url);
          return Response.json({ results: [] });
        },
      });
      try {
        // SEARCH-PACE-01's own bucket (capacity 3) is per process, not
        // per test - this loop makes several real calls in a row, so it
        // resets between each the same way beforeEach() does between tests.
        __resetRateLimiterForTests();
        __resetSearxngEnginesCacheForTests();
        const actor = { ...(await owner()), role };
        setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${server.port}`);
        const host = createHost(actor, manifest({ permissions: ["integration:searxng"] }));
        await host.integration.call("searxng", "search", { query: "is it going to rain" });
        expect(seenUrl.searchParams.get("safesearch")).toBe(expected);
      } finally {
        server.stop(true);
      }
    }
  });

  test("an image search carries exactly the person's own level - no floor, an adult's own off stays off", async () => {
    let seenUrl = new URL("http://placeholder.invalid");
    const server = Bun.serve({
      port: 0,
      fetch: (req) => {
        seenUrl = new URL(req.url);
        return Response.json({ results: [] });
      },
    });
    try {
      __resetSearxngEnginesCacheForTests();
      const actor = await owner();
      setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${server.port}`);
      const host = createHost(actor, manifest({ permissions: ["integration:searxng"] }));
      await host.integration.call("searxng", "search", { query: "Marsh Lantern movie poster", category: "images" });
      expect(seenUrl.searchParams.get("safesearch")).toBe("0");
    } finally {
      server.stop(true);
    }
  });

  // An explicit person-level override (set through the real settings
  // write path, PUT /api/settings's own lib.setValue()) stands as
  // given, whatever the speaker's band - here an admin loosening a
  // child down to "moderate", the admin's own call to make.
  test("an explicit override on the person's own setting stands over the band default", async () => {
    let seenUrl = new URL("http://placeholder.invalid");
    const server = Bun.serve({
      port: 0,
      fetch: (req) => {
        seenUrl = new URL(req.url);
        return Response.json({ results: [] });
      },
    });
    try {
      __resetSearxngEnginesCacheForTests();
      const owningAdult = await owner();
      const now = new Date().toISOString();
      const childId = "person-safesearchchild1";
      db.insert(people)
        .values({ id: childId, displayName: "Bramble", role: "child", avatarSeed: childId, source: "hub", createdAt: now, updatedAt: now, hlc: "1700000000000:2:testfix" })
        .run();
      const childRow = db.select().from(people).where(eq(people.id, childId)).get()!;
      const setResult = setValue(owningAdult, `person:${childRow.id}`, "search.safe_search", "moderate");
      expect(setResult.ok).toBe(true);
      setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${server.port}`);
      const host = createHost(childRow, manifest({ permissions: ["integration:searxng"] }));
      await host.integration.call("searxng", "search", { query: "is it going to rain" });
      expect(seenUrl.searchParams.get("safesearch")).toBe("1");
    } finally {
      server.stop(true);
    }
  });

  // SEARCH-SAFE-01: `safesearch=<level>` alone does not exclude an
  // engine with no safe-search support of its own (verified live,
  // 2026-09-24) - a child or teen's request also names only the
  // enabled, safesearch-capable engines for the category it runs,
  // read from this instance's own /config. Fixture carries two real
  // engine entries from that read: brave (general, safesearch-capable)
  // and pinterest (images, not).
  test("a child or teen's request names only /config's safesearch-capable engines for the category", async () => {
    const fixture = await Bun.file(`${import.meta.dir}/fixtures/searxng-config.json`).json();
    let seenUrls: URL[] = [];
    const server = Bun.serve({
      port: 0,
      fetch: (req) => {
        const url = new URL(req.url);
        seenUrls.push(url);
        if (url.pathname === "/config") return Response.json(fixture);
        return Response.json({ results: [] });
      },
    });
    try {
      __resetSearxngEnginesCacheForTests();
      const actor = { ...(await owner()), role: "child" as const };
      setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${server.port}`);
      const host = createHost(actor, manifest({ permissions: ["integration:searxng"] }));
      await host.integration.call("searxng", "search", { query: "how do volcanoes work" });
      const searchUrl = seenUrls.find((u) => u.pathname === "/search")!;
      expect(searchUrl.searchParams.get("engines")).toBe("brave");
    } finally {
      server.stop(true);
    }
  });

  test("an adult's request never gets an engines filter, even with /config configured", async () => {
    const fixture = await Bun.file(`${import.meta.dir}/fixtures/searxng-config.json`).json();
    let seenUrls: URL[] = [];
    const server = Bun.serve({
      port: 0,
      fetch: (req) => {
        const url = new URL(req.url);
        seenUrls.push(url);
        if (url.pathname === "/config") return Response.json(fixture);
        return Response.json({ results: [] });
      },
    });
    try {
      __resetSearxngEnginesCacheForTests();
      const actor = await owner();
      setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${server.port}`);
      const host = createHost(actor, manifest({ permissions: ["integration:searxng"] }));
      await host.integration.call("searxng", "search", { query: "how do volcanoes work" });
      expect(seenUrls.some((u) => u.pathname === "/config")).toBe(false);
      const searchUrl = seenUrls.find((u) => u.pathname === "/search")!;
      expect(searchUrl.searchParams.has("engines")).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  // The fixture's own images engine (pinterest) is not safesearch-
  // capable, so a teen's image search finds no safe engine at all -
  // the empty-list case, never blocking the search outright over it.
  test("no safesearch-capable engine for the category: the search still runs, unfiltered by name", async () => {
    const fixture = await Bun.file(`${import.meta.dir}/fixtures/searxng-config.json`).json();
    let seenUrls: URL[] = [];
    const server = Bun.serve({
      port: 0,
      fetch: (req) => {
        const url = new URL(req.url);
        seenUrls.push(url);
        if (url.pathname === "/config") return Response.json(fixture);
        return Response.json({ results: [] });
      },
    });
    try {
      __resetSearxngEnginesCacheForTests();
      const actor = { ...(await owner()), role: "teen" as const };
      setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${server.port}`);
      const host = createHost(actor, manifest({ permissions: ["integration:searxng"] }));
      await host.integration.call("searxng", "search", { query: "volcano diagram", category: "images" });
      const searchUrl = seenUrls.find((u) => u.pathname === "/search")!;
      expect(searchUrl.searchParams.get("safesearch")).toBe("1");
      expect(searchUrl.searchParams.has("engines")).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("a failed /config never blocks the search - the safesearch level alone still applies", async () => {
    let seenUrls: URL[] = [];
    const server = Bun.serve({
      port: 0,
      fetch: (req) => {
        const url = new URL(req.url);
        seenUrls.push(url);
        if (url.pathname === "/config") return new Response("not found", { status: 404 });
        return Response.json({ results: [] });
      },
    });
    try {
      __resetSearxngEnginesCacheForTests();
      const actor = { ...(await owner()), role: "child" as const };
      setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${server.port}`);
      const host = createHost(actor, manifest({ permissions: ["integration:searxng"] }));
      const result = await host.integration.call("searxng", "search", { query: "how do volcanoes work" });
      expect(result).toBeTruthy();
      const searchUrl = seenUrls.find((u) => u.pathname === "/search")!;
      expect(searchUrl.searchParams.get("safesearch")).toBe("2");
      expect(searchUrl.searchParams.has("engines")).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("the engines list is cached across calls to the same instance - one /config fetch, not one per search", async () => {
    const fixture = await Bun.file(`${import.meta.dir}/fixtures/searxng-config.json`).json();
    let configFetches = 0;
    const server = Bun.serve({
      port: 0,
      fetch: (req) => {
        const url = new URL(req.url);
        if (url.pathname === "/config") {
          configFetches++;
          return Response.json(fixture);
        }
        return Response.json({ results: [] });
      },
    });
    try {
      __resetSearxngEnginesCacheForTests();
      const actor = { ...(await owner()), role: "child" as const };
      setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${server.port}`);
      const host = createHost(actor, manifest({ permissions: ["integration:searxng"] }));
      __resetRateLimiterForTests();
      await host.integration.call("searxng", "search", { query: "how do volcanoes work" });
      __resetRateLimiterForTests();
      await host.integration.call("searxng", "search", { query: "what is a caldera" });
      expect(configFetches).toBe(1);
    } finally {
      server.stop(true);
    }
  });

  // Found live 2026-09-06 against a real household's SearXNG instance:
  // the configured URL sat behind SSO, so every request landed on an
  // HTML login page instead of JSON. attemptHttpFetch follows the
  // redirect itself and treats "a real server answered with plain text"
  // as success (correct for a generic host.fetch), so the old code
  // handed that HTML straight to formatSearxngResults, which silently
  // reported "No web search results were found." - a real misconfiguration
  // with no visible error anywhere.
  test("a non-JSON response (e.g. an SSO login page) throws instead of silently reporting no results", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response("<html><body>Log in</body></html>", { headers: { "content-type": "text/html" } }) });
    try {
      const actor = await owner();
      setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${server.port}`);
      const host = createHost(actor, manifest({ permissions: ["integration:searxng"] }));
      try {
        await host.integration.call("searxng", "search", { query: "node.js" });
        throw new Error("should have thrown");
      } catch (err) {
        expect((err as HostError).code).toBe("network_unreachable");
        expect((err as HostError).message).toContain("didn't return a JSON response");
        expect((err as HostError).message).toContain("SearXNG URL in Settings");
      }
    } finally {
      server.stop(true);
    }
  });

  // SEARCH-EMPTY-01 (docs/dev.md, conv-19awhetzdf, 2026-09-24): a real
  // household conversation read "0 results" from SearXNG (all three
  // upstream engines suspended - too many requests, a CAPTCHA) as a
  // plain "succeeded" outcome with nothing to answer from, and the
  // phrasing round answered from its own knowledge instead, wrongly.
  // SearXNG already reports the cause on the same response
  // (`unresponsive_engines`, an array of `[engine, reason]` pairs) - this
  // is the one choke point that turns that into a real failure.
  test("zero rows with unresponsive_engines throws search_unavailable, never a silent empty success", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        Response.json({
          query: "kevin bacon tv shows",
          results: [],
          unresponsive_engines: [
            ["brave", "Suspended: too many requests"],
            ["google cse", "Suspended: too many requests"],
            ["startpage", "Suspended: CAPTCHA"],
          ],
        }),
    });
    try {
      const actor = await owner();
      setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${server.port}`);
      const host = createHost(actor, manifest({ permissions: ["integration:searxng"] }));
      try {
        await host.integration.call("searxng", "search", { query: "kevin bacon tv shows" });
        throw new Error("should have thrown");
      } catch (err) {
        expect((err as HostError).code).toBe("search_unavailable");
        expect((err as HostError).message).toBe("Search isn't working right now.");
      }
    } finally {
      server.stop(true);
    }
  });

  test('zero rows with no unresponsive_engines is a real, silent empty success (a genuine "nothing found", not a failure)', async () => {
    const server = Bun.serve({ port: 0, fetch: () => Response.json({ query: "no results fixture", results: [] }) });
    try {
      const actor = await owner();
      setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${server.port}`);
      const host = createHost(actor, manifest({ permissions: ["integration:searxng"] }));
      const result = (await host.integration.call("searxng", "search", { query: "no results fixture" })) as { rows: unknown[] };
      expect(result.rows).toEqual([]);
    } finally {
      server.stop(true);
    }
  });

  // SEARCH-HEALTH-01 (docs/dev.md, docs/plans/search-resilience-
  // 2026-09-24.md): "the one choke point ... records [search's state]
  // on each call" - a real, live search (never only the hourly/15-
  // minute canary) raises and resolves the same Repairs rows
  // immediately.
  test("a real call that hits search_unavailable raises searxng_empty immediately, not only via the canary", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => Response.json({ results: [], infoboxes: [], unresponsive_engines: [["brave", "Suspended: too many requests"]] }),
    });
    try {
      const actor = await owner();
      setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${server.port}`);
      const host = createHost(actor, manifest({ permissions: ["integration:searxng"] }));
      try {
        await host.integration.call("searxng", "search", { query: "kevin bacon tv shows" });
        throw new Error("should have thrown");
      } catch (err) {
        expect((err as HostError).code).toBe("search_unavailable");
      }
      const issue = listIssues().find((i) => i.source === "websearch" && i.key === "searxng_empty");
      expect(issue).toBeDefined();
    } finally {
      server.stop(true);
    }
  });

  test("a real call that fails outright raises searxng_unreachable immediately, and a later real success resolves it", async () => {
    const actor = await owner();
    setHouseholdSettingValue("search.searxng_url", "http://127.0.0.1:1");
    const host = createHost(actor, manifest({ permissions: ["integration:searxng"] }));
    try {
      await host.integration.call("searxng", "search", { query: "kevin bacon tv shows" });
      throw new Error("should have thrown");
    } catch {
      // network_unreachable - the exact code doesn't matter here, only that it was recorded.
    }
    expect(listIssues().find((i) => i.source === "websearch" && i.key === "searxng_unreachable")).toBeDefined();

    const server = Bun.serve({ port: 0, fetch: () => Response.json({ results: [{ title: "The Following", url: "https://example.com", content: "A show." }] }) });
    try {
      setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${server.port}`);
      await host.integration.call("searxng", "search", { query: "kevin bacon tv shows" });
      expect(listIssues().filter((i) => i.source === "websearch")).toHaveLength(0);
    } finally {
      server.stop(true);
    }
  });

  test("a genuinely empty real result, with no unresponsive_engines, raises nothing at all", async () => {
    const server = Bun.serve({ port: 0, fetch: () => Response.json({ results: [], infoboxes: [] }) });
    try {
      const actor = await owner();
      setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${server.port}`);
      const host = createHost(actor, manifest({ permissions: ["integration:searxng"] }));
      await host.integration.call("searxng", "search", { query: "an obscure question nobody has answered" });
      expect(listIssues().filter((i) => i.source === "websearch")).toHaveLength(0);
    } finally {
      server.stop(true);
    }
  });

  // A review (2026-09-24) caught the first cut of this item wrapping
  // the read_page fetch in the same health-reporting try/catch as the
  // SearXNG request itself - a linked page failing for its own reasons
  // (blocked, non-HTML) got misreported as SearXNG being down. Search
  // itself succeeds here; only the linked page fails.
  test("a failed read_page fetch never misreports SearXNG as down - the search itself succeeded", async () => {
    const server = Bun.serve({ port: 0, fetch: () => Response.json({ results: [{ title: "Unreachable page", url: "http://127.0.0.1:1", content: "c" }] }) });
    try {
      const actor = await owner();
      setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${server.port}`);
      const host = createHost(actor, manifest({ permissions: ["integration:searxng"] }));
      try {
        await host.integration.call("searxng", "search", { query: "q", read_page: true });
        throw new Error("should have thrown (the linked page itself refuses the connection)");
      } catch (err) {
        expect((err as HostError).code).not.toBe("search_unavailable");
      }
      expect(listIssues().filter((i) => i.source === "websearch")).toHaveLength(0);
    } finally {
      server.stop(true);
    }
  });

  // SEARCH-PACE-01: the design note's own stated budget, "a burst of
  // three, then about one query every six seconds on average" -
  // {capacity: 3, refillPerSecond: 1/6}.
  test("the searxng rate limit is a burst of 3, then about one every 6 seconds", async () => {
    __resetRateLimiterForTests();
    const actor = await owner();
    setHouseholdSettingValue("search.searxng_url", "http://127.0.0.1:1"); // refuses the connection - real, fast, deterministic failures
    const host = createHost(actor, manifest({ permissions: ["integration:searxng"] }));
    const codes: string[] = [];
    for (let i = 0; i < 4; i++) {
      try {
        await host.integration.call("searxng", "search", { query: "q" });
      } catch (err) {
        codes.push((err as HostError).code);
      }
    }
    // The first 3 (the burst) reach the real network call and fail some
    // other way (a connection refused, network_unreachable); only the
    // 4th, past the budget, is refused before ever trying.
    expect(codes).toHaveLength(4);
    expect(codes.slice(0, 3)).not.toContain("rate_limited");
    expect(codes[3]).toBe("rate_limited");
  });

  // A review (2026-09-24) caught this budget originally shared with
  // page reads: one household question with read_page: true consumed
  // a token from each half of the SAME bucket, leaving as little as
  // one search token free for a second, unrelated question moments
  // later - a real risk to ordinary conversation, not only a bench
  // flood. Proven here by token count: a combined search+read_page
  // call now costs exactly one SEARCH token (its own separate
  // read_page token comes from a different bucket entirely), so two
  // more plain searches still fit inside the same 3-capacity budget.
  test("a combined search+read_page call costs one search token, not two - page reads have their own separate budget", async () => {
    const { __setPageReaderForTests } = await import("@/lib/packageHost");
    __resetRateLimiterForTests();
    __setPageReaderForTests(async (url) => ({ type: "document", attachment_id: "att-1", url, title: "T", text: "text", chunks: [], links: [], sections: [] }));
    const server = Bun.serve({ port: 0, fetch: () => Response.json({ results: [{ title: "T", url: "https://example.com", content: "c" }] }) });
    try {
      const actor = await owner();
      setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${server.port}`);
      const host = createHost(actor, manifest({ permissions: ["integration:searxng"] }));
      const codes: string[] = [];
      for (let i = 0; i < 4; i++) {
        try {
          await host.integration.call("searxng", "search", { query: `q-${i}`, read_page: i === 0 });
        } catch (err) {
          codes.push((err as HostError).code);
        }
      }
      // All 3 within the search budget's own capacity succeed (the
      // first one also did a page read); only the 4th, past that
      // budget, is refused - never after just 2, which is what a
      // still-shared bucket (the combined call costing 2) would show.
      expect(codes).toEqual(["rate_limited"]);
    } finally {
      __setPageReaderForTests(null);
      server.stop(true);
    }
  });
});

// SEARCH-FALLBACK-01 (docs/dev.md, docs/plans/search-resilience-2026-09-24.md):
// "when SearXNG is down or returns nothing, the websearch tool asks
// Wikipedia through its official, documented API." Tests on the fake
// servers only, per the coordinator's own instruction - no live
// acceptance tonight (SearXNG suspended, no real queries).
describe("Wikipedia fallback (SEARCH-FALLBACK-01)", () => {
  function startFakeWikipedia(opts: { hasMatch: boolean; requireUserAgent?: string }): { url: string; stop: () => void; requests: { path: string; userAgent: string | null }[] } {
    const requests: { path: string; userAgent: string | null }[] = [];
    const server = Bun.serve({
      port: 0,
      fetch: (req) => {
        const url = new URL(req.url);
        requests.push({ path: url.pathname, userAgent: req.headers.get("user-agent") });
        if (url.pathname === "/w/rest.php/v1/search/page") {
          if (!opts.hasMatch) return Response.json({ pages: [] });
          return Response.json({ pages: [{ id: 1, key: "Marlow_(topic)", title: "Marlow (topic)" }] });
        }
        if (url.pathname.startsWith("/api/rest_v1/page/summary/")) {
          return Response.json({
            title: "Marlow (topic)",
            extract: "Marlow is a roster-safe example topic used in MaiPai's own tests.",
            content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Marlow_(topic)" } },
          });
        }
        return new Response("not found", { status: 404 });
      },
    });
    return { url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true), requests };
  }

  test("SearXNG unreachable, Wikipedia has a match: returns Wikipedia's own result instead of throwing", async () => {
    const wiki = startFakeWikipedia({ hasMatch: true });
    const previousWikipediaBaseUrl = process.env.MAIPAI_WIKIPEDIA_BASE_URL;
    process.env.MAIPAI_WIKIPEDIA_BASE_URL = wiki.url;
    try {
      const actor = await owner();
      setHouseholdSettingValue("search.searxng_url", "http://127.0.0.1:1");
      const host = createHost(actor, manifest({ permissions: ["integration:searxng"] }));
      const result = (await host.integration.call("searxng", "search", { query: "marlow" })) as { text: string; rows: { title: string; url: string }[]; page?: { text: string } };
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]!.title).toBe("Marlow (topic)");
      expect(result.text).toContain("roster-safe example topic");
      expect(result.page?.text).toContain("roster-safe example topic");
      // SearXNG's own outage is still recorded - Wikipedia answering
      // this one question never hides that the household's own
      // instance is actually down.
      expect(listIssues().find((i) => i.source === "websearch" && i.key === "searxng_unreachable")).toBeDefined();
    } finally {
      // Restored, never deleted (tests/preload.ts's own comment on
      // why): a delete would erase the safe closed-port default preload
      // sets for every OTHER test, not just this one.
      if (previousWikipediaBaseUrl === undefined) delete process.env.MAIPAI_WIKIPEDIA_BASE_URL;
      else process.env.MAIPAI_WIKIPEDIA_BASE_URL = previousWikipediaBaseUrl;
      wiki.stop();
    }
  });

  test("SearXNG genuinely empty (no engine trouble), Wikipedia has a match: returns Wikipedia's own result, no issue raised", async () => {
    const wiki = startFakeWikipedia({ hasMatch: true });
    const previousWikipediaBaseUrl = process.env.MAIPAI_WIKIPEDIA_BASE_URL;
    process.env.MAIPAI_WIKIPEDIA_BASE_URL = wiki.url;
    const server = Bun.serve({ port: 0, fetch: () => Response.json({ results: [], infoboxes: [] }) });
    try {
      const actor = await owner();
      setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${server.port}`);
      const host = createHost(actor, manifest({ permissions: ["integration:searxng"] }));
      const result = (await host.integration.call("searxng", "search", { query: "marlow" })) as { rows: { title: string }[] };
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]!.title).toBe("Marlow (topic)");
      expect(listIssues().filter((i) => i.source === "websearch")).toHaveLength(0);
    } finally {
      // Restored, never deleted (tests/preload.ts's own comment on
      // why): a delete would erase the safe closed-port default preload
      // sets for every OTHER test, not just this one.
      if (previousWikipediaBaseUrl === undefined) delete process.env.MAIPAI_WIKIPEDIA_BASE_URL;
      else process.env.MAIPAI_WIKIPEDIA_BASE_URL = previousWikipediaBaseUrl;
      wiki.stop();
      server.stop(true);
    }
  });

  // A review, 2026-09-24, caught the first cut's early return for this
  // exact case skipping recordSearchHealth({kind:"ok"}) - a real
  // recovery (a stale searxng_unreachable issue from an earlier call)
  // would never actually resolve just because Wikipedia happened to
  // answer this particular query too.
  test("SearXNG genuinely empty with a stale open issue: a Wikipedia-assisted answer still resolves the stale issue", async () => {
    const wiki = startFakeWikipedia({ hasMatch: true });
    const previousWikipediaBaseUrl = process.env.MAIPAI_WIKIPEDIA_BASE_URL;
    process.env.MAIPAI_WIKIPEDIA_BASE_URL = wiki.url;
    try {
      const actor = await owner();
      // First, a real failure that leaves an open issue - the fallback
      // is off for this one call specifically, so Wikipedia (which
      // would otherwise happily answer "marlow" here too) can't rescue
      // it into a false success; the point of this setup step is a
      // genuinely open issue, not a real live outage.
      setHouseholdSettingValue("search.searxng_url", "http://127.0.0.1:1");
      setHouseholdSettingValue("search.wikipedia_fallback", false);
      const host = createHost(actor, manifest({ permissions: ["integration:searxng"] }));
      try {
        await host.integration.call("searxng", "search", { query: "marlow" });
        throw new Error("should have thrown - fallback is off for this call");
      } catch (err) {
        expect((err as Error).message).not.toBe("should have thrown - fallback is off for this call");
      }
      expect(listIssues().find((i) => i.source === "websearch" && i.key === "searxng_unreachable")).toBeDefined();

      // SearXNG recovers but genuinely finds nothing; Wikipedia helps
      // now that the fallback is back on (its own real default).
      setHouseholdSettingValue("search.wikipedia_fallback", true);
      const server = Bun.serve({ port: 0, fetch: () => Response.json({ results: [], infoboxes: [] }) });
      try {
        setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${server.port}`);
        const result = (await host.integration.call("searxng", "search", { query: "marlow" })) as { rows: { title: string }[] };
        expect(result.rows).toHaveLength(1);
        // The stale issue from the earlier real failure is actually
        // resolved now, not left open forever just because this
        // particular query happened to be answerable by Wikipedia.
        expect(listIssues().filter((i) => i.source === "websearch")).toHaveLength(0);
      } finally {
        server.stop(true);
      }
    } finally {
      if (previousWikipediaBaseUrl === undefined) delete process.env.MAIPAI_WIKIPEDIA_BASE_URL;
      else process.env.MAIPAI_WIKIPEDIA_BASE_URL = previousWikipediaBaseUrl;
      wiki.stop();
    }
  });

  test("SearXNG unreachable AND Wikipedia has no match either: the original SearXNG error still surfaces, never masked", async () => {
    const wiki = startFakeWikipedia({ hasMatch: false });
    const previousWikipediaBaseUrl = process.env.MAIPAI_WIKIPEDIA_BASE_URL;
    process.env.MAIPAI_WIKIPEDIA_BASE_URL = wiki.url;
    try {
      const actor = await owner();
      setHouseholdSettingValue("search.searxng_url", "http://127.0.0.1:1");
      const host = createHost(actor, manifest({ permissions: ["integration:searxng"] }));
      try {
        await host.integration.call("searxng", "search", { query: "marlow" });
        throw new Error("should have thrown");
      } catch (err) {
        expect((err as HostError).message).toContain("could not reach");
      }
    } finally {
      // Restored, never deleted (tests/preload.ts's own comment on
      // why): a delete would erase the safe closed-port default preload
      // sets for every OTHER test, not just this one.
      if (previousWikipediaBaseUrl === undefined) delete process.env.MAIPAI_WIKIPEDIA_BASE_URL;
      else process.env.MAIPAI_WIKIPEDIA_BASE_URL = previousWikipediaBaseUrl;
      wiki.stop();
    }
  });

  test("search.wikipedia_fallback=false: never even tries Wikipedia, even though it would have a match", async () => {
    const wiki = startFakeWikipedia({ hasMatch: true });
    const previousWikipediaBaseUrl = process.env.MAIPAI_WIKIPEDIA_BASE_URL;
    process.env.MAIPAI_WIKIPEDIA_BASE_URL = wiki.url;
    try {
      const actor = await owner();
      setHouseholdSettingValue("search.searxng_url", "http://127.0.0.1:1");
      setHouseholdSettingValue("search.wikipedia_fallback", false);
      const host = createHost(actor, manifest({ permissions: ["integration:searxng"] }));
      try {
        await host.integration.call("searxng", "search", { query: "marlow" });
        throw new Error("should have thrown");
      } catch (err) {
        expect((err as HostError).message).toContain("could not reach");
      }
      expect(wiki.requests).toHaveLength(0);
    } finally {
      // Restored, never deleted (tests/preload.ts's own comment on
      // why): a delete would erase the safe closed-port default preload
      // sets for every OTHER test, not just this one.
      if (previousWikipediaBaseUrl === undefined) delete process.env.MAIPAI_WIKIPEDIA_BASE_URL;
      else process.env.MAIPAI_WIKIPEDIA_BASE_URL = previousWikipediaBaseUrl;
      wiki.stop();
    }
  });

  // Wikimedia's own User-Agent policy (foundation.wikimedia.org/wiki/
  // Policy:User-Agent_policy, verified 2026-09-24): "<client name>/
  // <version> (<contact information>)" - a non-compliant request risks
  // a 403 or silent throttling, the policy's own words.
  test("every Wikipedia request carries a policy-compliant User-Agent", async () => {
    const wiki = startFakeWikipedia({ hasMatch: true });
    const previousWikipediaBaseUrl = process.env.MAIPAI_WIKIPEDIA_BASE_URL;
    process.env.MAIPAI_WIKIPEDIA_BASE_URL = wiki.url;
    try {
      const actor = await owner();
      setHouseholdSettingValue("search.searxng_url", "http://127.0.0.1:1");
      const host = createHost(actor, manifest({ permissions: ["integration:searxng"] }));
      await host.integration.call("searxng", "search", { query: "marlow" });
      expect(wiki.requests).toHaveLength(2); // search, then the page summary
      for (const req of wiki.requests) {
        expect(req.userAgent).toMatch(/^\S+\/\S+ \(.+\)/); // "<name>/<version> (<contact>)"
        expect(req.userAgent).not.toMatch(/^Mozilla\//); // never a browser-style UA
      }
    } finally {
      // Restored, never deleted (tests/preload.ts's own comment on
      // why): a delete would erase the safe closed-port default preload
      // sets for every OTHER test, not just this one.
      if (previousWikipediaBaseUrl === undefined) delete process.env.MAIPAI_WIKIPEDIA_BASE_URL;
      else process.env.MAIPAI_WIKIPEDIA_BASE_URL = previousWikipediaBaseUrl;
      wiki.stop();
    }
  });

  // A review, 2026-09-24, caught two real gaps: the row's own snippet
  // duplicated the full extract byte for byte with page.text (doubling
  // the tokens an llm_complete synthesis call pays for the identical
  // content), and the extract had no length cap at all, unlike every
  // other SearXNG-sourced field. Fixed with description (a short,
  // genuinely different sentence) as the row snippet and a 32,000-char
  // cap on page.text, the same bound parseReadablePage() already uses.
  test("the row snippet is Wikipedia's own short description, not a duplicate of the full extract - and both are bounded", async () => {
    const longExtract = "x".repeat(40_000); // well past both the 300-char snippet cap and the 32,000-char page.text cap
    const server = Bun.serve({
      port: 0,
      fetch: (req) => {
        const url = new URL(req.url);
        if (url.pathname === "/w/rest.php/v1/search/page") return Response.json({ pages: [{ id: 1, key: "Marlow_(topic)" }] });
        return Response.json({
          title: "Marlow (topic)",
          description: "A short, genuinely different summary sentence.",
          extract: longExtract,
          content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Marlow_(topic)" } },
        });
      },
    });
    const previousWikipediaBaseUrl = process.env.MAIPAI_WIKIPEDIA_BASE_URL;
    process.env.MAIPAI_WIKIPEDIA_BASE_URL = `http://127.0.0.1:${server.port}`;
    try {
      const actor = await owner();
      setHouseholdSettingValue("search.searxng_url", "http://127.0.0.1:1");
      const host = createHost(actor, manifest({ permissions: ["integration:searxng"] }));
      const result = (await host.integration.call("searxng", "search", { query: "marlow" })) as { rows: { snippet: string | null }[]; page?: { text: string } };
      expect(result.rows[0]!.snippet).toContain("A short, genuinely different summary sentence.");
      expect(result.rows[0]!.snippet).not.toContain("x".repeat(1000)); // never the huge extract
      expect(result.page?.text.length).toBeLessThanOrEqual(32_000);
      expect(result.page?.text).toContain("x"); // still the real extract, just bounded
    } finally {
      if (previousWikipediaBaseUrl === undefined) delete process.env.MAIPAI_WIKIPEDIA_BASE_URL;
      else process.env.MAIPAI_WIKIPEDIA_BASE_URL = previousWikipediaBaseUrl;
      server.stop(true);
    }
  });
});

describe("formatSearxngResults", () => {
  test("reads one scripted page into bounded text, sections, and three sanitized links", () => {
    const page = parseReadablePage(`
      <html><head><title>Vendor support</title></head><body><article>
        <h1>Vendor support</h1><p>Support information for the household.</p>
        <h2>Download</h2><p>Get the latest driver from this section.</p>
        <p><a href="/downloads/latest-driver#setup" rel="nofollow">Download latest game driver</a></p>
        <p><a href="/support/fixes">Support and fixes</a></p>
        <p><a href="https://example.com/price">Pricing</a></p>
      </article></body></html>
    `, "https://example.com/support");
    expect(page.type).toBe("document");
    expect(page.text).toContain("latest driver");
    expect(page.sections).toContainEqual({ heading: "Download", text: "Get the latest driver from this section." });
    expect(page.links).toHaveLength(3);
    expect(page.links[0]).toMatchObject({ title: "Download latest game driver", href: "https://example.com/downloads/latest-driver", rel: "nofollow" });
  });

  test("an image search requests the images category and maps img_src to image", async () => {
    let seenUrl = new URL("http://placeholder.invalid");
    const server = Bun.serve({
      port: 0,
      fetch: (req) => {
        seenUrl = new URL(req.url);
        return Response.json({ results: [{ title: "A photo", url: "https://example.com/page", content: "A photo", img_src: "https://cdn.example.com/photo.jpg" }] });
      },
    });
    try {
      const actor = await owner();
      setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${server.port}`);
      const host = createHost(actor, manifest({ permissions: ["integration:searxng"] }));
      const result = await host.integration.call("searxng", "search", { query: "photos", category: "images" }) as { rows: Array<{ image?: string }> };
      expect(seenUrl.searchParams.get("categories")).toBe("images");
      expect(result.rows[0]?.image).toBe("https://cdn.example.com/photo.jpg");
    } finally {
      server.stop(true);
    }
  });

  test("reports no results found for an empty results array", () => {
    expect(formatSearxngResults({ results: [] })).toBe("No web search results were found.");
  });

  test("reads a malformed (non-object) response as no results, not a throw", () => {
    expect(formatSearxngResults(null)).toBe("No web search results were found.");
  });

  // The same class of gap code review found in almanac-holiday/onthisday/
  // music: a result entry missing a usable title/url is skipped, never
  // interpolated as "undefined".
  test("skips a result missing a title or url rather than showing 'undefined'", () => {
    const data = {
      results: [
        { title: "Real result", url: "https://example.com" },
        { url: "https://example.com/no-title" },
        { title: "No URL" },
      ],
    };
    expect(formatSearxngResults(data)).toBe("1. Real result (https://example.com)");
  });

  test("respects the count cap", () => {
    const data = { results: Array.from({ length: 10 }, (_, i) => ({ title: `Result ${i}`, url: `https://example.com/${i}` })) };
    const text = formatSearxngResults(data, 2);
    expect(text.split("\n")).toHaveLength(2);
  });

  // Found live 2026-09-06: a direct-topic query ("Japan", "Grand Theft
  // Auto VI") gets answered by Wikipedia's `infoboxes`, not `results` -
  // the exact shape those two real test queries returned, and the case
  // this function silently missed entirely before.
  test("reads an infobox's title (from `infobox`, not the blank `title`), link (from `id`), and content", () => {
    const data = {
      results: [],
      infoboxes: [
        {
          infobox: "Japan",
          id: "https://en.wikipedia.org/wiki/Japan",
          content: "Japan is an island country in East Asia.",
          title: "",
          url: null,
        },
      ],
    };
    expect(formatSearxngResults(data)).toBe("1. Japan (https://en.wikipedia.org/wiki/Japan) - Japan is an island country in East Asia.");
  });

  test("falls back to urls[0] when an infobox has no id", () => {
    const data = {
      infoboxes: [{ infobox: "Japan", urls: [{ title: "Wikipedia", url: "https://en.wikipedia.org/wiki/Japan" }] }],
    };
    expect(formatSearxngResults(data)).toBe("1. Japan (https://en.wikipedia.org/wiki/Japan)");
  });

  test("lists an infobox ahead of regular results, sharing the same count cap", () => {
    const data = {
      infoboxes: [{ infobox: "Japan", id: "https://en.wikipedia.org/wiki/Japan" }],
      results: [{ title: "Visiting Japan", url: "https://example.com/travel" }],
    };
    expect(formatSearxngResults(data)).toBe("1. Japan (https://en.wikipedia.org/wiki/Japan)\n2. Visiting Japan (https://example.com/travel)");
  });
});

describe("host.diagnostics (session-d-packages-and-store.md step 4)", () => {
  test("returns the package's own id, version, tier and declared permissions - real, not capability_missing", async () => {
    const actor = await owner();
    const host = createHost(actor, manifest({ permissions: ["memory:write"], version: "0.2.0" }));
    expect(host.diagnostics()).toEqual({
      id: "test-pkg",
      version: "0.2.0",
      tier: 0,
      permissions: ["memory:write"],
    });
  });
});

describe("packageHost unimplemented methods", () => {
  test("action.emit checks permission before reporting capability_missing", async () => {
    const actor = await owner();
    const host = createHost(actor, manifest({ permissions: [] }));
    try {
      host.action.emit("lock_doors");
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as HostError).code).toBe("permission_denied");
    }
  });
});

// llm.complete is real now (session-d-packages-and-store.md step 7,
// translate's own case): the Host RPC boundary is async (this file's
// own beforeEach resets the chat supervisor so each test gets a fresh
// stub client, the same fixture lib/llm.ts's own tests use - no live
// model, no network, deterministic and offline). This used to only be
// provably `capability_missing` (a synchronous boundary blocking an
// inherently async chat completion); that gap is what step 7 closed.
describe("packageHost llm.complete", () => {
  test("checks permission before reaching the chat model", async () => {
    const actor = await owner();
    const host = createHost(actor, manifest({ permissions: [] }));
    try {
      await host.llm.complete({ messages: [{ role: "user", content: "hi" }] });
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as HostError).code).toBe("permission_denied");
    }
  });

  test("rejects a missing or empty messages array as invalid_input, not a crash", async () => {
    const actor = await owner();
    const host = createHost(actor, manifest({ permissions: ["llm:complete"] }));
    try {
      await host.llm.complete({});
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as HostError).code).toBe("invalid_input");
    }
  });

  test("returns a real reply from the stub chat backend (no engine configured in tests)", async () => {
    const actor = await owner();
    const host = createHost(actor, manifest({ permissions: ["llm:complete"] }));
    const result = (await host.llm.complete({ messages: [{ role: "user", content: "translate hello to spanish" }] })) as { text: string };
    expect(result.text).toContain("translate hello to spanish");
    expect(result.text).toContain("[stub model: no real model loaded, this is a canned reply]");
  });
});

describe("packageHost lists (session-d-packages-and-store.md step 8)", () => {
  test("add checks permission before touching the shopping list", async () => {
    const actor = await owner();
    const host = createHost(actor, manifest({ permissions: [] }));
    try {
      host.lists.add("milk");
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as HostError).code).toBe("permission_denied");
    }
  });

  test("view reports an empty shopping list plainly", async () => {
    const actor = await owner();
    const host = createHost(actor, manifest({ permissions: ["lists:read"] }));
    expect(host.lists.view()).toBe("Your shopping list is empty.");
  });

  test("add then view: the real find-or-create shopping list, not a canned reply", async () => {
    const actor = await owner();
    const host = createHost(actor, manifest({ permissions: ["lists:write", "lists:read"] }));
    host.lists.add("milk");
    host.lists.add("eggs");
    expect(host.lists.view()).toBe("milk, eggs");
  });

  test("add finds the same standing list across calls, never creating a second one", async () => {
    const actor = await owner();
    const host = createHost(actor, manifest({ permissions: ["lists:write"] }));
    host.lists.add("milk");
    host.lists.add("eggs");
    const rows = db.select().from(lists).where(eq(lists.kind, "shopping")).all();
    expect(rows).toHaveLength(1);
  });
});

describe("packageHost reminders and timers (session-d-packages-and-store.md step 8)", () => {
  test("reminders.set checks permission before parsing anything", async () => {
    const actor = await owner();
    const host = createHost(actor, manifest({ permissions: [] }));
    expect(() => host.reminders.set("at 6 to call Nadia")).toThrow(HostError);
  });

  test("reminders.set schedules a real core job and returns a confirmation", async () => {
    const actor = await owner();
    const host = createHost(actor, manifest({ permissions: ["reminders:write"] }));
    const result = host.reminders.set("at 6 to call Nadia");
    expect(result.task).toBe("call Nadia");
    const rows = db.select().from(scheduledJobs).where(eq(scheduledJobs.job, "reminders.fire")).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("core");
    expect(rows[0]!.personId).toBe(actor.id);
    expect(JSON.parse(rows[0]!.inputs)).toEqual({ task: "call Nadia" });
  });

  test("reminders.set raises invalid_input for text with no time in it", async () => {
    const actor = await owner();
    const host = createHost(actor, manifest({ permissions: ["reminders:write"] }));
    try {
      host.reminders.set("call Nadia");
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as HostError).code).toBe("invalid_input");
    }
  });

  test("timers.set schedules a real core job with the exact requested duration", async () => {
    const actor = await owner();
    const host = createHost(actor, manifest({ permissions: ["timers:write"] }));
    const before = Date.now();
    const result = host.timers.set("ten minutes");
    expect(result.label).toBe("ten minutes");
    const rows = db.select().from(scheduledJobs).where(eq(scheduledJobs.job, "timers.fire")).all();
    expect(rows).toHaveLength(1);
    const nextRunAt = new Date(rows[0]!.nextRunAt).getTime();
    expect(nextRunAt).toBeGreaterThanOrEqual(before + 600_000);
    expect(nextRunAt).toBeLessThan(before + 601_000);
  });

  test("timers.set raises invalid_input for a duration this grammar doesn't cover", async () => {
    const actor = await owner();
    const host = createHost(actor, manifest({ permissions: ["timers:write"] }));
    expect(() => host.timers.set("a while")).toThrow(HostError);
  });
});

describe("searxng search cache", () => {
  test("caches results, separates safe-search levels, skips empty results, dedupes in-flight calls, and expires after five minutes", async () => {
    let searchRequests = 0;
    let release: (() => void) | undefined;
    const server = Bun.serve({ port: 0, fetch: async (request) => { if (new URL(request.url).pathname === "/search") { searchRequests++; if (searchRequests === 1) await new Promise<void>((resolve) => { release = resolve; }); } return Response.json({ results: [{ title: "Earth", url: "https://example.com/earth", content: "planet" }] }); } });
    const previousNow = Date.now;
    let now = 1_000_000;
    Date.now = () => now;
    try {
      setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${server.port}`);
      const first = searxngSearch({ query: "earth" }, { safeSearchLevel: "off" });
      const second = searxngSearch({ query: "earth" }, { safeSearchLevel: "off" });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(searchRequests).toBe(1);
      release!();
      await Promise.all([first, second]);
      await searxngSearch({ query: "earth" }, { safeSearchLevel: "moderate" });
      expect(searchRequests).toBe(2);
      await searxngSearch({ query: "earth" }, { safeSearchLevel: "off" });
      expect(searchRequests).toBe(2);
      now += 5 * 60 * 1000;
      await searxngSearch({ query: "earth" }, { safeSearchLevel: "off" });
      expect(searchRequests).toBe(3);
    } finally {
      Date.now = previousNow;
      server.stop(true);
    }
  });

  test("does not cache a zero-row result", async () => {
    let requests = 0;
    const server = Bun.serve({ port: 0, fetch: () => { requests++; return Response.json({ results: [] }); } });
    try {
      setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${server.port}`);
      await searxngSearch({ query: "nothing" });
      await searxngSearch({ query: "nothing" });
      expect(requests).toBe(2);
    } finally { server.stop(true); }
  });
});

describe("packageHost data.forget", () => {
  test("deletes a person's scope=person memories via the real memory store", async () => {
    const actor = await owner();
    const host = createHost(actor, manifest({ permissions: ["memory:write"] }));
    host.memory.remember("likes pizza", "preference", "person", actor.id);
    const deleted = host.data.forget(actor.id);
    expect(deleted).toBeGreaterThanOrEqual(1);
  });
});
