import { filmOverhead } from "@/lib/videos/editPlan";
import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people, filmRuns, productionDocuments } from "@/db/schema";
import { createMediaProduction, deleteMediaProduction } from "@/lib/mediaProductions";
import { createFilmRun, getFilmRun } from "@/lib/films/store";
import { approveDocument, getDocument, listDocuments, saveDocument, MAX_DOCUMENT_CHARS } from "@/lib/longform/documents";
import { MAX_PRODUCTION_SECONDS, MAX_SHOTS_PER_RUN, MIN_PRODUCTION_SECONDS, SCENE_MAX_SECONDS, SCENE_MIN_SECONDS, actsFor, estimateMinutes, planStructure, runsFor, sceneCountFor } from "@/lib/longform/structure";
import { resetDb } from "./reset-db";
import type { PersonRow } from "@/types";

describe("the structure is set by code from any length", () => {
  test("no length is special: every scene is within its limits and the parts add up", () => {
    for (const seconds of [20, 59, 60, 90, 119, 120, 180, 181, 240, 600, 1234, 3600, 5400, 7000, MAX_PRODUCTION_SECONDS]) {
      const r = planStructure(seconds); expect(r.ok).toBe(true); if (!r.ok) continue;
      const { plan } = r;
      expect(plan.scenes.reduce((n, s) => n + s.seconds, 0)).toBe(seconds - filmOverhead());
      for (const s of plan.scenes) {
        expect(s.runs.reduce((a, b) => a + b, 0)).toBe(s.shots);
        for (const run of s.runs) { expect(run).toBeGreaterThanOrEqual(1); expect(run).toBeLessThanOrEqual(MAX_SHOTS_PER_RUN); }
        if (plan.scenes.length > 1) { expect(s.seconds).toBeGreaterThanOrEqual(SCENE_MIN_SECONDS); }
        expect(s.seconds).toBeLessThanOrEqual(SCENE_MAX_SECONDS + 1);
      }
      expect(plan.totalShots).toBe(plan.scenes.reduce((n, s) => n + s.shots, 0));
    }
  });
  test("a short length is one scene; more length means more scenes, not longer ones", () => {
    expect(sceneCountFor(MIN_PRODUCTION_SECONDS)).toBe(1);
    expect(sceneCountFor(120)).toBe(1);
    expect(sceneCountFor(600)).toBe(5);
    expect(sceneCountFor(7200)).toBeGreaterThan(sceneCountFor(3600));
  });
  test("scene counts at the boundaries of the limits", () => {
    expect([59, 60, 119, 120, 121, 179, 180, 181, 239, 240].map((x) => sceneCountFor(x))).toEqual([1, 1, 1, 1, 1, 1, 2, 2, 2, 2]);
  });
  test("acts: one act for one or two scenes, otherwise three in roughly 1 : 2 : 1", () => {
    expect(actsFor(2)).toEqual([1, 1]);
    const a = actsFor(8); expect(a[0]).toBe(1); expect(a[7]).toBe(3); expect(a.filter((x) => x === 2).length).toBeGreaterThan(a.filter((x) => x === 1).length);
    expect(actsFor(3)).toEqual([1, 2, 3]);
  });
  test("a scene with many shots is several runs of at most twelve", () => {
    expect(runsFor(12)).toEqual([12]);
    expect(runsFor(13)).toEqual([7, 6]);
    expect(runsFor(36)).toEqual([12, 12, 12]);
  });
  test("lengths that cannot be a production are refused with one plain line", () => {
    for (const bad of [0, 10, Number.NaN, MAX_PRODUCTION_SECONDS + 1]) { const r = planStructure(bad); expect(r.ok).toBe(false); }
  });
  test("the estimate is the shots times this home's minutes per shot plus the retake allowance, or nothing before there is one", () => {
    const r = planStructure(300); if (!r.ok) throw new Error("plan");
    expect(estimateMinutes(r.plan, null)).toBeNull();
    expect(estimateMinutes(r.plan, 2, 0)).toBe(r.plan.totalShots * 2);
    expect(estimateMinutes(r.plan, 2, 0.5)).toBe(Math.round(r.plan.totalShots * 2 * 1.5));
  });
});

