import { describe, expect, test, beforeEach } from "bun:test";
import { db } from "@/db";
import { people, deviceTokens, sessions } from "@/db/schema";
import { newPersonId } from "@/lib/id";
import { issueDeviceToken, redeemDeviceToken, hashDeviceToken, pruneExpiredDeviceTokens } from "@/lib/deviceTokens";
import { listDevicesForPerson, deleteDevice } from "@/lib/devices";
import { hashSessionToken } from "@/lib/session";
import { resolveSession, __clearSessionCacheForTests } from "@/middleware/auth";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";

function insertPerson(): string {
  const now = new Date().toISOString();
  const personId = newPersonId();
  db.insert(people)
    .values({ id: personId, displayName: "Willow", role: "adult", avatarSeed: personId, source: "hub", createdAt: now, updatedAt: now, hlc: "1700000000000:0:testfix" })
    .run();
  return personId;
}

beforeEach(() => resetDb());

describe("issueDeviceToken()", () => {
  test("mints a token AND the Device row it points at", () => {
    const personId = insertPerson();
    const { token, deviceId } = issueDeviceToken(personId, "tv", "Living room TV");
    expect(token).toHaveLength(64); // 32 random bytes, hex
    const [device] = listDevicesForPerson(personId);
    expect(device!.id).toBe(deviceId);
    expect(device!.kind).toBe("tv");
    expect(device!.name).toBe("Living room TV");
  });

  test("never stores the raw token, only its hash", () => {
    const personId = insertPerson();
    const { token } = issueDeviceToken(personId, "tv", "Living room TV");
    const row = db.select().from(deviceTokens).where(eq(deviceTokens.tokenHash, hashDeviceToken(token))).get();
    expect(row).toBeDefined();
    expect(row!.tokenHash).not.toBe(token);
  });

  test("bounds the per-person set at 20, evicting the oldest first", () => {
    const personId = insertPerson();
    const tokens: string[] = [];
    for (let i = 0; i < 21; i++) {
      const { token } = issueDeviceToken(personId, "tv", `TV ${i}`);
      tokens.push(token);
    }
    const rows = db.select().from(deviceTokens).where(eq(deviceTokens.personId, personId)).all();
    expect(rows.length).toBe(20);
    // The very first token minted should have been evicted.
    expect(redeemDeviceToken(tokens[0]!, null)).toBeNull();
    // The most recent one should still work.
    expect(redeemDeviceToken(tokens[20]!, null)).not.toBeNull();
  });
});

describe("redeemDeviceToken()", () => {
  test("resolves a valid token to its person and device, stamping last-seen", () => {
    const personId = insertPerson();
    const { token, deviceId } = issueDeviceToken(personId, "phone", "My phone");
    const result = redeemDeviceToken(token, "https://192.168.1.50:8787");
    expect(result).toEqual({ personId, deviceId });
    const [device] = listDevicesForPerson(personId);
    expect(device!.lastSeenAt).not.toBeNull();
  });

  test("null for an unknown token", () => {
    expect(redeemDeviceToken("not-a-real-token", null)).toBeNull();
  });

  test("null for an expired token, and deletes it", () => {
    const personId = insertPerson();
    const { token } = issueDeviceToken(personId, "phone", "My phone");
    // Backdate the row's expiry directly - the only way to construct a
    // real expired token without waiting 365 days.
    db.update(deviceTokens).set({ expiresAt: new Date(Date.now() - 1000).toISOString() }).where(eq(deviceTokens.tokenHash, hashDeviceToken(token))).run();

    expect(redeemDeviceToken(token, null)).toBeNull();
    expect(db.select().from(deviceTokens).where(eq(deviceTokens.tokenHash, hashDeviceToken(token))).get()).toBeUndefined();
  });
});

describe("pruneExpiredDeviceTokens()", () => {
  test("removes only expired rows", () => {
    const personId = insertPerson();
    const { token: liveToken } = issueDeviceToken(personId, "tv", "Live TV");
    const { token: deadToken } = issueDeviceToken(personId, "tv", "Dead TV");
    db.update(deviceTokens).set({ expiresAt: new Date(Date.now() - 1000).toISOString() }).where(eq(deviceTokens.tokenHash, hashDeviceToken(deadToken))).run();

    pruneExpiredDeviceTokens();

    expect(db.select().from(deviceTokens).where(eq(deviceTokens.tokenHash, hashDeviceToken(deadToken))).get()).toBeUndefined();
    expect(db.select().from(deviceTokens).where(eq(deviceTokens.tokenHash, hashDeviceToken(liveToken))).get()).toBeDefined();
  });
});

