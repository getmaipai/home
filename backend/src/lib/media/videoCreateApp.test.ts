import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { videoShape } from "./videoCreateApp";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { filmRuns, people } from "@/db/schema";
import { filmShelfRows } from "./videoCreateApp";
import type { PersonRow } from "@/types";
import { resetDb } from "../../../tests/reset-db";

const stamp = new Date().toISOString();
function addPerson(id: string, role: string): PersonRow {
  db.insert(people).values({ id, displayName: id, role, avatarSeed: id, source: "local", createdAt: stamp, updatedAt: stamp, hlc: "1:0:test" }).run();
  return db.select().from(people).all().find((person) => person.id === id)!;
}
function addRun(personId: string, id: string, state: string, idea: string, parentId: string | null = null): void {
  db.insert(filmRuns).values({ id, personId, productionId: null, idea, planJson: null, state, stage: null, doneSteps: 0, totalSteps: 0, filmFileId: null, note: null, errorLine: null, goAhead: false, parentId, sceneKey: null, createdAt: stamp, updatedAt: stamp }).run();
}

beforeEach(() => resetDb());

describe("video creation details", () => {
  test("uses shape words for frame dimensions", () => {
    expect(videoShape(1920, 1080)).toBe("wide");
    expect(videoShape(1080, 1920)).toBe("tall");
    expect(videoShape(1080, 1080)).toBe("square");
  });

  test("does not expose an engine and model row", () => {
    const source = readFileSync(new URL("./videoCreateApp.ts", import.meta.url), "utf8");
    expect(source).not.toContain("Engine and model");
    expect(source).not.toContain("modelWords");
  });
});

describe("film library shelves", () => {
  test("making and unfinished scopes include only the viewer's own top-level runs with plain rows", () => {
    const viewer = addPerson("vf-viewer", "owner");
    const other = addPerson("vf-other", "adult");
    addRun(viewer.id, "vf-planning", "planning", "A quiet moonlit train crosses the valley tonight");
    addRun(viewer.id, "vf-running", "running", "Running film prompt");
    addRun(viewer.id, "vf-waiting", "waiting_for_go", "Waiting film prompt");
    addRun(viewer.id, "vf-failed", "failed", "Failed film prompt");
    addRun(viewer.id, "vf-cancelled", "cancelled", "Cancelled film prompt");
    addRun(viewer.id, "vf-child-run", "planning", "Hidden nested scene", "vf-parent");
    addRun(other.id, "vf-theirs", "planning", "Someone else's film");

    const making = filmShelfRows(viewer, ["planning", "running"]);
    const unfinished = filmShelfRows(viewer, ["waiting_for_go", "failed", "cancelled"]);
    expect(making.map((row) => row.id)).toEqual(["vf-planning", "vf-running"]);
    expect(unfinished.map((row) => row.id).sort()).toEqual(["vf-cancelled", "vf-failed", "vf-waiting"]);
    expect(making[0]).toEqual({ id: "vf-planning", title: "A quiet moonlit train crosses the", subtitle: "Planning the film" });
    expect(making[1]?.subtitle).toBe("Making the shots");
    expect(unfinished.map((row) => row.subtitle).sort()).toEqual(["Did not finish", "Stopped", "Waiting for your go"]);
    for (const row of [...making, ...unfinished]) {
      expect(Object.keys(row).sort()).toEqual(["id", "subtitle", "title"]);
      expect(JSON.stringify(row)).not.toMatch(/model|\\d{3,4}\\s*[x×]\\s*\\d{3,4}/i);
    }
  });

  test("child and teen profiles receive no film rows", () => {
    const child = addPerson("vf-child", "child");
    const teen = addPerson("vf-teen", "teen");
    addRun(child.id, "vf-child-film", "planning", "A film");
    addRun(teen.id, "vf-teen-film", "failed", "A film");
    expect(filmShelfRows(child, ["planning"])).toEqual([]);
    expect(filmShelfRows(teen, ["failed"])).toEqual([]);
  });
});

test("Video empty message is not attached to a filtered index shelf", () => {
  const page = JSON.parse(readFileSync(new URL("../../../packages/video/pages/index.json", import.meta.url), "utf8")) as { body: Array<Record<string, any>> };
  expect(page.body.some((node) => node.empty_state?.text?.includes("No videos yet"))).toBe(false);
});

test("Film maker inspiration uses showcase rows to fill its prompt", () => {
  const page = JSON.parse(readFileSync(new URL("../../../packages/video/pages/film-maker.json", import.meta.url), "utf8")) as { body: Array<Record<string, any>> };
  const shelf = page.body.find((node) => node.heading === "Inspiration");
  expect(shelf?.bind.params.scope).toBe("showcase");
  expect(shelf?.on_select.navigate.state.prompt).toBe("{prompt}");
});

test("a finished film offers Titles and credits and Edit and export on its own file; an unfinished one does not", async () => {
  const { filmRows } = await import("@/lib/films/pageFilm");
  const adult = addPerson("finisher", "owner");
  addRun(adult.id, "film-open", "waiting_for_go", "A short story");
  expect(filmRows(adult, "film-open")[0]).toMatchObject({ can_title: false, film_file_id: "" });
  addRun(adult.id, "film-done", "done", "A finished story");
  db.update(filmRuns).set({ filmFileId: "file-film-1" }).where(eq(filmRuns.id, "film-done")).run();
  expect(filmRows(adult, "film-done")[0]).toMatchObject({ can_title: true, film_file_id: "file-film-1" });
  const page = JSON.parse(readFileSync(new URL("../../../packages/video/pages/film-maker.json", import.meta.url), "utf8")) as { body: Array<Record<string, any>> };
  const shelf = page.body.find((node) => node.heading === "Your film");
  const labels = (shelf?.row_actions as Array<{ label: string; show_when_field?: string }>).filter((a) => a.show_when_field === "can_title").map((a) => a.label);
  expect(labels).toEqual(["Titles and credits", "Edit and export"]);
});
