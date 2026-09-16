import { describe, expect, test, beforeEach } from "bun:test";
import { toPerson, toRoster, parsePersonCandidate, personToDbValues, guestExpiryProblem } from "@/lib/personShape";
import { db } from "@/db";
import { people } from "@/db/schema";
import { resetDb } from "./reset-db";

beforeEach(() => resetDb());

function insertPerson(overrides: Partial<typeof people.$inferInsert> = {}) {
  const now = new Date().toISOString();
  const id = overrides.id ?? "person-abc123";
  const row = {
    id,
    displayName: "Test Person",
    nickname: null,
    birthdate: null,
    role: "adult",
    avatarSeed: id,
    source: "hub",
    localOnly: false,
    enabled: true,
    guestExpiresAt: null,
    memorializedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    hlc: "1700000000000:0:testfix",
    ...overrides,
  };
  db.insert(people).values(row).run();
  return db.select().from(people).all()[0]!;
}

describe("toPerson", () => {
  test("converts a valid row to the spec Person shape", () => {
    const row = insertPerson();
    const person = toPerson(row);
    expect(person.id).toBe("person-abc123");
    expect(person.display_name).toBe("Test Person");
    expect(person.role).toBe("adult");
    expect(person.enabled).toBe(true);
    expect(person.guest_expires_at).toBeNull();
    expect(person.created_at).toBe(row.createdAt);
    expect(person.updated_at).toBe(row.updatedAt);
    expect(person.hlc).toBe(row.hlc);
  });

  test("handles a guest with expiry", () => {
    const row = insertPerson({
      id: "person-guest1",
      displayName: "Guest",
      role: "guest",
      guestExpiresAt: "2026-12-31T00:00:00.000Z",
    });
    const person = toPerson(row);
    expect(person.role).toBe("guest");
    expect(person.guest_expires_at).toBe("2026-12-31T00:00:00.000Z");
  });

  test("handles a memorialized person", () => {
    const row = insertPerson({
      id: "person-memor1",
      displayName: "Deceased",
      memorializedAt: "2026-01-01T00:00:00.000Z",
    });
    const person = toPerson(row);
    expect(person.memorialized_at).toBe("2026-01-01T00:00:00.000Z");
  });

  test("handles a disabled person", () => {
    const row = insertPerson({ enabled: false });
    const person = toPerson(row);
    expect(person.enabled).toBe(false);
  });
});

describe("toRoster", () => {
  test("omits birthdate from the wire shape", () => {
    const row = insertPerson();
    const roster = toRoster(row);
    expect("birthdate" in roster).toBe(false);
    expect(roster.id).toBe("person-abc123");
    expect(roster.display_name).toBe("Test Person");
  });

  test("works for a disabled person", () => {
    const row = insertPerson({ id: "person-disab1", enabled: false });
    const roster = toRoster(row);
    expect(roster.id).toBe("person-disab1");
    expect(roster.enabled).toBe(false);
  });

  test("works for a live guest", () => {
    const row = insertPerson({
      id: "person-live123",
      role: "guest",
      guestExpiresAt: "2099-12-31T00:00:00.000Z",
    });
    const roster = toRoster(row);
    expect(roster.id).toBe("person-live123");
    expect(roster.guest_expires_at).toBe("2099-12-31T00:00:00.000Z");
  });
});

describe("parsePersonCandidate", () => {
  test("accepts a valid candidate", () => {
    const candidate = {
      id: "person-x12345",
      display_name: "X",
      nickname: null,
      birthdate: null,
      role: "adult",
      avatar_seed: "person-x12345",
      source: "hub",
      local_only: false,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      deleted_at: null,
      hlc: "1:0:abcdefgh",
      enabled: true,
      guest_expires_at: null,
      memorialized_at: null,
    };
    expect(parsePersonCandidate(candidate).success).toBe(true);
  });

  test("rejects a candidate with a missing field", () => {
    const candidate = { id: "person-x1", display_name: "X" };
    expect(parsePersonCandidate(candidate).success).toBe(false);
  });

  test("rejects an invalid role", () => {
    const candidate = {
      id: "person-x12345",
      display_name: "X",
      nickname: null,
      birthdate: null,
      role: "boss",
      avatar_seed: "person-x12345",
      source: "hub",
      local_only: false,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      deleted_at: null,
      hlc: "1:0:abcdefgh",
      enabled: true,
      guest_expires_at: null,
      memorialized_at: null,
    };
    expect(parsePersonCandidate(candidate).success).toBe(false);
  });
});

describe("personToDbValues", () => {
  test("round-trips a spec Person back to Drizzle row values", () => {
    const person = toPerson(insertPerson({ birthdate: "1990-01-01" }));
    const values = personToDbValues(person);
    expect(values.id).toBe(person.id);
    expect(values.displayName).toBe(person.display_name);
    expect(values.birthdate).toBe("1990-01-01");
    expect(values.avatarSeed).toBe(person.avatar_seed);
    expect(values.localOnly).toBe(person.local_only);
    expect(values.guestExpiresAt).toBe(person.guest_expires_at);
    expect(values.memorializedAt).toBe(person.memorialized_at);
  });
});

describe("guestExpiryProblem", () => {
  test("flags an expiry on a non-guest profile", () => {
    expect(guestExpiryProblem("adult", "2026-12-31T00:00:00.000Z")).toBe(
      "guest_expires_at is only meaningful on a guest profile",
    );
  });

  test("allows an expiry on a guest profile", () => {
    expect(guestExpiryProblem("guest", "2026-12-31T00:00:00.000Z")).toBeNull();
  });

  test("allows a null expiry on any profile", () => {
    expect(guestExpiryProblem("adult", null)).toBeNull();
  });
});
