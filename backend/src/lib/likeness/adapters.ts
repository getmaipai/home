// LIKENESS-01: who a saved style looks like (spec LikenessAdapter). The Stack keeps the file; this is Home's record of the
// answer to "Who does this style look like?" given when it was added, so identity and policy can be checked at request time. Only styles of a household member have a subject; a style
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
export type AdapterState = "active" | "removed";

export interface LikenessAdapterRow { id: string; adapterId: string; medium: StyleMedium; subjectPersonId: string | null; classification: "all-ages" | "adult-only"; state: AdapterState; declaredBy: string }

function view(row: typeof likenessAdapters.$inferSelect): LikenessAdapterRow {
  return { id: row.id, adapterId: row.adapterId, medium: row.medium as StyleMedium, subjectPersonId: row.subjectPersonId, classification: row.classification as "all-ages" | "adult-only", state: row.state === "active" ? "active" : "removed", declaredBy: row.declaredBy };
}

/** Records the answer to "Who does this style look like?" (a person's id, or null for nobody). */
export function declareStyleSubject(input: { adapterId: string; medium: StyleMedium; subjectPersonId: string | null; classification: "all-ages" | "adult-only"; declaredBy: string }): LikenessAdapterRow {
  const now = new Date().toISOString();
  const existing = getStyleSubject(input.medium, input.adapterId);
  if (existing) {
    if (existing.state !== "active") return existing;
    db.update(likenessAdapters).set({ subjectPersonId: input.subjectPersonId, classification: input.classification, declaredBy: input.declaredBy, updatedAt: now, hlc: nextHlc() }).where(eq(likenessAdapters.id, existing.id)).run();
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

/** Keep a tombstone when an admin removes a style, so restoring the same adapter id cannot revive its former binding. */
export function forgetStyleSubject(medium: StyleMedium, adapterId: string): void {
  const row = getStyleSubject(medium, adapterId);
  if (!row) return;
  db.update(likenessAdapters).set({ state: "removed", updatedAt: new Date().toISOString(), hlc: nextHlc() }).where(eq(likenessAdapters.id, row.id)).run();
}

/** Whether a style is a style of a person (its record has a subject), and whom. A style with no record, or a record of "nobody", has no subject. */
export function styleSubjectId(medium: StyleMedium, adapterId: string): string | null {
  const row = getStyleSubject(medium, adapterId);
  return row?.state === "active" ? row.subjectPersonId : null;
}

/** Whether this saved style has a removed tombstone. */
export function styleIsUnavailable(medium: StyleMedium, adapterId: string): boolean {
  const row = getStyleSubject(medium, adapterId);
  return row?.state === "removed";
}

/** Queue every saved style of a person for removal; tombstones prevent reuse immediately. */
export function queueStyleRemoval(subjectPersonId: string): number {
  const rows = db.select().from(likenessAdapters).where(and(eq(likenessAdapters.subjectPersonId, subjectPersonId), eq(likenessAdapters.state, "active"))).all();
  for (const row of rows) db.update(likenessAdapters).set({ state: "removal_queued", updatedAt: new Date().toISOString(), hlc: nextHlc() }).where(eq(likenessAdapters.id, row.id)).run();
  return rows.length;
}

export async function drainStyleRemovals(): Promise<number> {
  let removed = 0;
  const rows = db.select().from(likenessAdapters).where(eq(likenessAdapters.state, "removal_queued")).all();
  for (const row of rows) {
    try {
      if (row.medium === "picture") { await removeLora(row.adapterId).catch(ignoreMissing); forgetAdapterPref(row.adapterId); dropAdapterCache(); }
      else { await removeVideoLora(row.adapterId).catch(ignoreMissing); forgetVideoAdapterPref(row.adapterId); dropVideoAdapterCache(); }
      db.update(likenessAdapters).set({ state: "removed", updatedAt: new Date().toISOString(), hlc: nextHlc() }).where(eq(likenessAdapters.id, row.id)).run();
      removed++;
    } catch { /* keep queued for next retry */ }
  }
  return removed;
}

function ignoreMissing(error: unknown): void { if ((error as { status?: number } | null)?.status !== 404) throw error; }
