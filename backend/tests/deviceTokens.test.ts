import { describe, expect, test, beforeEach } from "bun:test";
import { db } from "@/db";
import { people, deviceTokens } from "@/db/schema";
import { newPersonId } from "@/lib/id";
import { issueDeviceToken, redeemDeviceToken, hashDeviceToken, pruneExpiredDeviceTokens } from "@/lib/deviceTokens";
import { listDevicesForPerson, deleteDevice } from "@/lib/devices";
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
