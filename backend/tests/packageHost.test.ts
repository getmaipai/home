import { describe, expect, test, beforeEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { createHost, performHttpFetch, withOneRetry, formatSearxngResults, type AttemptResult } from "@/lib/packageHost";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { cachedFetch, __resetPackageCacheForTests, __clearPackageCacheDirForTests } from "@/lib/packageCache";
import { assertNotPrivateHost } from "@/lib/ssrfGuard";
import { setHouseholdSettingValue } from "@/lib/settings";
import { HostError } from "@maipai/spec/emulators/ts/host-emulator.js";
import { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import { db } from "@/db";
import { people, memoryRecords, scheduledJobs, lists } from "@/db/schema";
import { eq } from "drizzle-orm";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { remember } from "@/lib/memory";

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
  __resetLlmSupervisorForTests();
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
    const host = createHost(actor, manifest({ permissions: ["memory:write"] }), [], "turn-faketest01");
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
        await assertNotPrivateHost(new URL(hopUrl).hostname).catch((err) => {
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
      expect(result).toBe(
        "1. Node.js (https://nodejs.org/) - Node.js is a JavaScript runtime.\n2. Node.js docs (https://nodejs.org/docs) - API documentation.",
      );
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
});

describe("formatSearxngResults", () => {
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

describe("packageHost data.forget", () => {
  test("deletes a person's scope=person memories via the real memory store", async () => {
    const actor = await owner();
    const host = createHost(actor, manifest({ permissions: ["memory:write"] }));
    host.memory.remember("likes pizza", "preference", "person", actor.id);
    const deleted = host.data.forget(actor.id);
    expect(deleted).toBeGreaterThanOrEqual(1);
  });
});
