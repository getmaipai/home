import { describe, expect, test, beforeEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { createHost, performHttpFetch } from "@/lib/packageHost";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { HostError } from "@maipai/spec/emulators/ts/host-emulator.js";
import { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
});

function manifest(overrides: Partial<PackageManifest> = {}): PackageManifest {
  return PackageManifest.parse({
    id: "test-pkg",
    version: "0.1.0",
    kind: "skill",
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

describe("packageHost memory.remember", () => {
  test("writes through to the real memory store when permitted", async () => {
    const actor = await owner();
    const host = createHost(actor, manifest({ permissions: ["memory:write"] }));
    const id = host.memory.remember("the wifi password is on the fridge", "fact", "household");
    expect(typeof id).toBe("string");

    const listed = createHost(actor, manifest({ permissions: ["memory:read"] })).memory.recall("wifi password");
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
});

describe("packageHost unimplemented methods", () => {
  test("home.call_service throws capability_missing, honestly, not a silent no-op", async () => {
    const actor = await owner();
    const host = createHost(actor, manifest());
    expect(() => host.home.call_service("light", "turn_off", {})).toThrow(HostError);
    try {
      host.home.call_service("light", "turn_off", {});
    } catch (err) {
      expect((err as HostError).code).toBe("capability_missing");
    }
  });

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

  // llm.complete is a deliberate exception in this describe block: the
  // `chat` role IS real now (lib/llm.ts), but the Host RPC boundary is
  // synchronous and a chat completion is inherently async network I/O
  // (see the header comment in packageHost.ts and spec/llm/README.md).
  // This pins that the gap stays honest (capability_missing, permission
  // checked first) rather than silently regressing to some other code.
  test("llm.complete still reports capability_missing (sync Host boundary, async chat role)", async () => {
    const actor = await owner();
    const host = createHost(actor, manifest({ permissions: ["llm:complete"] }));
    try {
      host.llm.complete({ messages: [{ role: "user", content: "hi" }] });
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as HostError).code).toBe("capability_missing");
    }
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
