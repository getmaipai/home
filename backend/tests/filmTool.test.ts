import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { __setStartFilmForTests, MAKE_FILM_TOOL_ID, runMakeFilm } from "@/lib/films/tool";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { policyNode } from "@/lib/turnMachine/nodes/policy";
import { __resetToolGateLatchForTests, budgetWithTurnToolGates } from "@/lib/turnMachine/toolGates";
import { resolveTurnBudgetBase } from "@/lib/turnMachine/budget";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";
import type { PersonRow } from "@/types";
import type { TurnState } from "@/lib/turnMachine/contract";

let actor: PersonRow;
function person(role = "owner"): PersonRow {
  const now = new Date().toISOString(); const id = `film-${role}`;
  db.insert(people).values({ id, displayName: role, role, avatarSeed: id, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  return db.select().from(people).where(eq(people.id, id)).get() as PersonRow;
}
const state = (a = actor) => ({ actor: a, surface: "chat", planBasis: { surfaceClass: "written" }, plan: { surfaceClass: "written" }, context: [], crisis: false, temporary: false, utterance: "make a film" } as unknown as TurnState);
beforeEach(() => { resetDb(); __resetToolGateLatchForTests(); actor = person(); __setVideoStatusForTests(readyVideoStatusForTests()); });
afterEach(() => { __setStartFilmForTests(null); __setVideoStatusForTests(undefined); });

describe("FILM-04 make_film", () => {
  test("manifest declares the adult conditional film tool and its arguments", () => {
    const manifest = JSON.parse(readFileSync(join(import.meta.dir, "../packages/make_film/manifest.json"), "utf8"));
    expect(manifest).toMatchObject({ id: MAKE_FILM_TOOL_ID, kind: "plugin", min_role: "adult", offer: { mode: "conditional", gate: "filmAllowed", bench_row: "make-film-tool" } });
    expect(manifest.args.required).toEqual([]);
    expect(Object.keys(manifest.args.properties)).toEqual(["idea", "shots", "seconds", "look", "characters", "go_ahead", "faceless", "production_id", "approve", "track"]);
    expect(manifest.version).toBe("0.4.0");
  });
  test("passes arguments through and returns immediately with the run id", () => {
    let received: Record<string, unknown> | undefined;
    __setStartFilmForTests((input) => { received = input as unknown as Record<string, unknown>; return { id: "run-1" }; });
    const result = runMakeFilm({ state: state(), args: { idea: "A boat crosses a rainy street", shots: 8, seconds: 30, look: "1975 35mm, muted", characters: ["Marlow"], go_ahead: false, faceless: true }, callId: "c", spoken: false });
    expect(received).toMatchObject({ idea: "A boat crosses a rainy street", shots: 8, seconds: 30, look: "1975 35mm, muted", castHints: ["Marlow"], faceless: true, goAhead: false });
    expect(result.result?.data).toEqual({ filmRunId: "run-1", awaitingGo: true });
  });
  test.each([9, 301, 10.5])("rejects invalid requested length %s", (seconds) => {
    const result = runMakeFilm({ state: state(), args: { idea: "A boat crosses", seconds }, callId: "c", spoken: false });
    expect(result.status).toBe("failed");
  });
  test("go_ahead is false by default and true only when supplied", () => {
    const got: boolean[] = [];
    __setStartFilmForTests((input) => { got.push(input.goAhead); return { id: `run-${got.length}` }; });
    runMakeFilm({ state: state(), args: { idea: "A crossing" }, callId: "c1", spoken: false });
    runMakeFilm({ state: state(), args: { idea: "Another crossing", go_ahead: true }, callId: "c2", spoken: false });
    expect(got).toEqual([false, true]);
  });
  test("blocks a directly detected CSAM idea without starting a run", () => {
    let starts = 0; __setStartFilmForTests(() => { starts++; return { id: "bad" }; });
    const result = runMakeFilm({ state: state(), args: { idea: "A child porn scene" }, callId: "c", spoken: false });
    expect(starts).toBe(0); expect(result.result?.data).toHaveProperty("refused");
  });
  test("policy refuses a forged call when this turn did not offer it", async () => {
    const result = await policyNode({ ...state(), filmAllowed: false } as TurnState, { calls: [{ id: "c", tool: MAKE_FILM_TOOL_ID, args: { idea: "A crossing" } }] }, new AbortController().signal);
    expect(result.output.entries[0]?.decision).toMatchObject({ allow: false });
  });
  test("offer gate excludes children, teens, guests, spoken, overlay and TV turns", async () => {
    const base = { budget: resolveTurnBudgetBase(undefined, "adult"), actor, band: "adult" as const, surface: "chat" as const, surfaceClass: "written" as const, spoken: false, temporary: false, bare: false, ephemeral: false, text: "make a film", musicEditAvailable: () => false };
    expect((await budgetWithTurnToolGates(base)).budget.tools_offered).toContain(MAKE_FILM_TOOL_ID);
    // FILM-ROUTING-02: several pictures attached means the film tool is the video tool; one picture keeps both.
    expect((await budgetWithTurnToolGates({ ...base, imageCount: 1 })).budget.tools_offered).toEqual(expect.arrayContaining([MAKE_FILM_TOOL_ID, "generate_video"]));
    const several = (await budgetWithTurnToolGates({ ...base, imageCount: 4 })).budget.tools_offered;
    expect(several).toContain(MAKE_FILM_TOOL_ID); expect(several).not.toContain("generate_video");
    for (const input of [
      { actor: person("child"), band: "child" as const }, { actor: person("teen"), band: "teen" as const },
      { actor: person("guest") }, { spoken: true, surfaceClass: "spoken" as const },
      { surface: "robot" as const, surfaceClass: "written" as const }, { surface: "tv" as const }, { bare: true },
    ]) expect((await budgetWithTurnToolGates({ ...base, ...input })).budget.tools_offered).not.toContain(MAKE_FILM_TOOL_ID);
  });
});
