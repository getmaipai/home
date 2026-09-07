import { describe, expect, test, beforeEach } from "bun:test";
import { db } from "@/db";
import { people, personCredentials, passkeyCredentials, sessions, deviceTokens, devices, totpSecrets } from "@/db/schema";
import { eq } from "drizzle-orm";
import { newPersonId } from "@/lib/id";
import { hashSecret } from "@/lib/secret";
import { issueDeviceToken } from "@/lib/deviceTokens";
import { listPending } from "@/lib/notifications";
import {
  memorializePerson,
  disableExpiredGuests,
  ageBandForBirthdate,
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

describe("ageBandForBirthdate()", () => {
  const today = new Date("2026-06-15T00:00:00.000Z");

  test("under 13 is child", () => {
    expect(ageBandForBirthdate("2015-01-01", today)).toBe("child"); // 11
  });

  test("13 to 17 is teen", () => {
    expect(ageBandForBirthdate("2012-01-01", today)).toBe("teen"); // 14
  });

  test("18 or older is adult", () => {
    expect(ageBandForBirthdate("2000-01-01", today)).toBe("adult"); // 26
  });

  test("the exact boundary respects whether the birthday has happened yet this year", () => {
    // Turns 13 on 2026-06-20 - 5 days after `today` (2026-06-15): still 12.
    expect(ageBandForBirthdate("2013-06-20", today)).toBe("child");
    // Turned 13 on 2026-06-10 - 5 days before `today`: already 13.
    expect(ageBandForBirthdate("2013-06-10", today)).toBe("teen");
  });
});

describe("applyAgeBandChanges()", () => {
  test("moves a child who turned 13 to teen, and notifies the adults", async () => {
    const adult = insertPerson({ displayName: "Sage", role: "adult" });
    const child = insertPerson({ displayName: "Bramble", role: "child", birthdate: "2013-01-01" });
    const today = new Date("2026-06-15T00:00:00.000Z");

    const moved = await applyAgeBandChanges(today);

    expect(moved).toEqual([child.id]);
    expect(db.select().from(people).where(eq(people.id, child.id)).get()!.role).toBe("teen");
    const pending = listPending(adult);
    expect(pending.some((n) => n.text.includes("Bramble") && n.text.includes("teen"))).toBe(true);
  });

  test("never touches someone with no birthdate on file", async () => {
    const child = insertPerson({ displayName: "Bramble", role: "child", birthdate: null });
    const moved = await applyAgeBandChanges(new Date("2026-06-15T00:00:00.000Z"));
    expect(moved).toEqual([]);
    expect(db.select().from(people).where(eq(people.id, child.id)).get()!.role).toBe("child");
  });

  test("never touches owner, admin or guest, even with a qualifying birthdate", async () => {
    const owner = insertPerson({ displayName: "Sage", role: "owner", birthdate: "2013-01-01" });
    const moved = await applyAgeBandChanges(new Date("2026-06-15T00:00:00.000Z"));
    expect(moved).toEqual([]);
    expect(db.select().from(people).where(eq(people.id, owner.id)).get()!.role).toBe("owner");
  });

  test("a person whose age already matches their role is left alone", async () => {
    const teen = insertPerson({ displayName: "Bramble", role: "teen", birthdate: "2012-01-01" }); // 14 in 2026
    const moved = await applyAgeBandChanges(new Date("2026-06-15T00:00:00.000Z"));
    expect(moved).toEqual([]);
    expect(db.select().from(people).where(eq(people.id, teen.id)).get()!.role).toBe("teen");
  });

  // Issues #35/#47: a code review of that fix found this was the one
  // path left that could produce a credential-free "adult" - neither
  // routes/people.ts's create nor checkRoleChange's promotion guard runs
  // here, since this write skipped both routes entirely.
  describe("a teen turning 18 with no credential (issues #35/#47)", () => {
    test("is held at teen, not silently promoted to a credential-free adult", async () => {
      const owner = insertPerson({ displayName: "Sage", role: "owner" });
      const teen = insertPerson({ displayName: "Vincent", role: "teen", birthdate: "2008-01-01" }); // 18 in 2026
      const moved = await applyAgeBandChanges(new Date("2026-06-15T00:00:00.000Z"));

      expect(moved).toEqual([]);
      expect(db.select().from(people).where(eq(people.id, teen.id)).get()!.role).toBe("teen");
      const pending = listPending(owner);
      expect(pending.some((n) => n.text.includes("Vincent") && n.text.includes("PIN"))).toBe(true);
    });

    // A review of the hold above (2026-09-06) found it re-notified on
    // EVERY run for as long as the hold lasted, unbounded spam breaking
    // the scheduled job's own "every run is idempotent" contract.
    test("does not re-notify on every subsequent run while still held", async () => {
      const owner = insertPerson({ displayName: "Sage", role: "owner" });
      insertPerson({ displayName: "Vincent", role: "teen", birthdate: "2008-01-01" });

      await applyAgeBandChanges(new Date("2026-06-15T00:00:00.000Z"));
      await applyAgeBandChanges(new Date("2026-06-16T00:00:00.000Z"));
      await applyAgeBandChanges(new Date("2026-06-17T00:00:00.000Z"));

      const matching = listPending(owner).filter((n) => n.text.includes("Vincent") && n.text.includes("PIN"));
      expect(matching.length).toBe(1);
    });

    // A second review of the dedup above (2026-09-06) found it keyed on
    // a LIKE match against the rendered displayName in the notification
    // text - displayName has no uniqueness constraint anywhere, so two
    // same-named people held in the same sweep silently suppressed each
    // other's notification. Fixed by keying on notificationDeliveries'
    // own subjectPersonId column instead.
    test("two same-named held people each get their own notification, not a merged one", async () => {
      const owner = insertPerson({ displayName: "Sage", role: "owner" });
      insertPerson({ id: "person-vincentone", displayName: "Vincent", role: "teen", birthdate: "2008-01-01" });
      insertPerson({ id: "person-vincenttwo", displayName: "Vincent", role: "teen", birthdate: "2008-02-01" });

      await applyAgeBandChanges(new Date("2026-06-15T00:00:00.000Z"));

      const matching = listPending(owner).filter((n) => n.text.includes("Vincent") && n.text.includes("PIN"));
      expect(matching.length).toBe(2);
    });

    test("stays a candidate on the next run, and completes once a credential exists", async () => {
      const teen = insertPerson({ displayName: "Vincent", role: "teen", birthdate: "2008-01-01" });
      await applyAgeBandChanges(new Date("2026-06-15T00:00:00.000Z"));
      expect(db.select().from(people).where(eq(people.id, teen.id)).get()!.role).toBe("teen");

      const now = new Date().toISOString();
      db.insert(personCredentials).values({ personId: teen.id, secretHash: await hashSecret("theirpin1"), failedAttempts: 0, createdAt: now, updatedAt: now }).run();

      const moved = await applyAgeBandChanges(new Date("2026-06-16T00:00:00.000Z"));
      expect(moved).toEqual([teen.id]);
      expect(db.select().from(people).where(eq(people.id, teen.id)).get()!.role).toBe("adult");
    });

    test("a teen who already has a credential is promoted immediately, same as before", async () => {
      const teen = insertPerson({ displayName: "Vincent", role: "teen", birthdate: "2008-01-01" });
      const now = new Date().toISOString();
      db.insert(personCredentials).values({ personId: teen.id, secretHash: await hashSecret("theirpin1"), failedAttempts: 0, createdAt: now, updatedAt: now }).run();

      const moved = await applyAgeBandChanges(new Date("2026-06-15T00:00:00.000Z"));
      expect(moved).toEqual([teen.id]);
      expect(db.select().from(people).where(eq(people.id, teen.id)).get()!.role).toBe("adult");
    });
  });
});