describe("deleteDevice()", () => {
  test("deletes the Device row and every token pointing at it", () => {
    const personId = insertPerson();
    const { token, deviceId } = issueDeviceToken(personId, "tv", "Living room TV");

    expect(deleteDevice(deviceId, personId)).toBe(true);

    expect(listDevicesForPerson(personId)).toHaveLength(0);
    expect(redeemDeviceToken(token, null)).toBeNull();
  });

  test("refuses to delete a device that belongs to someone else", () => {
    const owner = insertPerson();
    const attacker = insertPerson();
    const { deviceId } = issueDeviceToken(owner, "tv", "Owner's TV");

    expect(deleteDevice(deviceId, attacker)).toBe(false);
    expect(listDevicesForPerson(owner)).toHaveLength(1);
  });

  test("false for an unknown device id", () => {
    const personId = insertPerson();
    expect(deleteDevice("device-doesnotexist", personId)).toBe(false);
  });

  // FACE-03: a revoked device used to keep a live session for up to 7
  // more days (sessions.expiresAt's own TTL) - the real gap this item
  // closes. Constructs the session row directly (the same raw-insert
  // pattern tests/people.test.ts's own erasure test uses) rather than
  // going through issueSession()'s Hono Context, since only the row
  // itself and its device_id are under test here.
  test("deletes that device's own session rows, not another device's", () => {
    const personId = insertPerson();
    const { deviceId } = issueDeviceToken(personId, "tv", "Living room TV");
    const { deviceId: otherDeviceId } = issueDeviceToken(personId, "phone", "My phone");
    const now = new Date();
    const future = new Date(now.getTime() + 60_000).toISOString();
    db.insert(sessions)
      .values({ id: "session-revoked", personId, tokenHash: "hash-revoked", deviceId, expiresAt: future, createdAt: now.toISOString() })
      .run();
    db.insert(sessions)
      .values({ id: "session-other", personId, tokenHash: "hash-other", deviceId: otherDeviceId, expiresAt: future, createdAt: now.toISOString() })
      .run();

    expect(deleteDevice(deviceId, personId)).toBe(true);

    expect(db.select().from(sessions).where(eq(sessions.id, "session-revoked")).get()).toBeUndefined();
    expect(db.select().from(sessions).where(eq(sessions.id, "session-other")).get()).toBeDefined();
  });

  // The 10s in-memory session cache (middleware/auth.ts) is the other
  // half of the same gap: deleting the DB row alone isn't enough while a
  // cached hit for that exact session could still authenticate it for up
  // to 10 more seconds, the identical staleness invalidateSessionCache
  // ForPerson() already exists to close for the `enabled` flag. This test
  // fails if deleteDevice() ever stops calling it: without that call, the
  // second resolveSession() below would still return the stale cached
  // person even though the underlying row is gone.
  test("also invalidates a live session's 10s cache entry, not just its DB row", () => {
    __clearSessionCacheForTests();
    const personId = insertPerson();
    const { deviceId } = issueDeviceToken(personId, "tv", "Living room TV");
    const rawToken = "f".repeat(64);
    const now = new Date();
    db.insert(sessions)
      .values({
        id: "session-cache-test",
        personId,
        tokenHash: hashSessionToken(rawToken),
        deviceId,
        expiresAt: new Date(now.getTime() + 60_000).toISOString(),
        createdAt: now.toISOString(),
      })
      .run();

    // Primes the cache with a hit - the exact state a robot mid-poll
    // would be in the moment its device gets revoked.
    expect(resolveSession(rawToken)?.id).toBe(personId);

    expect(deleteDevice(deviceId, personId)).toBe(true);

    expect(resolveSession(rawToken)).toBeNull();
    expect(db.select().from(sessions).where(eq(sessions.id, "session-cache-test")).get()).toBeUndefined();
  });
});

describe("listDevicesForPerson()", () => {
  test("only lists devices paired to that person", () => {
    const a = insertPerson();
    const b = insertPerson();
    issueDeviceToken(a, "tv", "A's TV");
    issueDeviceToken(b, "phone", "B's phone");

    expect(listDevicesForPerson(a)).toHaveLength(1);
    expect(listDevicesForPerson(a)[0]!.name).toBe("A's TV");
  });
});
