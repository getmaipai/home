import { describe, expect, test, beforeEach } from "bun:test";
import { db } from "@/db";
import { people, personCredentials, passkeyCredentials, sessions, deviceTokens, devices, totpSecrets, pictureJobs, videoJobs, likenessAdapters } from "@/db/schema";
import { eq } from "drizzle-orm";
import { newPersonId } from "@/lib/id";
import { hashSecret } from "@/lib/secret";
import { issueDeviceToken } from "@/lib/deviceTokens";
import { listPending } from "@/lib/notifications";
import {
  memorializePerson,
  deletePerson,
  disableExpiredGuests,
  applyAgeBandChanges,
} from "@/lib/personLifecycle";
import type { PersonRow } from "@/types";
import { resetDb } from "./reset-db";

beforeEach(() => resetDb());

function insertPerson(overrides: Partial<typeof people.$inferInsert> = {}): PersonRow {
  const now = new Date().toISOString();
  const id = overrides.id ?? newPersonId();
  const row = {
    id,
    displayName: "Riff",
    role: "adult",
    avatarSeed: id,
    source: "hub" as const,
    createdAt: now,
    updatedAt: now,
    hlc: "1700000000000:0:testfix",
    ...overrides,
  };
  db.insert(people).values(row).run();
  return db.select().from(people).where(eq(people.id, id)).get()!;
}

describe("memorializePerson()", () => {
  test("revokes every credential and session, and sets memorialized_at exactly once", async () => {
    const owner = insertPerson({ role: "owner" });
    const target = insertPerson({ displayName: "Iris", role: "adult" });
    const now = new Date().toISOString();
    db.insert(personCredentials).values({ personId: target.id, secretHash: await hashSecret("x"), failedAttempts: 0, createdAt: now, updatedAt: now }).run();
    db.insert(passkeyCredentials).values({ id: "cred-1", personId: target.id, publicKey: "x", counter: 0, transports: "[]", deviceType: "singleDevice", backedUp: false, name: "iPhone", createdAt: now }).run();
    db.insert(sessions).values({ id: "sess-1", personId: target.id, tokenHash: "hash", expiresAt: now, createdAt: now }).run();
    db.insert(totpSecrets).values({ personId: target.id, secretEncrypted: "enc", enabled: true, createdAt: now, updatedAt: now }).run();
    issueDeviceToken(target.id, "phone", "Their phone");

    const result = memorializePerson(owner, target.id);
    expect(result.ok).toBe(true);

    expect(db.select().from(personCredentials).where(eq(personCredentials.personId, target.id)).all()).toHaveLength(0);
    expect(db.select().from(passkeyCredentials).where(eq(passkeyCredentials.personId, target.id)).all()).toHaveLength(0);
    expect(db.select().from(sessions).where(eq(sessions.personId, target.id)).all()).toHaveLength(0);
    expect(db.select().from(totpSecrets).where(eq(totpSecrets.personId, target.id)).all()).toHaveLength(0);
    expect(db.select().from(devices).where(eq(devices.personId, target.id)).all()).toHaveLength(0);
    expect(db.select().from(deviceTokens).all()).toHaveLength(0);

    const row = db.select().from(people).where(eq(people.id, target.id)).get()!;
    expect(row.memorializedAt).not.toBeNull();
  });

  test("keeps memories and conversations untouched - it is not a delete", () => {
    const owner = insertPerson({ role: "owner" });
    const target = insertPerson({ displayName: "Iris", role: "adult" });
    memorializePerson(owner, target.id);
    // Still present (soft, not tombstoned): deletedAt stays null.
    const row = db.select().from(people).where(eq(people.id, target.id)).get()!;
    expect(row.deletedAt).toBeNull();
  });

  test("refuses to memorialize your own profile", () => {
    const owner = insertPerson({ role: "owner" });
    const result = memorializePerson(owner, owner.id);
    expect(result.ok).toBe(false);
  });

  test("calling it twice is a harmless no-op, not an error", () => {
    const owner = insertPerson({ role: "owner" });
    const target = insertPerson({ displayName: "Iris", role: "adult" });
    memorializePerson(owner, target.id);
    const firstMemorializedAt = db.select().from(people).where(eq(people.id, target.id)).get()!.memorializedAt;
    const second = memorializePerson(owner, target.id);
    expect(second.ok).toBe(true);
    const secondMemorializedAt = db.select().from(people).where(eq(people.id, target.id)).get()!.memorializedAt;
    expect(secondMemorializedAt).toBe(firstMemorializedAt!); // unchanged - "set once, never cleared"
  });

  test("refuses when the actor cannot manage the target's role", () => {
    const admin = insertPerson({ role: "admin" });
    const owner = insertPerson({ displayName: "Sage", role: "owner" });
    const result = memorializePerson(admin, owner.id);
    expect(result.ok).toBe(false);
  });
});