function person(id: string, role = "adult"): PersonRow {
  const now = new Date().toISOString();
  db.insert(people).values({ id, displayName: id, role, avatarSeed: id, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  return db.select().from(people).where(eq(people.id, id)).get() as PersonRow;
}
beforeEach(() => resetDb());

describe("production documents", () => {
  test("a document is versioned, a change clears its approval, and only the owner can save, read or approve", () => {
    const owner = person("lf-owner"), other = person("lf-other");
    const production = createMediaProduction(owner, { title: "Test" }, "long-form");
    const first = saveDocument(owner, { productionId: production.id, kind: "treatment", json: { logline: "A fox." }, source: "model" });
    expect(first).toMatchObject({ ok: true, document: { version: 1, approved: false, kind: "treatment", key: "main" } });
    expect(approveDocument(owner, production.id, "treatment")?.approved).toBe(true);
    const second = saveDocument(owner, { productionId: production.id, kind: "treatment", json: { logline: "A fox and a crow." }, source: "person" });
    expect(second).toMatchObject({ ok: true, document: { version: 2, approved: false } });
    expect(getDocument(owner, production.id, "treatment")?.json).toEqual({ logline: "A fox and a crow." });
    expect(saveDocument(other, { productionId: production.id, kind: "treatment", json: {}, source: "person" })).toMatchObject({ ok: false });
    expect(getDocument(other, production.id, "treatment")).toBeNull();
    expect(listDocuments(other, production.id)).toEqual([]);
    expect(approveDocument(other, production.id, "treatment")).toBeNull();
  });
  test("keys give one document per scene, an oversized document and an unknown kind are refused, and deleting the production deletes its documents", () => {
    const owner = person("lf-owner2");
    const production = createMediaProduction(owner, { title: "Test" }, "long-form");
    saveDocument(owner, { productionId: production.id, kind: "script", key: "scene-1", json: { lines: [] }, source: "model" });
    saveDocument(owner, { productionId: production.id, kind: "script", key: "scene-2", json: { lines: [] }, source: "model" });
    expect(listDocuments(owner, production.id)).toHaveLength(2);
    expect(saveDocument(owner, { productionId: production.id, kind: "bible", json: { x: "y".repeat(MAX_DOCUMENT_CHARS) }, source: "model" })).toMatchObject({ ok: false });
    expect(saveDocument(owner, { productionId: production.id, kind: "script", key: "../x", json: {}, source: "model" })).toMatchObject({ ok: false });
    expect(saveDocument(owner, { productionId: production.id, kind: "poem" as never, json: {}, source: "model" })).toMatchObject({ ok: false });
    deleteMediaProduction(owner, production.id);
    expect(db.select().from(productionDocuments).where(eq(productionDocuments.productionId, production.id)).all()).toHaveLength(0);
  });
});

describe("film runs under a production", () => {
  test("a scene run records its parent and scene key, and an ordinary film has neither", () => {
    const owner = person("lf-owner3");
    const parent = createFilmRun(owner, { idea: "The whole thing", goAhead: false });
    const scene = createFilmRun(owner, { idea: "Scene one", goAhead: true, parentId: parent.id, sceneKey: "scene-1" });
    expect(getFilmRun(owner, scene.id)).toMatchObject({ parent_id: parent.id, scene_key: "scene-1" });
    expect(getFilmRun(owner, parent.id)).toMatchObject({ parent_id: null, scene_key: null });
    expect(db.select().from(filmRuns).all()).toHaveLength(2);
    const production = createMediaProduction(owner, { title: "T" }, "long-form");
    db.update(filmRuns).set({ productionId: production.id }).where(eq(filmRuns.id, scene.id)).run();
    deleteMediaProduction(owner, production.id);
    expect(getFilmRun(owner, scene.id)).toBeNull();
  });
});
