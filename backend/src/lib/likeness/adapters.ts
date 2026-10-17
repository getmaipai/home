// LIKENESS-01: who a saved style looks like (spec LikenessAdapter). The Stack keeps the file; this is Home's record of the
// answer to "Who does this style look like?" given when it was added, so consent can be checked at request time and the
// file can be removed when the person takes their agreement back. Only styles of a household adult have a subject; a style
// of "Nobody" has a record with a null subject so the answer is on file.
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { likenessAdapters } from "@/db/schema";
import { newLikenessAdapterId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { dropAdapterCache, forgetAdapterPref } from "@/lib/pictures/adapters";
import { removeLora } from "@/lib/pictures/stack";
import { dropVideoAdapterCache, forgetVideoAdapterPref } from "@/lib/videos/adapters";
import { removeVideoLora } from "@/lib/videos/stack";

export type StyleMedium = "picture" | "video";
export type AdapterState = "active" | "removal_queued" | "removed";

export interface LikenessAdapterRow { id: string; adapterId: string; medium: StyleMedium; subjectPersonId: string | null; classification: "all-ages" | "adult-only"; state: AdapterState; declaredBy: string }

function view(row: typeof likenessAdapters.$inferSelect): LikenessAdapterRow {
  return { id: row.id, adapterId: row.adapterId, medium: row.medium as StyleMedium, subjectPersonId: row.subjectPersonId, classification: row.classification as "all-ages" | "adult-only", state: row.state as AdapterState, declaredBy: row.declaredBy };
}

/** Records the answer to "Who does this style look like?" (a person's id, or null for nobody). */
export function declareStyleSubject(input: { adapterId: string; medium: StyleMedium; subjectPersonId: string | null; classification: "all-ages" | "adult-only"; declaredBy: string }): LikenessAdapterRow {
  const now = new Date().toISOString();
  const existing = getStyleSubject(input.medium, input.adapterId);
  if (existing) {
    db.update(likenessAdapters).set({ subjectPersonId: input.subjectPersonId, classification: input.classification, state: "active", declaredBy: input.declaredBy, updatedAt: now, hlc: nextHlc() }).where(eq(likenessAdapters.id, existing.id)).run();
    return getStyleSubject(input.medium, input.adapterId)!;
  }
  const id = newLikenessAdapterId();
  db.insert(likenessAdapters).values({ id, adapterId: input.adapterId, medium: input.medium, subjectPersonId: input.subjectPersonId, classification: input.classification, state: "active", declaredBy: input.declaredBy, source: "import", createdAt: now, updatedAt: now, hlc: nextHlc() }).run();
  return getStyleSubject(input.medium, input.adapterId)!;
}

export function getStyleSubject(medium: StyleMedium, adapterId: string): LikenessAdapterRow | null {
  const row = db.select().from(likenessAdapters).where(and(eq(likenessAdapters.medium, medium), eq(likenessAdapters.adapterId, adapterId))).get();
  return row ? view(row) : null;
}

export function allStyleSubjects(): LikenessAdapterRow[] {
  return db.select().from(likenessAdapters).all().map(view);
}

/** The record of a style an admin removed by hand: the answer goes with the file. */
export function forgetStyleSubject(medium: StyleMedium, adapterId: string): void {
  db.delete(likenessAdapters).where(and(eq(likenessAdapters.medium, medium), eq(likenessAdapters.adapterId, adapterId))).run();
}

/** The person took their agreement back: every style of them stops being usable at once (use is checked against consent at request time anyway) and is queued for removal from the library. */
export function queueStyleRemoval(subjectPersonId: string): number {
  const rows = db.select().from(likenessAdapters).where(and(eq(likenessAdapters.subjectPersonId, subjectPersonId), eq(likenessAdapters.state, "active"))).all();
  const now = new Date().toISOString();
  for (const row of rows) db.update(likenessAdapters).set({ state: "removal_queued", updatedAt: now, hlc: nextHlc() }).where(eq(likenessAdapters.id, row.id)).run();
  return rows.length;
}

let draining: Promise<number> | null = null;

/** Removes every queued style from the Stack's libraries and the household's switches. A style the Stack no longer has counts as removed; one it cannot be asked about stays queued for the next pass (boot, the next library read, the timer). Returns how many were removed. */
export function drainStyleRemovals(): Promise<number> {
  if (draining) return draining;
  draining = (async () => {
    let removed = 0;
    const rows = db.select().from(likenessAdapters).where(eq(likenessAdapters.state, "removal_queued")).all();
    for (const row of rows) {
      try {
        if (row.medium === "picture") { await removeLora(row.adapterId).catch(ignoreMissing); forgetAdapterPref(row.adapterId); dropAdapterCache(); }
        else { await removeVideoLora(row.adapterId).catch(ignoreMissing); forgetVideoAdapterPref(row.adapterId); dropVideoAdapterCache(); }
        db.update(likenessAdapters).set({ state: "removed", updatedAt: new Date().toISOString(), hlc: nextHlc() }).where(eq(likenessAdapters.id, row.id)).run();
        removed += 1;
      } catch { /* the Stack did not answer: it stays queued and the next pass tries again */ }
    }
    return removed;
  })().finally(() => { draining = null; });
  return draining;
}

function ignoreMissing(error: unknown): void {
  const status = (error as { status?: number } | null)?.status;
  if (status === 404) return;
  throw error;
}

/** Whether a style is a style of a person (its record has a subject), and whom. A style with no record, or a record of "nobody", has no subject. */
export function styleSubjectId(medium: StyleMedium, adapterId: string): string | null {
  const row = getStyleSubject(medium, adapterId);
  return row && row.state !== "removed" ? row.subjectPersonId : null;
}
