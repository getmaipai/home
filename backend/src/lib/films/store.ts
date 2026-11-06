import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { filmRuns } from "@/db/schema";
import { randomSuffix } from "@/lib/id";
import type { PersonRow } from "@/types";
import { filmPlanSchema, type FilmPlan } from "./plan";

export type FilmRunState = "planning" | "waiting_for_go" | "running" | "done" | "failed" | "cancelled";
export type FilmRunStage = "Plan" | "Cast" | "Stills" | "Clips" | "Music" | "Assemble" | null;
export interface FilmRun { id: string; person_id: string; production_id: string | null; idea: string; plan: FilmPlan | null; state: FilmRunState; stage: FilmRunStage; done_steps: number; total_steps: number; film_file_id: string | null; note: string | null; error_line: string | null; go_ahead: boolean; created_at: string; updated_at: string }
function decode(row: typeof filmRuns.$inferSelect): FilmRun {
  let plan: FilmPlan | null = null; let state = row.state as FilmRunState; let errorLine = row.errorLine;
  if (row.planJson) {
    try { const parsed = filmPlanSchema.safeParse(JSON.parse(row.planJson)); if (parsed.success) plan = parsed.data; else { state = "failed"; errorLine = "The saved film plan could not be read. Start a new film."; } }
    catch { state = "failed"; errorLine = "The saved film plan could not be read. Start a new film."; }
  }
  return { id: row.id, person_id: row.personId, production_id: row.productionId, idea: row.idea, plan, state, stage: row.stage as FilmRunStage, done_steps: row.doneSteps, total_steps: row.totalSteps, film_file_id: row.filmFileId, note: row.note, error_line: errorLine, go_ahead: row.goAhead, created_at: row.createdAt, updated_at: row.updatedAt };
}
export function createFilmRun(actor: PersonRow, input: { idea: string; goAhead: boolean }): FilmRun {
  const now = new Date().toISOString(), id = `film-${randomSuffix(12)}`;
  db.insert(filmRuns).values({ id, personId: actor.id, productionId: null, idea: input.idea, planJson: null, state: "planning", stage: "Plan", doneSteps: 0, totalSteps: 0, filmFileId: null, note: null, errorLine: null, goAhead: input.goAhead, createdAt: now, updatedAt: now }).run();
  return getFilmRun(actor, id)!;
}
export function getFilmRun(actor: PersonRow, id: string): FilmRun | null { const row = db.select().from(filmRuns).where(and(eq(filmRuns.id, id), eq(filmRuns.personId, actor.id))).get(); return row ? decode(row) : null; }
export function updateFilmRun(actor: PersonRow, id: string, patch: Partial<Omit<FilmRun,"id"|"person_id"|"created_at"|"updated_at"|"plan">> & { plan?: FilmPlan | null }): FilmRun | null {
  const current = db.select().from(filmRuns).where(and(eq(filmRuns.id,id),eq(filmRuns.personId,actor.id))).get(); if (!current) return null;
  const values: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  const map = { production_id:"productionId", state:"state", stage:"stage", done_steps:"doneSteps", total_steps:"totalSteps", film_file_id:"filmFileId", note:"note", error_line:"errorLine", go_ahead:"goAhead" } as const;
  for (const [key,column] of Object.entries(map)) if ((patch as Record<string,unknown>)[key] !== undefined) values[column] = (patch as Record<string,unknown>)[key];
  if (patch.plan !== undefined) values.planJson = patch.plan === null ? null : JSON.stringify(filmPlanSchema.parse(patch.plan));
  db.update(filmRuns).set(values as never).where(eq(filmRuns.id,id)).run(); return getFilmRun(actor,id);
}
export function listFilmRunsInStates(states: FilmRunState[]): FilmRun[] { return db.select().from(filmRuns).where(inArray(filmRuns.state,states)).all().map(decode); }
export function failInterruptedFilmRuns(): void { db.update(filmRuns).set({ state:"failed", errorLine:"The hub restarted while this film was being made. Press Resume to continue.", updatedAt:new Date().toISOString() }).where(inArray(filmRuns.state,["planning","running"])).run(); }
