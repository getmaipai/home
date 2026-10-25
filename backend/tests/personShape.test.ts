import { describe, expect, test } from "bun:test";
import { toPerson, toRoster, parsePersonCandidate, personToDbValues, guestExpiryProblem } from "@/lib/personShape";
import { people } from "@/db/schema";
import type { PersonRow } from "@/types";

function personRow(overrides: Partial<typeof people.$inferInsert> = {}): PersonRow {
  const now = new Date().toISOString();
  const id = overrides.id ?? "person-abc123";
  return {
    id,
    displayName: "Test Person",
    nickname: null,
    bio: null,
    accent: null,
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
  } as PersonRow;
}

describe("toPerson", () => {
  test("converts a valid row to the spec Person shape", () => {
    const row = personRow();
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
    const row = personRow({
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
    const row = personRow({
      id: "person-memor1",
      displayName: "Deceased",
      memorializedAt: "2026-01-01T00:00:00.000Z",
    });
    const person = toPerson(row);
    expect(person.memorialized_at).toBe("2026-01-01T00:00:00.000Z");
  });

  test("handles a disabled person", () => {
    const row = personRow({ enabled: false });
    const person = toPerson(row);
    expect(person.enabled).toBe(false);
  });

  // PEOPLE-PROFILE-01: bio/accent were added to spec-v0.1.43 (PEOPLE-
  // GRID-01's landing note flagged them "not yet wired") - this is that
  // wiring, so it gets its own round-trip coverage the same way every
  // other field on this row already has.
  test("surfaces a set bio and accent", () => {
    const row = personRow({ id: "person-bioacc1", bio: "Likes dinosaurs", accent: "teal" });
    const person = toPerson(row);
    expect(person.bio).toBe("Likes dinosaurs");
    expect(person.accent).toBe("teal");
  });

  test("bio and accent default to null when never set", () => {
    const row = personRow({ id: "person-nobioacc" });
    const person = toPerson(row);
    expect(person.bio).toBeNull();
    expect(person.accent).toBeNull();
  });
});

describe("toRoster", () => {
  test("omits birthdate from the wire shape", () => {
    const row = personRow();
    const roster = toRoster(row);
    expect("birthdate" in roster).toBe(false);
    expect(roster.id).toBe("person-abc123");
    expect(roster.display_name).toBe("Test Person");
  });

  test("works for a disabled person", () => {
    const row = personRow({ id: "person-disab1", enabled: false });
    const roster = toRoster(row);
    expect(roster.id).toBe("person-disab1");
    expect(roster.enabled).toBe(false);
  });

  test("works for a live guest", () => {
    const row = personRow({
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
    const { birthdate: _birthdate, ...withoutBirthdate } = candidate;
    const absent = parsePersonCandidate(withoutBirthdate);
    expect(absent.success).toBe(true);
    if (absent.success) expect(absent.data.birthdate).toBeNull();
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
    const person = toPerson(personRow({ birthdate: "1990-01-01" }));
    const values = personToDbValues(person);
    expect(values.id).toBe(person.id);
    expect(values.displayName).toBe(person.display_name);
    expect(values.birthdate).toBe("1990-01-01");
    expect(values.avatarSeed).toBe(person.avatar_seed);
    expect(values.localOnly).toBe(person.local_only);
    expect(values.guestExpiresAt).toBe(person.guest_expires_at);
    expect(values.memorializedAt).toBe(person.memorialized_at);
  });

  test("round-trips bio and accent", () => {
    const person = toPerson(personRow({ id: "person-rtbioacc", bio: "Loves the beach", accent: "violet" }));
    const values = personToDbValues(person);
    expect(values.bio).toBe("Loves the beach");
    expect(values.accent).toBe("violet");
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
