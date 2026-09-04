import { describe, expect, test, beforeEach } from "bun:test";
import { Person } from "@maipai/spec/gen/ts/person.js";
import {
  hashSecret,
  verifySecret,
  lockoutDurationMs,
  recordFailedAttempt,
  LOCKOUT_THRESHOLD,
} from "@/lib/secret";
import { newPersonId } from "@/lib/id";
import { ROLE_LADDER } from "@/middleware/auth";
import { db } from "@/db";
import { people, personCredentials } from "@/db/schema";
import { resetDb } from "./reset-db";

describe("secret hashing", () => {
  test("a correct secret verifies against its own hash", async () => {
    const hash = await hashSecret("correcthorse");
    expect(await verifySecret("correcthorse", hash)).toBe(true);
  });

  test("a wrong secret does not verify", async () => {
    const hash = await hashSecret("correcthorse");
    expect(await verifySecret("wrong", hash)).toBe(false);
  });

  test("the same secret hashes differently each time (random salt)", async () => {
    const a = await hashSecret("correcthorse");
    const b = await hashSecret("correcthorse");
    expect(a).not.toBe(b);
  });

  test("hashes never contain the plaintext secret", async () => {
    const hash = await hashSecret("correcthorse");
    expect(hash).not.toContain("correcthorse");
  });
});

describe("lockout backoff", () => {
  // No "stays at zero below the threshold" case: lockoutDurationMs's only
  // real contract is failedAttempts >= LOCKOUT_THRESHOLD (the only way
  // routes/auth.ts calls it). A code review (2026-09-04) found the
  // previous version of this test only passed because of a defensive
  // clamp that could never fire at the real call site, and asserted a
  // claim ("stays at zero") the code never actually made.
  test("grows with more failed attempts, capped at one hour", () => {
    const at5 = lockoutDurationMs(LOCKOUT_THRESHOLD);
    const at6 = lockoutDurationMs(LOCKOUT_THRESHOLD + 1);
    const at20 = lockoutDurationMs(LOCKOUT_THRESHOLD + 15);
    expect(at5).toBe(30_000);
    expect(at6).toBeGreaterThan(at5);
    expect(at20).toBe(3_600_000);
  });
});

describe("recordFailedAttempt (atomic counter)", () => {
  beforeEach(() => resetDb());

  test("increments from the current stored value, not a caller-supplied one", async () => {
    const now = new Date().toISOString();
    const personId = newPersonId();
    db.insert(people)
      .values({
        id: personId,
        displayName: "Sage",
        role: "owner",
        avatarSeed: personId,
        source: "hub",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(personCredentials)
      .values({
        personId,
        secretHash: await hashSecret("correcthorse"),
        failedAttempts: 3,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const first = recordFailedAttempt(personId);
    expect(first.failedAttempts).toBe(4);
    const second = recordFailedAttempt(personId);
    expect(second.failedAttempts).toBe(5);
    expect(second.lockedUntil).not.toBeNull();
  });
});

describe("ROLE_LADDER", () => {
  test("is derived from the spec's Person role enum, not a second copy", () => {
    expect(ROLE_LADDER).toEqual(Person.shape.role.options);
  });
});

describe("person id generation", () => {
  test("matches the spec's person id pattern", () => {
    for (let i = 0; i < 50; i++) {
      expect(newPersonId()).toMatch(/^person-[a-z0-9]{6,}$/);
    }
  });

  test("is not predictable across calls", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newPersonId()));
    expect(ids.size).toBe(200);
  });
});
