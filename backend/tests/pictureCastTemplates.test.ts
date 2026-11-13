// CREATOR-14 slice 1: picture templates with a cast slot (a template blank whose name starts with `cast_`).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { MediaTemplate } from "@maipai/spec/gen/ts/media-template.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { listTemplates } from "@/lib/media/templates";
import { createMediaSubject } from "@/lib/mediaSubjects";
import { makePictureFor, readPictureMakeBody } from "@/lib/pictures/make";
import { getPictureJob, __resetPictureJobsForTests } from "@/lib/pictures/jobs";
import { __setRoleHealthForTests } from "@/lib/roleHealth";
import { __setImageToolsForTests } from "@/lib/imageEdit";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { __setPicturePollMsForTests } from "@/lib/pictures/jobs";
import { resetDb } from "./reset-db";
import { installFakeImageStack, until, type FakeImageStack } from "./pictureFixture";
import { TestClient } from "./client";
import type { PersonRow } from "@/types";

const IDS = ["mtpl-tryonoutfit", "mtpl-productplacement", "mtpl-moodboard", "mtpl-photodump", "mtpl-adpack"];
let owner: PersonRow;
let fake: FakeImageStack;

beforeEach(async () => {
  resetDb(); __resetPictureJobsForTests(); __setImageToolsForTests({ state: "idle", phase: null, vision: true, models: {}, limits: { max_n: 4 }, operations: [], reason: null }, true);
  __setRoleHealthForTests({ image: { availability: "ready", reason: null } });
  fake = installFakeImageStack({ pollsToFinish: 1 });
  const client = new TestClient();
  const setup = await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  owner = db.select().from(people).where(eq(people.id, ((await setup.json()) as { person: { id: string } }).person.id)).get()!;
});
afterEach(() => { fake.restore(); __setStackClientForTests(null); __resetStackEngineForTests(); __setImageToolsForTests(undefined); __setRoleHealthForTests({}); __setPicturePollMsForTests(null); __resetPictureJobsForTests(); });

describe("cast picture templates", () => {
  test("the five new records are listed and parse against the spec", () => {
    const listed = listTemplates({ actor: owner, kind: "picture" }).map((row) => row.id);
    for (const id of IDS) {
      expect(listed).toContain(id);
      const raw = JSON.parse(readFileSync(join(import.meta.dir, `../packages/generate_image/images/templates/${id === "mtpl-tryonoutfit" ? "mtpl-tryon" : id}.json`), "utf8"));
      expect(MediaTemplate.safeParse(raw).success).toBe(true);
    }
  });

  test("a cast blank puts the member's look and id on the job and reads 'this person' in the prompt", async () => {
    const saved = createMediaSubject(owner, { name: "Pip", kind: "character", look: "a tiny blue fox" });
    const made = await makePictureFor(owner, { prompt: "", template: "mtpl-tryonoutfit", blanks: { cast_person: saved.id, garment: "a red coat" } });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    await until(() => !!getPictureJob(owner, made.ids[0]!));
    const job = getPictureJob(owner, made.ids[0]!)!;
    const prompt = String((job.request as unknown as { stackBody: { prompt: string } }).stackBody.prompt);
    expect(prompt).toContain("this person wearing a red coat");
    expect(prompt).toContain("a tiny blue fox");
    expect((job.request as unknown as { subject_ids?: string[] }).subject_ids).toContain(saved.id);
  });

  test("through the reader: an empty prompt with a template and blanks makes the picture", async () => {
    const saved = createMediaSubject(owner, { name: "Pip", kind: "character", look: "a tiny blue fox" });
    const read = readPictureMakeBody({ prompt: "", template: "mtpl-tryonoutfit", blanks: { cast_person: saved.id, garment: "a red coat" } });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const made = await makePictureFor(owner, read.body);
    expect(made.ok).toBe(true);
  });

  test("a missing cast blank asks for it and starts nothing", async () => {
    const made = await makePictureFor(owner, { prompt: "", template: "mtpl-tryonoutfit", blanks: { garment: "a red coat" } });
    expect(made.ok).toBe(false);
    if (!made.ok) expect(made.error).toContain("Ask for cast person");
    expect(fake.submitted).toHaveLength(0);
  });

  test("an unknown cast id is refused with the cast line", async () => {
    const made = await makePictureFor(owner, { prompt: "", template: "mtpl-tryonoutfit", blanks: { cast_person: "msub-ffffffffff", garment: "a red coat" } });
    expect(made.ok).toBe(false);
    if (!made.ok) expect(made.error).toContain("is not in your cast list");
    expect(fake.submitted).toHaveLength(0);
  });

  test("a template without a cast blank runs as before", async () => {
    // Fill whatever blanks the poster asks for, so the test does not depend on their names.
    const tpl = JSON.parse(readFileSync(join(import.meta.dir, "../packages/generate_image/images/templates/mtpl-poster.json"), "utf8")) as { prompt: string };
    const names = [...tpl.prompt.matchAll(/\{\{([a-z][a-z0-9_]*)\|/g)].map((m) => m[1]!);
    const again = await makePictureFor(owner, { prompt: "", template: "mtpl-poster", blanks: Object.fromEntries(names.map((n) => [n, "something nice"])) });
    expect(again.ok).toBe(true);
  });
});
