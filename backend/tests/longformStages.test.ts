import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { people } from "@/db/schema";
import { resetDb } from "./reset-db";
import { __setStageCompleterForTests, approveStage, mayRender, startProduction, writeBible, writeOutline } from "@/lib/longform/stages";
import { getDocument } from "@/lib/longform/documents";
import { planStructure } from "@/lib/longform/structure";
import type { PersonRow } from "@/types";

function person(id: string): PersonRow {
  const now = new Date().toISOString();
  db.insert(people).values({ id, displayName: id, role: "adult", avatarSeed: id, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  return { id, displayName: id, role: "adult" } as unknown as PersonRow;
}
const treatment = { title: "The Lighthouse", logline: "A keeper finds a boat.", look: "35mm, overcast", tone: "quiet", summary: "A keeper finds a boat and returns it." };
const bible = { cast: [{ name: "Marlow", description: "a grey-bearded keeper in a yellow coat" }], locations: [{ name: "Tower", description: "a white stone tower" }], music: [{ name: "Theme", mood: "slow strings" }], rules: [] };

let calls: string[] = [];
function fake(seconds: number) {
  const keys = planStructure(seconds).ok ? (planStructure(seconds) as { plan: { scenes: { key: string }[] } }).plan.scenes.map((s) => s.key) : [];
  __setStageCompleterForTests(async (messages) => {
    const sys = messages[0]!.content as string;
    calls.push(sys.slice(0, 20));
    if (sys.includes("treatment for")) return { ok: true, text: JSON.stringify(treatment) };
    if (sys.includes("bible for")) return { ok: true, text: JSON.stringify(bible) };
    return { ok: true, text: JSON.stringify({ scenes: keys.map((key) => ({ key, title: key, location: "Tower", cast: ["Marlow"], beat: "something happens" })) }) };
  });
}
beforeEach(() => { resetDb(); calls = []; });
afterEach(() => __setStageCompleterForTests(null));

describe("treatment, bible and outline run in order, each after approval", () => {
  for (const seconds of [90, 700, 3333]) {
    test(`${seconds} s: the outline has one entry per planned scene`, async () => {
      fake(seconds); const owner = person(`s-${seconds}`);
      const start = await startProduction(owner, { idea: "a keeper finds a boat", seconds });
      expect(start.ok).toBe(true); if (!start.ok) return;
      const id = start.productionId;
      expect((await writeBible(owner, id)).ok).toBe(false);
      approveStage(owner, id, "treatment");
      expect((await writeOutline(owner, id)).ok).toBe(false);
      expect((await writeBible(owner, id)).ok).toBe(true);
      expect(mayRender(owner, id)).toBe(false);
      approveStage(owner, id, "bible");
      expect(mayRender(owner, id)).toBe(true);
      const out = await writeOutline(owner, id); expect(out.ok).toBe(true);
      const doc = getDocument(owner, id, "outline")!;
      expect((doc.json as { scenes: unknown[] }).scenes.length).toBe(start.structure.scenes.length);
    });
  }
  test("an outline naming someone outside the bible is repaired once, then refused", async () => {
    const owner = person("s-bad");
    __setStageCompleterForTests(async (m) => {
      const sys = m[0]!.content as string;
      if (sys.includes("treatment for")) return { ok: true, text: JSON.stringify(treatment) };
      if (sys.includes("bible for")) return { ok: true, text: JSON.stringify(bible) };
      return { ok: true, text: JSON.stringify({ scenes: [{ key: "scene-1", title: "x", location: "Tower", cast: ["Ghost"], beat: "b" }] }) };
    });
    const start = await startProduction(owner, { idea: "a keeper", seconds: 60 }); if (!start.ok) throw new Error("start");
    approveStage(owner, start.productionId, "treatment"); await writeBible(owner, start.productionId); approveStage(owner, start.productionId, "bible");
    expect((await writeOutline(owner, start.productionId)).ok).toBe(false);
  });
  test("a model that is down gives a plain line and no production", async () => {
    __setStageCompleterForTests(async () => ({ ok: false, unavailable: true }));
    const r = await startProduction(person("s-down"), { idea: "a keeper", seconds: 120 });
    expect(r.ok).toBe(false);
  });
});
