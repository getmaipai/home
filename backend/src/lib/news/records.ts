// NEWS-02 (docs/design/news-app-2026-10-17.md section 7): the three person-scope News records, NewsInterest, NewsSave and
// NewsRead, in hub.db. Every function takes the person the request is for and reads or writes only that person's rows: there
// is no listing across people, no admin read and no count that names a person (RULES 6a). Every write crosses the spec's
// generated validator (a row is always the spec shape) and stamps a fresh hlc. A person's forget removes all three tables'
// rows (lib/personLifecycle.ts).
import { and, desc, eq, lt, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { newsInterests, newsReads, newsSaves, newsSearchRecents, people } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { newNewsInterestId, newNewsReadId, newNewsSaveId, newNewsSearchRecentId } from "@/lib/id";
import { speakerAgeBand, type AgeBand } from "@/lib/ageBand";
import { NewsInterest } from "@maipai/spec/gen/ts/news-interest.js";
import { NewsRead } from "@maipai/spec/gen/ts/news-read.js";
import { NewsSave } from "@maipai/spec/gen/ts/news-save.js";
import { NewsSearchRecent } from "@maipai/spec/gen/ts/news-search-recent.js";
import { validateNewsInterest, validateNewsSearchRecent } from "@maipai/spec/records/ts/validate.js";
import { computeAffinity, type MixActivity } from "./mixAffinity";
import type { MixSignal } from "./rankStories";
import { getPersonSettingValue } from "@/lib/settings";
import { sharedShelfStore } from "@/lib/shelf/shelfStore";
import { newsPictureCached, pinNewsPicture } from "./pictures";

export type InterestKind = "topic" | "source";
const PROVENANCE = "hub:news";
const READ_KEEP_DAYS = 90;

// ---- Follows (NewsInterest) ----------------------------------------------------------------

function interestOf(row: typeof newsInterests.$inferSelect): NewsInterest {
  return NewsInterest.parse({
    id: row.id, person_id: row.personId, kind: row.kind, key: row.key, followed: row.followed, affinity: row.affinity,
    inferred: row.inferred, updated_at: row.updatedAt, hlc: row.hlc, provenance: row.provenance, source: "hub",
  });
}

/** The person's followed channels. A row that only holds an affinity (inferred) is not a follow. */
export function followedChannels(personId: string): { topics: Set<string>; sources: Set<string> } {
  const topics = new Set<string>();
  const sources = new Set<string>();
  for (const row of db.select().from(newsInterests).where(and(eq(newsInterests.personId, personId), eq(newsInterests.followed, true))).all()) {
    (row.kind === "topic" ? topics : sources).add(row.key);
  }
  return { topics, sources };
}

export function isFollowing(personId: string, kind: InterestKind, key: string): boolean {
  const row = db.select().from(newsInterests).where(and(eq(newsInterests.personId, personId), eq(newsInterests.kind, kind), eq(newsInterests.key, key))).get();
  return row?.followed === true;
}

/** Follow or unfollow one channel for the person. A follow is the person's own tap, never inferred. An unfollow removes the row
 * unless an affinity still holds it (then it stays as an inferred row, which a child never has). */
export function setFollow(personId: string, band: AgeBand, kind: InterestKind, key: string, on: boolean, nowIso = new Date().toISOString()): void {
  const existing = db.select().from(newsInterests).where(and(eq(newsInterests.personId, personId), eq(newsInterests.kind, kind), eq(newsInterests.key, key))).get();
  if (on) {
    const record = { followed: true, affinity: band === "child" ? 0 : (existing?.affinity ?? 0), inferred: false };
    const draft = NewsInterest.parse({
      id: existing?.id ?? newNewsInterestId(), person_id: personId, kind, key, ...record, updated_at: nowIso, hlc: nextHlc(), provenance: PROVENANCE, source: "hub",
    });
    const problems = validateNewsInterest(draft, band);
    if (problems.length > 0) throw new Error(problems.join("; "));
    if (existing) db.update(newsInterests).set({ followed: true, affinity: draft.affinity, inferred: false, updatedAt: nowIso, hlc: draft.hlc }).where(eq(newsInterests.id, existing.id)).run();
    else db.insert(newsInterests).values({ id: draft.id, personId, kind, key, followed: true, affinity: draft.affinity, inferred: false, updatedAt: nowIso, hlc: draft.hlc, provenance: PROVENANCE }).run();
    return;
  }
  if (!existing) return;
  if (band === "child" || existing.affinity === 0) {
    db.delete(newsInterests).where(eq(newsInterests.id, existing.id)).run();
    return;
  }
  db.update(newsInterests).set({ followed: false, inferred: true, updatedAt: nowIso, hlc: nextHlc() }).where(eq(newsInterests.id, existing.id)).run();
}

/** Reset My Mix: forget learned rows and training reads, including feedback. Follows and saves stay. */
export function resetMix(personId: string): { removed: number } {
  return db.transaction(() => {
    const removed = db.delete(newsInterests).where(and(eq(newsInterests.personId, personId), eq(newsInterests.inferred, true))).returning({ id: newsInterests.id }).all().length;
    db.update(newsInterests).set({ affinity: 0, updatedAt: new Date().toISOString(), hlc: nextHlc() }).where(eq(newsInterests.personId, personId)).run();
    // Forget training reads too, so the next sweep cannot restore the reset mix.
    db.delete(newsReads).where(eq(newsReads.personId, personId)).run();
    return { removed };
  });
}

export function interestRowsOf(personId: string): NewsInterest[] {
  return db.select().from(newsInterests).where(eq(newsInterests.personId, personId)).all().map(interestOf);
}

// ---- Saves (NewsSave) ------------------------------------------------------------------------

function saveOf(row: typeof newsSaves.$inferSelect): NewsSave {
  return NewsSave.parse({
    id: row.id, person_id: row.personId, item_id: row.itemId, story_id: row.storyId, canonical_url: row.canonicalUrl, title: row.title,
    publisher: row.publisher, saved_at: row.savedAt, offline: row.offline, hlc: row.hlc, provenance: row.provenance,
  });
}

export function savedItemIds(personId: string): Set<string> {
  return new Set(db.select({ itemId: newsSaves.itemId }).from(newsSaves).where(eq(newsSaves.personId, personId)).all().map((row) => row.itemId));
}

/** The person's saves, newest first. */
export function listSaves(personId: string): NewsSave[] {
  return db.select().from(newsSaves).where(eq(newsSaves.personId, personId)).orderBy(desc(newsSaves.savedAt)).all().map(saveOf);
}

export function getSave(personId: string, itemId: string): NewsSave | null {
  const row = db.select().from(newsSaves).where(and(eq(newsSaves.personId, personId), eq(newsSaves.itemId, itemId))).get();
  return row ? saveOf(row) : null;
}

export interface SaveInput { itemId: string; storyId: string; canonicalUrl: string; title: string; publisher: string; offline: boolean }

export function addSave(personId: string, input: SaveInput, nowIso = new Date().toISOString()): NewsSave {
  const existing = getSave(personId, input.itemId);
  if (existing) {
    if (existing.offline !== input.offline) db.update(newsSaves).set({ offline: input.offline, hlc: nextHlc() }).where(eq(newsSaves.id, existing.id)).run();
    return { ...existing, offline: input.offline };
  }
  const record = NewsSave.parse({
    id: newNewsSaveId(), person_id: personId, item_id: input.itemId, story_id: input.storyId, canonical_url: input.canonicalUrl, title: input.title,
    publisher: input.publisher, saved_at: nowIso, offline: input.offline, hlc: nextHlc(), provenance: PROVENANCE,
  });
  db.insert(newsSaves).values({
    id: record.id, personId, itemId: record.item_id, storyId: record.story_id, canonicalUrl: record.canonical_url, title: record.title,
    publisher: record.publisher, savedAt: record.saved_at, offline: record.offline, hlc: record.hlc, provenance: record.provenance,
  }).run();
  return record;
}

export function removeSave(personId: string, itemId: string): boolean {
  return db.delete(newsSaves).where(and(eq(newsSaves.personId, personId), eq(newsSaves.itemId, itemId))).returning({ id: newsSaves.id }).all().length > 0;
}

/** Whether any person still holds a save of this item (so its pinned text stays out of the prune). */
export function itemIsSaved(itemId: string): boolean {
  return db.select({ id: newsSaves.id }).from(newsSaves).where(eq(newsSaves.itemId, itemId)).limit(1).get() !== undefined;
}

// ---- Reads (NewsRead) ------------------------------------------------------------------------

function readOf(row: typeof newsReads.$inferSelect): NewsRead {
  return NewsRead.parse({
    id: row.id, person_id: row.personId, item_id: row.itemId, story_id: row.storyId, opened_at: row.openedAt, read_s: row.readS,
    finished: row.finished, feedback: row.feedback === "more" || row.feedback === "less" ? row.feedback : null, hlc: row.hlc, provenance: row.provenance,
  });
}

export function openedItemIds(personId: string): Set<string> {
  return new Set(db.select({ itemId: newsReads.itemId }).from(newsReads).where(eq(newsReads.personId, personId)).all().map((row) => row.itemId));
}

export function getRead(personId: string, itemId: string): NewsRead | null {
  const row = db.select().from(newsReads).where(and(eq(newsReads.personId, personId), eq(newsReads.itemId, itemId))).orderBy(desc(newsReads.openedAt)).get();
  return row ? readOf(row) : null;
}

/** Records an open of a story, or updates the person's latest open of it (reading seconds and finished only ever go up). */
export function recordRead(personId: string, input: { itemId: string; storyId: string; readS?: number; finished?: boolean; feedback?: "more" | "less" | null }, nowIso = new Date().toISOString()): NewsRead {
  const existing = getRead(personId, input.itemId);
  if (existing) {
    const readS = Math.max(existing.read_s, Math.max(0, Math.floor(input.readS ?? 0)));
    const finished = existing.finished || input.finished === true;
    const feedback = input.feedback === undefined ? (existing.feedback ?? null) : input.feedback;
    db.update(newsReads).set({ readS, finished, feedback, ...(input.feedback !== undefined ? { openedAt: nowIso } : {}), hlc: nextHlc() }).where(eq(newsReads.id, existing.id)).run();
    recomputeMix(personId, new Date(nowIso));
    return { ...existing, opened_at: input.feedback !== undefined ? nowIso : existing.opened_at, read_s: readS, finished, feedback };
  }
  const record = NewsRead.parse({
    id: newNewsReadId(), person_id: personId, item_id: input.itemId, story_id: input.storyId, opened_at: nowIso,
    read_s: Math.max(0, Math.floor(input.readS ?? 0)), finished: input.finished === true, feedback: input.feedback ?? null, hlc: nextHlc(), provenance: PROVENANCE,
  });
  db.insert(newsReads).values({
    id: record.id, personId, itemId: record.item_id, storyId: record.story_id, openedAt: record.opened_at, readS: record.read_s,
    finished: record.finished, feedback: record.feedback ?? null, hlc: record.hlc, provenance: record.provenance,
  }).run();
  recomputeMix(personId, new Date(nowIso));
  return record;
}

// ---- Search recents (NewsSearchRecent) ---------------------------------------------------------

export const RECENTS_KEEP = 20;
export const RECENTS_SHOWN = 5;
export const RECENT_MAX_CHARS = 120;

/** The person's last searches, newest first. The query text is the person's own and is returned to nobody else. */
export function listRecents(personId: string, limit = RECENTS_SHOWN): NewsSearchRecent[] {
  return db.select().from(newsSearchRecents).where(eq(newsSearchRecents.personId, personId)).orderBy(desc(newsSearchRecents.at), desc(newsSearchRecents.id)).limit(limit).all().map((row) => NewsSearchRecent.parse({
    id: row.id, person_id: row.personId, q: row.q, at: row.at, hlc: row.hlc, provenance: row.provenance, source: "hub",
  }));
}

/** Records one search, or bumps the person's earlier identical one (same text ignoring case) to the top. A child keeps none
 * (the spec's validator refuses the row); an empty query keeps none; past 20 the oldest go. Returns whether a row was kept. */
export function recordRecent(personId: string, band: AgeBand, rawQuery: string, nowIso = new Date().toISOString()): boolean {
  const q = rawQuery.replace(/\s+/g, " ").trim().slice(0, RECENT_MAX_CHARS).trim();
  if (!q || band === "child") return false;
  const draft = NewsSearchRecent.parse({ id: newNewsSearchRecentId(), person_id: personId, q, at: nowIso, hlc: nextHlc(), provenance: PROVENANCE, source: "hub" });
  const problems = validateNewsSearchRecent(draft, band);
  if (problems.length > 0) return false;
  return db.transaction(() => {
    // Folded by SQLite's own lower(), the fold the unique index uses (ASCII only): a JS toLowerCase() here matched a row the index then refused (a 500).
    const existing = db.select().from(newsSearchRecents).where(and(eq(newsSearchRecents.personId, personId), sql`lower(${newsSearchRecents.q}) = lower(${q})`)).get();
    if (existing) db.update(newsSearchRecents).set({ q, at: nowIso, hlc: draft.hlc }).where(eq(newsSearchRecents.id, existing.id)).run();
    else db.insert(newsSearchRecents).values({ id: draft.id, personId, q, at: nowIso, hlc: draft.hlc, provenance: draft.provenance }).run();
    const rows = db.select({ id: newsSearchRecents.id }).from(newsSearchRecents).where(eq(newsSearchRecents.personId, personId)).orderBy(desc(newsSearchRecents.at), desc(newsSearchRecents.id)).all();
    for (const old of rows.slice(RECENTS_KEEP)) db.delete(newsSearchRecents).where(eq(newsSearchRecents.id, old.id)).run();
    return true;
  });
}

/** Clear: every recent search of this person. */
export function clearRecents(personId: string): number {
  return db.delete(newsSearchRecents).where(eq(newsSearchRecents.personId, personId)).returning({ id: newsSearchRecents.id }).all().length;
}

/** The person-forget rule: every follow, save and read of this person goes, and a saved story no other person saved is let go of
 * (its pinned text and picture return to the ordinary prune and cache limits). */
export function forgetNewsOfPerson(personId: string): void {
  const itemIds = db.select({ itemId: newsSaves.itemId }).from(newsSaves).where(eq(newsSaves.personId, personId)).all().map((row) => row.itemId);
  db.delete(newsInterests).where(eq(newsInterests.personId, personId)).run();
  db.delete(newsSaves).where(eq(newsSaves.personId, personId)).run();
  db.delete(newsReads).where(eq(newsReads.personId, personId)).run();
  db.delete(newsSearchRecents).where(eq(newsSearchRecents.personId, personId)).run();
  for (const itemId of new Set(itemIds)) {
    if (itemIsSaved(itemId)) continue;
    try { sharedShelfStore()?.pinContent(itemId, false); } catch { /* disposable cache */ }
    try { if (newsPictureCached(itemId)) pinNewsPicture(itemId, false); } catch { /* disposable cache */ }
  }
}

/** The daily sweep: reads older than 90 days go. */
export function pruneReads(now = new Date()): number {
  const cutoff = new Date(now.getTime() - READ_KEEP_DAYS * 86_400_000).toISOString();
  return db.delete(newsReads).where(lt(newsReads.openedAt, cutoff)).returning({ id: newsReads.id }).all().length;
}


/** Person-scoped computed signal. No model, no cross-person activity, no child inference. */
export function recomputeMix(personId: string, now = new Date()): MixSignal {
  const signal: MixSignal = { topics: new Map(), sources: new Map(), lessTopics: new Set(), lessSources: new Set() };
  const person = db.select().from(people).where(eq(people.id, personId)).get();
  if (!person || person.deletedAt) return signal;
  if (person.role === "guest" || speakerAgeBand(person, now) === "child") {
    // A profile moved to child controls must lose earlier adult or teen inference too.
    db.transaction(() => {
      db.delete(newsInterests).where(and(eq(newsInterests.personId, personId), eq(newsInterests.inferred, true))).run();
      db.update(newsInterests).set({ affinity: 0, updatedAt: now.toISOString(), hlc: nextHlc() }).where(eq(newsInterests.personId, personId)).run();
    });
    return signal;
  }
  if (getPersonSettingValue(person, "news.my_mix") === false) return signal;
  const store = sharedShelfStore();
  const saves = savedItemIds(personId);
  const activity: MixActivity[] = [];
  for (const row of db.select().from(newsReads).where(eq(newsReads.personId, personId)).all()) {
    const item = store?.get(row.itemId);
    if (item) activity.push({ topics: item.topics ?? [], source: item.feed_id, at: row.openedAt, finished: row.finished, saved: saves.has(row.itemId), feedback: row.feedback === "more" || row.feedback === "less" ? row.feedback : null });
  }
  Object.assign(signal, computeAffinity(activity, now));
  db.transaction(() => {
    db.delete(newsInterests).where(and(eq(newsInterests.personId, personId), eq(newsInterests.inferred, true))).run();
    db.update(newsInterests).set({ affinity: 0, updatedAt: now.toISOString(), hlc: nextHlc() }).where(eq(newsInterests.personId, personId)).run();
    for (const [kind, scores] of [["topic", signal.topics], ["source", signal.sources]] as const) {
      for (const [key, score] of scores) {
        const affinity = score;
        const existing = db.select().from(newsInterests).where(and(eq(newsInterests.personId, personId), eq(newsInterests.kind, kind), eq(newsInterests.key, key))).get();
        const draft = NewsInterest.parse({ id: existing?.id ?? newNewsInterestId(), person_id: personId, kind, key, followed: existing?.followed ?? false, affinity, inferred: !existing?.followed, updated_at: now.toISOString(), hlc: nextHlc(), provenance: PROVENANCE, source: "hub" });
        const problems = validateNewsInterest(draft, speakerAgeBand(person, now));
        if (problems.length) throw new Error("My Mix could not update. Reset My Mix and try again.");
        if (existing) db.update(newsInterests).set({ affinity, updatedAt: draft.updated_at, hlc: draft.hlc }).where(eq(newsInterests.id, existing.id)).run();
        else db.insert(newsInterests).values({ id: draft.id, personId, kind, key, followed: false, affinity, inferred: true, updatedAt: draft.updated_at, hlc: draft.hlc, provenance: PROVENANCE }).run();
      }
    }
  });
  return signal;
}

/** The nightly maintenance entry point. Each computation reads only that person's activity. */
export function recomputeAllMixes(now = new Date()): void {
  for (const person of db.select().from(people).where(isNull(people.deletedAt)).all()) recomputeMix(person.id, now);
}

let lastMixNight = "";
/** Reuses the shelf poll tick, once during the local 02:00 hour. A restart may safely repeat the computation. */
export function recomputeNightlyMixes(now = new Date()): void {
  if (now.getHours() !== 2) return;
  const night = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  if (night === lastMixNight) return;
  recomputeAllMixes(now);
  lastMixNight = night;
}
