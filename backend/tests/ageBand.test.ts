import { describe, expect, test } from "bun:test";
import { speakerAgeBand } from "@/lib/ageBand";
import type { PersonRow } from "@/types";

function actor(overrides: Partial<PersonRow> = {}): PersonRow {
  return {
    id: "person-test",
    displayName: "Testy",
    nickname: null,
    bio: null,
    accent: null,
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
  for (const role of ["child", "teen", "adult", "owner", "admin", "guest"] as const) {
    test(`${role} uses only the role for every birthdate`, () => {
      for (const birthdate of [null, undefined, "", "not-a-date", "2026-02-30", "1990-01-01", "2011-09-06", "2020-01-01", "2099-01-01"]) {
        const person = actor({ role, birthdate });
        if (birthdate === undefined) delete (person as Partial<PersonRow>).birthdate;
        for (const now of [NOW, new Date("2100-01-01"), new Date(NaN)]) {
          expect(speakerAgeBand(person, now)).toBe(role === "child" || role === "teen" ? role : "adult");
        }
      }
    });
  }
  test("does not read birthdate", () => {
    const person = actor({ role: "teen" });
    Object.defineProperty(person, "birthdate", { get() { throw new Error("Birthdate must not be read"); } });
    expect(speakerAgeBand(person, NOW)).toBe("teen");
  });
});
