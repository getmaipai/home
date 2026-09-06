import { describe, expect, test } from "bun:test";
import { speakerAgeBand } from "@/lib/ageBand";
import type { PersonRow } from "@/types";

function actor(overrides: Partial<PersonRow> = {}): PersonRow {
  return {
    id: "person-test",
    displayName: "Testy",
    nickname: null,
    birthdate: null,
    role: "adult",
    avatarSeed: "seed",
    source: "hub",
    localOnly: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    enabled: true,
    guestExpiresAt: null,
    memorializedAt: null,
    hlc: "1700000000000:0:test",
    ...overrides,
  };
}

const NOW = new Date("2026-09-06T00:00:00.000Z");

describe("speakerAgeBand()", () => {
  test("no birthdate on file falls back to role", () => {
    expect(speakerAgeBand(actor({ role: "child", birthdate: null }), NOW)).toBe("child");
    expect(speakerAgeBand(actor({ role: "teen", birthdate: null }), NOW)).toBe("teen");
    expect(speakerAgeBand(actor({ role: "adult", birthdate: null }), NOW)).toBe("adult");
    expect(speakerAgeBand(actor({ role: "owner", birthdate: null }), NOW)).toBe("adult");
  });

  test("a real birthdate wins over a mismatched role in both directions", () => {
    const fifteenYearsAgo = "2011-09-06";
    expect(speakerAgeBand(actor({ role: "adult", birthdate: fifteenYearsAgo }), NOW)).toBe("teen");
    const thirtyYearsAgo = "1996-09-06";
    expect(speakerAgeBand(actor({ role: "teen", birthdate: thirtyYearsAgo }), NOW)).toBe("adult");
  });

  test("band boundaries: under 13 is child, 13-17 is teen, 18+ is adult", () => {
    expect(speakerAgeBand(actor({ birthdate: "2013-09-07" }), NOW)).toBe("child"); // turns 13 tomorrow
    expect(speakerAgeBand(actor({ birthdate: "2013-09-06" }), NOW)).toBe("teen"); // turns 13 today
    expect(speakerAgeBand(actor({ birthdate: "2008-09-07" }), NOW)).toBe("teen"); // turns 18 tomorrow
    expect(speakerAgeBand(actor({ birthdate: "2008-09-06" }), NOW)).toBe("adult"); // turns 18 today
  });

  test("a malformed birthdate never silently falls through to adult - falls back to role instead", () => {
    expect(speakerAgeBand(actor({ role: "child", birthdate: "not-a-date" }), NOW)).toBe("child");
  });
});
