import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { people } from "@/db/schema";
import { resetDb } from "./reset-db";
import { createMediaSubject } from "@/lib/mediaSubjects";
import { __setFilmEnginesForTests } from "@/lib/films/background";
import { listFilmRunsByParent } from "@/lib/films/store";
import { __setStageCompleterForTests, approveStage, startProduction, writeBible, writeOutline } from "@/lib/longform/stages";
import { planStructure } from "@/lib/longform/structure";
import { produce, renderScene } from "@/lib/longform/runner";
import type { PersonRow } from "@/types";

function person(id: string): PersonRow {
  const now = new Date().toISOString();
  db.insert(people).values({ id, displayName: id, role: "adult", avatarSeed: id, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  return db.select().from(people).all().find((p) => p.id === id)!;
}
const bible = { cast: [{ name: "Marlow", description: "a keeper in a yellow coat" }], locations: [{ name: "Tower", description: "a white tower" }], music: [{ name: "Theme", mood: "slow strings" }], rules: [] };
let clips: string[] = [];
let plans: Array<{ title_card?: boolean; credits_card?: boolean }> = [];
function engines(failOn?: string) {
  __setFilmEnginesForTests(({ actor }) => ({ waitForIdle: async () => {}, ensureSubject: async ({ name, kind, locked }) => createMediaSubject(actor, { name, kind, look: locked }).id,
    makeStill: async ({ shot }) => `pic:${shot.id}`, makeClip: async ({ shot }) => { if (failOn && shot.id === failOn) throw new Error("boom"); clips.push(shot.id); return `clip:${shot.id}`; },
    makeMusic: async () => "music", assemble: async ({ plan }) => { plans.push({ title_card: plan.title_card, credits_card: plan.credits_card }); return "cut"; } }));
}
function writer(seconds: number) {
  const p = planStructure(seconds); const keys = p.ok ? p.plan.scenes.map((s) => s.key) : [];
  __setStageCompleterForTests(async (m) => {
    const sys = m[0]!.content as string;
    if (sys.includes("treatment for")) return { ok: true, text: JSON.stringify({ title: "T", logline: "l", look: "35mm", tone: "q", summary: "s" }) };
    if (sys.includes("bible for")) return { ok: true, text: JSON.stringify(bible) };
    if (sys.includes("outline")) return { ok: true, text: JSON.stringify({ scenes: keys.map((key) => ({ key, title: key, location: "Tower", cast: ["Marlow"], beat: "b" })) }) };
    return { ok: true, text: JSON.stringify({ items: [{ kind: "action", text: "Marlow climbs." }, { kind: "line", who: "Marlow", text: "Mind the step." }] }) };
  });
}
beforeEach(() => { resetDb(); clips = []; plans = []; });
afterEach(() => { __setStageCompleterForTests(null); __setFilmEnginesForTests(null); });

async function ready(owner: PersonRow, seconds: number, approveAll = true) {
  const s = await startProduction(owner, { idea: "a keeper", seconds }); if (!s.ok) throw new Error("start");
  approveStage(owner, s.productionId, "treatment"); await writeBible(owner, s.productionId); approveStage(owner, s.productionId, "bible");
  await writeOutline(owner, s.productionId); if (approveAll) approveStage(owner, s.productionId, "outline");
  return s;
}

describe("the scene runner", () => {
  test("renders every shot of every scene as film runs tied to the production", async () => {
    writer(130); engines();
    const owner = person("r1"); const s = await ready(owner, 130);
    const r = await produce(owner, s.productionId);
    expect(r).toMatchObject({ ok: true, scenes_done: s.structure.scenes.length });
    const runs = listFilmRunsByParent(owner, s.productionId);
    expect(runs.length).toBe(s.structure.totalRuns); expect(runs.every((x) => x.state === "done" && x.scene_key)).toBe(true);
    expect(clips.length).toBe(s.structure.totalShots);
  });
  test("nothing renders before the outline is approved", async () => {
    writer(60); engines();
    const owner = person("r2"); const s = await ready(owner, 60, false);
    expect((await renderScene(owner, s.productionId, "scene-1")).ok).toBe(false); expect(clips.length).toBe(0);
  });
  test("a failed shot stops the run with a plain line, and Resume skips the runs already done", async () => {
    writer(260); const owner = person("r3"); const s = await ready(owner, 260);
    engines("scene-2-shot-1");
    const first = await produce(owner, s.productionId);
    expect(first.ok).toBe(false); expect(first.scenes_done).toBe(1);
    const done1 = clips.length; engines();
    const again = await produce(owner, s.productionId);
    expect(again.ok).toBe(true); expect(clips.length).toBe(s.structure.totalShots); expect(done1).toBeLessThan(clips.length);
    expect(listFilmRunsByParent(owner, s.productionId).filter((x) => x.state === "done").length).toBeGreaterThanOrEqual(s.structure.totalRuns);
  });
  test("only the first run has a title card and only the last has the credits", async () => {
    writer(400); engines();
    const owner = person("r4"); const s = await ready(owner, 400);
    expect(s.structure.totalRuns).toBeGreaterThan(2);
    expect((await produce(owner, s.productionId)).ok).toBe(true);
    expect(plans.length).toBe(s.structure.totalRuns);
    expect(plans.map((p) => p.title_card)).toEqual(plans.map((_, i) => i === 0));
    expect(plans.map((p) => p.credits_card)).toEqual(plans.map((_, i) => i === plans.length - 1));
  });
});
