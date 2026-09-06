import { describe, expect, test, beforeEach } from "bun:test";
import { hashSecret } from "@/lib/secret";
import {
  lockoutDurationMs,
  recordFailedAttempt,
  clearFailedAttempts,
  ensureCredentialRowExists,
  currentLockout,
  LOCKOUT_THRESHOLD,
} from "@/lib/credentialLockout";
import { newPersonId } from "@/lib/id";
import { db } from "@/db";
import { people, personCredentials } from "@/db/schema";
import { resetDb } from "./reset-db";

function insertPerson(): string {
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
      hlc: "1700000000000:0:testfix",
    })
    .run();
  return personId;
}

beforeEach(() => resetDb());

describe("lockout backoff", () => {
  // No "stays at zero below the threshold" case: lockoutDurationMs's only
  // real contract is failedAttempts >= LOCKOUT_THRESHOLD (the only way a
  // real caller reaches it). A code review (2026-09-04) found the
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
  test("increments from the current stored value, not a caller-supplied one", async () => {
    const personId = insertPerson();
    const now = new Date().toISOString();
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

  // Step 6: a passkey-only person has a personCredentials row with a
  // null secretHash (ensureCredentialRowExists()), not one with a PIN
  // hash - this proves the shared counter works identically either way,
  // since recordFailedAttempt() never reads secretHash at all.
  test("works against a passkey-only row (secretHash null)", () => {
    const personId = insertPerson();
    ensureCredentialRowExists(personId);
    const row = currentLockout(personId);
    expect(row).toEqual({ failedAttempts: 0, lockedUntil: null });

    const result = recordFailedAttempt(personId);
    expect(result.failedAttempts).toBe(1);
  });
});

describe("ensureCredentialRowExists()", () => {
  test("is idempotent - never overwrites an existing row's counter", async () => {
    const personId = insertPerson();
    const now = new Date().toISOString();
    db.insert(personCredentials)
      .values({ personId, secretHash: await hashSecret("x"), failedAttempts: 2, createdAt: now, updatedAt: now })
      .run();

    ensureCredentialRowExists(personId);

    expect(currentLockout(personId)?.failedAttempts).toBe(2);
  });
});

describe("clearFailedAttempts()", () => {
  test("resets both the counter and the lockout timestamp", () => {
    const personId = insertPerson();
    ensureCredentialRowExists(personId);
    for (let i = 0; i < LOCKOUT_THRESHOLD; i++) recordFailedAttempt(personId);
    expect(currentLockout(personId)?.lockedUntil).not.toBeNull();

    clearFailedAttempts(personId);
    expect(currentLockout(personId)).toEqual({ failedAttempts: 0, lockedUntil: null });
  });
});
