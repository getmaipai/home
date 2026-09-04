import { describe, expect, test, beforeEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { createHost } from "@/lib/packageHost";
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
    try {
      host.fetch("not a url");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(HostError);
      expect((err as HostError).code).toBe("invalid_input");
    }
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
