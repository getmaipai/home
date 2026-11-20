import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { db } from "@/db";
import { filmRuns, people } from "@/db/schema";
import { resetDb } from "../../../tests/reset-db";
import { filmProgressRows, filmShotJobIds, parseProgress, readProgress, recordShotFailure, recordShotJob, recordShotNote, shotProgressRow } from "./filmProgress";
import type { PersonRow } from "@/types";

const stamp = new Date().toISOString();
function addPerson(id: string, role: string): PersonRow {
  db.insert(people).values({ id, displayName: id, role, avatarSeed: id, source: "local", createdAt: stamp, updatedAt: stamp, hlc: "1:0:test" }).run();
  return db.select().from(people).all().find((person) => person.id === id)!;
}
function addRun(personId: string, id: string, productionId: string | null, progressJson?: string): void {
  db.insert(filmRuns).values({ id, personId, productionId, idea: "A short story", planJson: null, state: "running", stage: "Clips", doneSteps: 1, totalSteps: 6, filmFileId: null, note: null, errorLine: null, goAhead: true, parentId: null, sceneKey: null, createdAt: stamp, updatedAt: stamp, ...(progressJson !== undefined ? { progressJson } : {}) }).run();
}
beforeEach(() => resetDb());

describe("the progress column", () => {
  test("a run with no column value, an unreadable one or a shape from the future loads as no links", () => {
    const owner = addPerson("o1", "owner");
    addRun(owner.id, "run-old", "prod-1");
    expect(readProgress("run-old")).toEqual({ shots: {} });
    expect(parseProgress("not json")).toEqual({ shots: {} });
    expect(parseProgress('{"shots": 7}')).toEqual({ shots: {} });
    expect(parseProgress('{"shots": {"a": {"job_id": "vid-1", "extra": true}, "b": 3}}')).toEqual({ shots: { a: { job_id: "vid-1" } } });
  });

  test("the runner's writes merge: the link, a held reason, the failure words and a note, per shot, and clear again", () => {
    const owner = addPerson("o2", "owner");
    addRun(owner.id, "run-1", "prod-2");
    recordShotJob("prod-2", "s1", "vid-a");
    recordShotNote("prod-2", "s1", { held_reason: "Waiting for another job" });
    recordShotFailure("prod-2", "s2", "The face did not match, twice.");
    recordShotNote("prod-2", "s1", { note: "Fixed on its own: noise trimmed" });
    expect(readProgress("run-1")).toEqual({ shots: { s1: { job_id: "vid-a", held_reason: "Waiting for another job", note: "Fixed on its own: noise trimmed" }, s2: { failure: "The face did not match, twice." } } });
    recordShotJob("prod-2", "s1", "vid-b");
    expect(readProgress("run-1").shots.s1).toEqual({ job_id: "vid-b", note: "Fixed on its own: noise trimmed" });
    expect(filmShotJobIds("run-1")).toEqual(["vid-b"]);
    recordShotNote("prod-9", "s1", { job_id: "vid-z" });
    expect(readProgress("run-1").shots.s1!.job_id).toBe("vid-b");
  });
});

describe("one shot's row", () => {
  test("matches the shared job_progress shots fixture, with no time left invented", () => {
    const fixture = JSON.parse(readFileSync(new URL("../../../tests/fixtures/jobProgressShots.json", import.meta.url), "utf8"));
    const rows = [
      shotProgressRow({ id: "shot-1", label: "1 · Kitchen, wide", stillFileId: "pic-1", clipDone: true, note: { note: "Fixed on its own: a small noise at the start was trimmed." } }),
      shotProgressRow({ id: "shot-2", label: "2 · Kitchen, close", stillFileId: "pic-2", clipDone: false, job: { state: "running", percent: 45.4 } }),
      shotProgressRow({ id: "shot-3", label: "3 · Living room", stillFileId: "pic-3", clipDone: false }),
      shotProgressRow({ id: "shot-4", label: "4 · Living room, close", stillFileId: "pic-4", clipDone: false, job: { state: "queued", percent: 0 }, note: { held_reason: "Waiting for another job" } }),
      shotProgressRow({ id: "shot-5", label: "5 · Porch at dusk", stillFileId: "pic-5", clipDone: false, job: { state: "failed", percent: 0 }, note: { failure: "The face did not match, twice." } }),
    ];
    expect(rows).toEqual(fixture);
    expect(JSON.stringify(rows)).not.toContain("eta");
  });

  test("a cancelled job is a failed shot, a bad percent is clamped, and no picture means no thumb key", () => {
    expect(shotProgressRow({ id: "a", label: "a", clipDone: false, job: { state: "cancelled", percent: 0 } }).state).toBe("failed");
    expect(shotProgressRow({ id: "a", label: "a", clipDone: false, job: { state: "running", percent: 140 } }).progress).toBe(100);
    expect("thumb" in shotProgressRow({ id: "a", label: "a", clipDone: false })).toBe(false);
  });
});

describe("the film-progress rows", () => {
  test("only an adult gets rows; a person with no film, or a film with no plan yet, gets none", () => {
    const owner = addPerson("o3", "owner"), teen = addPerson("t3", "teen");
    addRun(owner.id, "run-3", "prod-3");
    expect(filmProgressRows(owner)).toEqual([]);
    expect(filmProgressRows(teen)).toEqual([]);
  });
});
