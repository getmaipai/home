import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { people } from "@/db/schema";
import { createMediaSubject, subjectsForNames } from "@/lib/mediaSubjects";
import { makeSubjectSheet, sheetPromptFor } from "@/lib/mediaSubjectSheet";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { installFakeImageStack } from "./pictureFixture";
import { resetDb } from "./reset-db";
import type { PersonRow } from "@/types";
function person(id: string, role: string): PersonRow { const now = new Date().toISOString(); db.insert(people).values({ id, displayName: id, role, avatarSeed: id, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run(); return db.select().from(people).all().find((p) => p.id === id)!; }
describe("saved subject model sheets", () => {
  let fake: ReturnType<typeof installFakeImageStack>; let owner: PersonRow;
  beforeEach(() => { resetDb(); owner = person("person-sheetowner", "adult"); fake = installFakeImageStack(); __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { people_count: 0, apparent_min_age_estimate: null, label: "none" as const, is_nude_or_sexual: false, confidence: 1 } }))); });
  afterEach(() => { fake.restore(); });
  test("makes a sheet and exposes it apart from references", async () => { const subject = createMediaSubject(owner, { name: "Moss", kind: "character", look: "A green fox" }); expect(sheetPromptFor(subject)).toContain("A green fox"); const made = await makeSubjectSheet(owner, subject.id); expect(fake.submitted[0]?.size).toBe("1024x576"); const selected = subjectsForNames(owner, [subject.name])!; expect(selected[0]?.references).toEqual([]); expect(selected[0]?.sheet?.id).toBe(made.id); });
  test("refuses non-owners and guests", async () => { const subject = createMediaSubject(owner, { name: "Lamp", kind: "prop", look: "A brass lamp" }); await expect(makeSubjectSheet(person("person-sheetother", "adult"), subject.id)).rejects.toThrow("Subject unavailable"); await expect(makeSubjectSheet(person("person-sheetguest", "guest"), subject.id)).rejects.toThrow("Subject unavailable"); expect(fake.submitted).toHaveLength(0); });
});