describe("delete likeness cleanup", () => {
  test("deleting a person queues their styles for removal and stops waiting picture and video jobs", () => {
    const owner = insertPerson({ role: "owner" });
    const target = insertPerson({ displayName: "Marlow", role: "adult" });
    const now = new Date().toISOString();
    db.insert(likenessAdapters).values({ id: "la-delete-style", adapterId: "lora-delete-style", medium: "picture", subjectPersonId: target.id, classification: "all-ages", state: "active", declaredBy: owner.id, source: "import", createdAt: now, updatedAt: now, hlc: "1:0:testfix" }).run();
    const request = JSON.stringify({ size: "1024x1024", n: 1, seed: null, loras: [], source_file_id: null, audience: "adult", stackBody: {}, likeness: { subject: target.id, requester: owner.id, way: "photo", adultContent: false } });
    for (const table of [pictureJobs, videoJobs]) db.insert(table).values({ id: `job-${table === pictureJobs ? "picture" : "video"}`, personId: owner.id, conversationId: null, turnId: null, kind: "generate", ...(table === pictureJobs ? { purpose: null } : {}), state: "queued", stackJob: null, percent: 0, phase: "queued", position: null, prompt: "portrait", request, error: null, files: "[]", createdAt: now, updatedAt: now, hlc: "1:0:testfix" } as never).run();
    expect(deletePerson(owner, target.id).ok).toBe(true);
    expect(db.select().from(pictureJobs).get()?.state).toBe("failed");
    expect(db.select().from(videoJobs).get()?.state).toBe("failed");
    expect(db.select().from(likenessAdapters).get()?.state).not.toBe("active");
  });
});

describe("disableExpiredGuests()", () => {
  test("disables a guest past their own expiry, leaves everyone else alone", () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const future = new Date(Date.now() + 1000 * 60 * 60).toISOString();
    const expiredGuest = insertPerson({ displayName: "Guest A", role: "guest", guestExpiresAt: past });
    const liveGuest = insertPerson({ displayName: "Guest B", role: "guest", guestExpiresAt: future });
    const adult = insertPerson({ displayName: "Adult", role: "adult" });

    const disabled = disableExpiredGuests();

    expect(disabled).toEqual([expiredGuest.id]);
    expect(db.select().from(people).where(eq(people.id, expiredGuest.id)).get()!.enabled).toBe(false);
    expect(db.select().from(people).where(eq(people.id, liveGuest.id)).get()!.enabled).toBe(true);
    expect(db.select().from(people).where(eq(people.id, adult.id)).get()!.enabled).toBe(true);
  });

  test("never re-processes an already-disabled guest", () => {
    const past = new Date(Date.now() - 1000).toISOString();
    insertPerson({ displayName: "Guest", role: "guest", guestExpiresAt: past });
    disableExpiredGuests();
    expect(disableExpiredGuests()).toEqual([]); // already enabled: false, not matched again
  });
});

describe("retired date-driven aging", () => {
  test("never changes any role or notifies, even across birthdays with credentials", async () => {
    const owner = insertPerson({ displayName: "Sage", role: "owner" });
    for (const role of ["child", "teen", "adult", "admin", "owner", "guest"]) {
      for (const birthdate of [null, "2013-01-01", "2008-01-01", "1990-01-01"]) {
        const person = insertPerson({ role, birthdate });
        const now = new Date().toISOString();
        db.insert(personCredentials).values({ personId: person.id, secretHash: await hashSecret("1234"), failedAttempts: 0, createdAt: now, updatedAt: now }).run();
        expect(await applyAgeBandChanges(new Date("2026-06-15T00:00:00Z"))).toEqual([]);
        expect(await applyAgeBandChanges(new Date("2036-06-15T00:00:00Z"))).toEqual([]);
        expect(db.select().from(people).where(eq(people.id, person.id)).get()).toEqual(person);
      }
    }
    expect(listPending(owner)).toEqual([]);
  });
});
