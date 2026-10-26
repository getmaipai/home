import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people as peopleTable } from "@/db/schema";
import { decideLikeness, ADULT_CONTENT_OTHER_SUBJECT_LINE } from "@/lib/likeness/decide";
import { setValue, getSettingValueForPerson } from "@/lib/settings";
import { createBenchPeople, type BenchPeople } from "../scripts/bench/conversationRunner";
import type { PersonRow } from "@/types";

let bench: BenchPeople;
let actor: PersonRow;
let subject: PersonRow;

function addPerson(name: string, role: string): PersonRow {
  const now = new Date().toISOString();
  db.insert(peopleTable).values({ id: `p-${name.toLowerCase()}`, displayName: name, role, avatarSeed: name, source: "test", createdAt: now, updatedAt: now, hlc: "1:0:test00" }).run();
  return db.select().from(peopleTable).where(eq(peopleTable.id, `p-${name.toLowerCase()}`)).get()! as PersonRow;
}

const audience = (person: PersonRow, surfaceClass: "written" | "spoken" = "written") => ({ actor: person, band: "adult" as const, surface: "chat" as const, surfaceClass, spoken: surfaceClass === "spoken" });
const household = (on: boolean) => setValue(bench.owner, "household", "generation.household_likeness", on);

beforeEach(() => {
  resetDb();
  bench = createBenchPeople();
  actor = addPerson("Nadia", "adult");
  subject = addPerson("Marlow", "adult");
});

describe("household likeness setting", () => {
  test("default-on allows an eligible adult subject and turning it off restores the refusal", () => {
    expect(decideLikeness({ requester: audience(actor), subjectPersonId: subject.id, adultContent: false })).toMatchObject({ ok: true, self: false });
    expect(household(false).ok).toBe(true);
    expect(decideLikeness({ requester: audience(actor), subjectPersonId: subject.id, adultContent: false })).toMatchObject({ ok: false, denial: "household_off" });
    expect(household(true).ok).toBe(true);
    expect(decideLikeness({ requester: audience(actor), subjectPersonId: subject.id, adultContent: false })).toMatchObject({ ok: true });
  });

  test("a minor and an unknown identity are refused", () => {
    const child = addPerson("Nova", "child");
    expect(decideLikeness({ requester: audience(actor), subjectPersonId: child.id, adultContent: false })).toMatchObject({ ok: false, denial: "subject_minor" });
    expect(decideLikeness({ requester: audience(actor), subjectPersonId: "p-missing", adultContent: false })).toMatchObject({ ok: false, denial: "subject_unknown" });
  });

  test("adult content of another adult fails closed with the named refusal, while self is allowed", () => {
    const other = decideLikeness({ requester: audience(actor), subjectPersonId: subject.id, adultContent: true });
    expect(other).toEqual({ ok: false, denial: "adult_content_other_subject", line: ADULT_CONTENT_OTHER_SUBJECT_LINE });
    expect(decideLikeness({ requester: audience(actor), subjectPersonId: actor.id, adultContent: true })).toMatchObject({ ok: true, self: true });
  });

  test("retired settings keys are unknown and old stored values do not grant access", () => {
    const oldValues = ["likeness.adults", "likeness.adult_content"];
    for (const key of oldValues) {
      expect(setValue(bench.owner, `person:${subject.id}`, key, true)).toMatchObject({ ok: false, status: 400, error: `unknown settings key: ${key}` });
      expect(getSettingValueForPerson(subject.id, key)).toBeUndefined();
    }
    expect(decideLikeness({ requester: audience(actor), subjectPersonId: subject.id, adultContent: false })).toMatchObject({ ok: true });
  });

  test("requester surface gate still blocks a spoken turn", () => {
    expect(decideLikeness({ requester: audience(actor, "spoken"), subjectPersonId: subject.id, adultContent: false })).toMatchObject({ ok: false, denial: "requester" });
  });
});
