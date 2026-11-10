import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { people } from "@/db/schema";
import { resetDb } from "./reset-db";
import { __setStageCompleterForTests, approveStage, startProduction, writeBible, writeOutline } from "@/lib/longform/stages";
import { getDocument } from "@/lib/longform/documents";
import { planStructure } from "@/lib/longform/structure";
import { buildShotList, writeScene, SHOT_MAX_SECONDS, SHOT_MIN_SECONDS } from "@/lib/longform/scripts";
import type { PersonRow } from "@/types";

function person(id: string): PersonRow {
  const now = new Date().toISOString();
  db.insert(people).values({ id, displayName: id, role: "adult", avatarSeed: id, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  return { id, displayName: id, role: "adult" } as unknown as PersonRow;
}
const treatment = { title: "T", logline: "l", look: "35mm", tone: "quiet", summary: "s" };
const bible = { cast: [{ name: "Marlow", description: "a keeper in a yellow coat" }, { name: "Nova", description: "a girl in red boots" }], locations: [{ name: "Tower", description: "a white tower" }], music: [], rules: [] };
function fake(seconds: number, items: unknown[]) {
  const p = planStructure(seconds); const keys = p.ok ? p.plan.scenes.map((s) => s.key) : [];
  __setStageCompleterForTests(async (m) => {
    const sys = m[0]!.content as string;
    if (sys.includes("treatment for")) return { ok: true, text: JSON.stringify(treatment) };
    if (sys.includes("bible for")) return { ok: true, text: JSON.stringify(bible) };
    if (sys.includes("outline")) return { ok: true, text: JSON.stringify({ scenes: keys.map((key) => ({ key, title: key, location: "Tower", cast: ["Marlow", "Nova"], beat: "b" })) }) };
    return { ok: true, text: JSON.stringify({ items }) };
  });
}
beforeEach(() => resetDb());
afterEach(() => __setStageCompleterForTests(null));

async function ready(owner: PersonRow, seconds: number) {
  const s = await startProduction(owner, { idea: "a keeper", seconds }); if (!s.ok) throw new Error("start");
  approveStage(owner, s.productionId, "treatment"); await writeBible(owner, s.productionId); approveStage(owner, s.productionId, "bible");
  await writeOutline(owner, s.productionId); approveStage(owner, s.productionId, "outline");
  return s;
}

describe("scene scripts and shot lists", () => {
  for (const seconds of [60, 400, 2500]) {
    test(`${seconds} s: every scene gets the planned shot count, 3 to 8 s, no repeated framing`, async () => {
      fake(seconds, [{ kind: "action", text: "Marlow climbs." }, { kind: "line", who: "Marlow", text: "Mind the step." }, { kind: "line", who: "Nova", text: "I will." }]);
      const owner = person(`p-${seconds}`); const s = await ready(owner, seconds);
      const scene = s.structure.scenes[0]!;
      const r = await writeScene(owner, s.productionId, scene.key); expect(r.ok).toBe(true);
      const list = getDocument(owner, s.productionId, "shotlist", scene.key)!.json as { shots: { seconds: number; framing: string; line?: string; still: string }[] };
      expect(list.shots.length).toBe(scene.shots);
      for (const [i, shot] of list.shots.entries()) {
        expect(shot.seconds).toBeGreaterThanOrEqual(SHOT_MIN_SECONDS); expect(shot.seconds).toBeLessThanOrEqual(SHOT_MAX_SECONDS);
        if (i > 0) expect(shot.framing).not.toBe(list.shots[i - 1]!.framing);
        expect(shot.still.length).toBeLessThanOrEqual(600);
      }
      expect(list.shots.some((x) => x.line)).toBe(true);
    });
  }
  test("a line from someone outside the bible is refused after one repair", async () => {
    fake(60, [{ kind: "line", who: "Ghost", text: "Boo." }]);
    const owner = person("p-bad"); const s = await ready(owner, 60);
    expect((await writeScene(owner, s.productionId, "scene-1")).ok).toBe(false);
  });
  test("scripts wait for the approved outline", async () => {
    fake(60, [{ kind: "action", text: "x" }]);
    const owner = person("p-early"); const s = await startProduction(owner, { idea: "a keeper", seconds: 60 }); if (!s.ok) throw new Error("x");
    expect((await writeScene(owner, s.productionId, "scene-1")).ok).toBe(false);
  });
  test("more script items than shots are trimmed to the plan", () => {
    const scene = { key: "scene-1", act: 1, seconds: 20, shots: 3, runs: [3] };
    const items = Array.from({ length: 9 }, (_, i) => ({ kind: "action" as const, text: `step ${i}` }));
    expect(buildShotList(scene, { key: "scene-1", title: "t", location: "Tower", cast: ["Marlow"], beat: "b" }, bible, { items }).shots.length).toBe(3);
  });
});
