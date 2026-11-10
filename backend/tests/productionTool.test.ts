import { isProducing } from "@/lib/longform/runner";
import { __setFilmEnginesForTests } from "@/lib/films/background";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { MAKE_PRODUCTION_TOOL_ID, isProductionCall, runMakeProduction } from "@/lib/longform/tool";
import { __setStageCompleterForTests } from "@/lib/longform/stages";
import { planStructure } from "@/lib/longform/structure";
import { getDocument } from "@/lib/longform/documents";
import type { PersonRow } from "@/types";

function person(role: string): PersonRow {
  const now = new Date().toISOString(); const id = `prod-${role}`;
  db.insert(people).values({ id, displayName: role, role, avatarSeed: id, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  return db.select().from(people).where(eq(people.id, id)).get() as PersonRow;
}
const run = (actor: PersonRow, args: Record<string, unknown>) => runMakeProduction({ state: { actor, surface: "chat", planBasis: { surfaceClass: "written" }, temporary: false } as never, args, callId: "c1", spoken: false });
const treatment = { title: "The Lighthouse", logline: "A keeper finds a boat.", look: "35mm", tone: "quiet", summary: "s" };
const bible = { cast: [{ name: "Marlow", description: "a keeper" }], locations: [{ name: "Tower", description: "a tower" }], music: [], rules: [] };
beforeEach(() => {
  resetDb();
  const keys = (planStructure(240) as { plan: { scenes: { key: string }[] } }).plan.scenes.map((s) => s.key);
  __setStageCompleterForTests(async (m) => {
    const sys = m[0]!.content as string;
    if (sys.includes("treatment for")) return { ok: true, text: JSON.stringify(treatment) };
    if (sys.includes("bible for")) return { ok: true, text: JSON.stringify(bible) };
    return { ok: true, text: JSON.stringify({ scenes: keys.map((key) => ({ key, title: key, location: "Tower", cast: ["Marlow"], beat: "b" })) }) };
  });
});
afterEach(() => __setStageCompleterForTests(null));

describe("make_production", () => {
  test("it is the make_film tool: a call past what one film holds, or naming a production, is a production", () => {
    const manifest = JSON.parse(readFileSync(join(import.meta.dir, "../packages/make_film/manifest.json"), "utf8"));
    expect(manifest).toMatchObject({ id: MAKE_PRODUCTION_TOOL_ID, min_role: "adult", offer: { gate: "filmAllowed" } });
    expect(Object.keys(manifest.args.properties)).toEqual(expect.arrayContaining(["production_id", "approve"]));
    expect(isProductionCall({ idea: "x", seconds: 60 })).toBe(false);
    expect(isProductionCall({ idea: "x", seconds: 121 })).toBe(true);
    expect(isProductionCall({ production_id: "p" })).toBe(true);
  });
  test("it asks for the story and the length before starting", async () => {
    const a = person("owner");
    expect((await run(a, {})).result?.data).toMatchObject({ refused: "needs_idea" });
    expect((await run(a, { idea: "a keeper finds a boat" })).result?.data).toMatchObject({ refused: "needs_length" });
  });
  test("pitch, then each yes writes the next part; the bible is approved before the outline", async () => {
    const a = person("owner");
    const pitch = await run(a, { idea: "a keeper finds a boat", seconds: 240 });
    const id = (pitch.result?.data as { productionId: string }).productionId; expect(id).toBeTruthy();
    expect(pitch.result?.reply?.text).toContain("The Lighthouse");
    const bibleStep = await run(a, { production_id: id, approve: true });
    expect(bibleStep.result?.data).toMatchObject({ stage: "bible" });
    expect(getDocument(a, id, "treatment")?.approved).toBe(true);
    const outlineStep = await run(a, { production_id: id, approve: true });
    expect(outlineStep.result?.data).toMatchObject({ stage: "outline" });
    expect(getDocument(a, id, "bible")?.approved).toBe(true);
    __setFilmEnginesForTests(() => ({ waitForIdle: async () => {}, ensureSubject: async () => "s", makeStill: async () => "p", makeClip: async () => "c", makeMusic: async () => "m", assemble: async () => "cut" }));
    expect((await run(a, { production_id: id, approve: true })).result?.data).toMatchObject({ approved: true, stage: "producing" });
    for (let i = 0; i < 200 && isProducing(id); i++) await new Promise((r) => setTimeout(r, 10));
    __setFilmEnginesForTests(null);
  });
  test("a teen is refused and a made-up production id is unknown", async () => {
    expect((await run(person("teen"), { idea: "a boat", seconds: 100 })).result?.data).toMatchObject({ refused: "not_allowed" });
    expect((await run(person("owner"), { production_id: "nope", approve: true })).result?.data).toMatchObject({ refused: "unknown" });
  });
});
