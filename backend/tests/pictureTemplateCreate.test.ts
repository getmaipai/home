import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import { db } from "@/db";
import { people } from "@/db/schema";
import { resetDb } from "./reset-db";
import { createBenchPeople } from "../scripts/bench/conversationRunner";
import { installFakeImageStack, until, type FakeImageStack } from "./pictureFixture";
import { makePictureFor } from "@/lib/pictures/make";
import { listTemplates } from "@/lib/media/templates";
import { __setPictureStatusForTests, readyStatusForTests } from "@/lib/pictures/ready";
import { PICTURE_MODEL } from "@/lib/pictures/quality";
import type { PersonRow } from "@/types";

let owner: PersonRow;
let fake: FakeImageStack;
beforeEach(() => {
  resetDb();
  const peopleSet = createBenchPeople();
  owner = peopleSet.owner;
  fake = installFakeImageStack({ pollsToFinish: 1 });
  __setPictureStatusForTests(readyStatusForTests({ models: [{ id: "flux2-klein-4b", family: "flux2", installed: true, licence: "Apache-2.0", loras: true, edit: true, steps_default: 4, peak_gb: 13.5 }, { id: PICTURE_MODEL, family: PICTURE_MODEL, installed: true, available: true, licence: "Apache-2.0", edit: false, steps_default: 8, peak_gb: 18.8 }] }));
});
afterEach(() => fake.restore());

const promptBlanks = (prompt: string) => [...prompt.matchAll(/\{\{([a-z][a-z0-9_]*)\|([^|}]+)\|([^}]*)\}\}/g)].map((m) => ({ name: m[1]!, label: m[2]!, example: m[3]!.trim() }));

describe("picture template Create", () => {
  test("uses typed prompt for product, example headline for words, and template aspect", async () => {
    const result = await makePictureFor(owner, { prompt: "a pink hoverboard", template: "mtpl-adpack" });
    expect(result.ok).toBe(true);
    const submitted = fake.submitted[0]!;
    expect(submitted.prompt).toContain("a pink hoverboard");
    expect(submitted.prompt).toContain('"Cool and bright"');
    expect(submitted.prompt).not.toContain("{{");
    expect(submitted.size).toBe("896x1152");
    expect(submitted.model).toBe(PICTURE_MODEL);
  });

  test("fills every bundled picture template and refuses unchosen cast slots", async () => {
    const templateDir = new URL("../packages/generate_image/images/templates", import.meta.url);
    const templates = readdirSync(templateDir).filter((name) => name.endsWith(".json")).map((name) => JSON.parse(readFileSync(new URL(`../packages/generate_image/images/templates/${name}`, import.meta.url), "utf8")) as { id: string; prompt: string });
    expect(templates).toHaveLength(23);
    for (const template of templates) {
      const before = fake.submitted.length;
      const hasCast = promptBlanks(template.prompt).some((blank) => blank.name.startsWith("cast_"));
      const result = await makePictureFor(owner, { prompt: "", template: template.id, ...(hasCast ? { cast: [owner.id] } : {}) });
      if (result.ok) await until(() => fake.submitted.length > before);
      if (result.ok) expect(String(fake.submitted.at(-1)?.prompt)).not.toContain("{{");
      else expect(result.error).toBe("This template needs a person from your cast. Pick one in Cast, then try again.");
      if (!result.ok) expect(fake.submitted.length).toBe(before);
    }
    expect(fake.submitted).toHaveLength(templates.length);
  });

  test("a cast template with no cast returns the plain cast instruction", async () => {
    const result = await makePictureFor(owner, { prompt: "", template: "mtpl-tryonoutfit" });
    expect(result).toMatchObject({ ok: false, status: 422, error: "This template needs a person from your cast. Pick one in Cast, then try again." });
    expect(fake.submitted).toHaveLength(0);
  });
});
