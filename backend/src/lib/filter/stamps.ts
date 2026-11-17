/**
 * RATE-INGEST-01 (RULES.md C9): the stored rating of one item. Written when the item arrives or by the ratings sweep; lists read
 * it and never rate. One table (`content_ratings`), keyed by what the rating is about. An item with no stamp is Unrated.
 * `stampAllowed` is the one comparison: the door's `filterList` and `allowedIds` both call it, so there is no second list filter.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { ContentRating, overCeiling, type RatingLevel } from "@maipai/spec/ratings/ts/contentRating";
import { db } from "@/db";
import { audienceBand, type AgeBand } from "@/lib/audience";
import type { PersonRow } from "@/types";
import { ceilingFor } from "./ceiling";
import { passForPerson } from "./pass";
import { stampAllowed } from "./stampCompare";
import { contentRatings } from "@/db/schema";

export type StampKind = "media_item" | "shelf_item" | "attachment" | "creation";
export type StoredStamp = ContentRating & { fingerprint: string };
type CeilingLevel = 0 | 1 | 2 | 3 | 4;

/** The version of the stored-rating logic in rateStored.ts; bump it when that logic changes and the sweep re-rates in the background. */
export let STORED_RATER_VERSION = 1;
export function __setStoredRaterVersionForTests(version: number): void { STORED_RATER_VERSION = version; }

export { stampAllowed };

type Row = typeof contentRatings.$inferSelect;
function toStamp(row: Row): StoredStamp | null {
  try {
    return {
      ...ContentRating.parse({
        level: row.level, source: row.source, rater: row.rater, rater_version: row.raterVersion, rated_at: row.ratedAt,
        ...(row.reasons ? { reasons: JSON.parse(row.reasons) as unknown } : {}), ...(row.label ? { label: JSON.parse(row.label) as unknown } : {}),
      }),
      fingerprint: row.fingerprint,
    };
  } catch { return null; }
}

/** Replaces the item's stamp in one statement, so the old stamp holds until the new one is written. */
export function putStamp(subject: { kind: StampKind; id: string }, rating: ContentRating, fingerprint: string): void {
  const values = {
    subjectKind: subject.kind, subjectId: subject.id, fingerprint, rater: rating.rater, raterVersion: rating.rater_version, level: rating.level,
    source: rating.source, reasons: rating.reasons ? JSON.stringify(rating.reasons) : null, label: rating.label ? JSON.stringify(rating.label) : null, ratedAt: rating.rated_at,
  };
  const { subjectKind: _k, subjectId: _i, ...rest } = values;
  db.insert(contentRatings).values(values).onConflictDoUpdate({ target: [contentRatings.subjectKind, contentRatings.subjectId], set: rest }).run();
}

export function getStamp(kind: StampKind, id: string): StoredStamp | null {
  const row = db.select().from(contentRatings).where(and(eq(contentRatings.subjectKind, kind), eq(contentRatings.subjectId, id))).get();
  return row ? toStamp(row) : null;
}

/** One query for a page of ids (in chunks, under SQLite's variable limit). */
export function getStamps(kind: StampKind, ids: readonly string[]): Map<string, StoredStamp> {
  const out = new Map<string, StoredStamp>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    for (const row of db.select().from(contentRatings).where(and(eq(contentRatings.subjectKind, kind), inArray(contentRatings.subjectId, chunk))).all()) {
      const stamp = toStamp(row);
      if (stamp) out.set(row.subjectId, stamp);
    }
  }
  return out;
}

export function levelFor(kind: StampKind, id: string): RatingLevel { return getStamp(kind, id)?.level ?? "Unrated"; }

/** The ids whose stamp is not over the ceiling; a missing stamp is Unrated. */
export function allowedIds(kind: StampKind, ids: readonly string[], ceiling: CeilingLevel, unratedAllowed = false): Set<string> {
  const stamps = getStamps(kind, ids);
  return new Set(ids.filter((id) => stampAllowed(stamps.get(id) ?? null, ceiling, unratedAllowed)));
}

/** For a list builder: a test of one id against the stored ratings of a page, for this person's ceiling (`ceilingFor(audienceBand(person))`).
 * An adult (ceiling X) runs no stamp query and every id passes. Reads the table only; no rater runs. */
export function storedRatingFilter(kind: StampKind, person: Pick<PersonRow, "id" | "role" | "controls"> | null | undefined, ids: readonly string[]): (id: string) => boolean {
  // OVERRIDES-01: the person's pass sets the ceiling and whether an allowed unrated stamp passes (stored files and media are the library; creations are made).
  if (!person) return storedRatingFilterForBand(kind, audienceBand(person), ids);
  const pass = passForPerson(person);
  const content = kind === "creation" ? "made" : "library";
  const ceiling = pass.ceiling[content];
  if (ceiling === 4) return () => true;
  const allowed = allowedIds(kind, ids, ceiling, pass.unrated.has(content));
  return (id) => allowed.has(id);
}
/** The same, for a list that already holds the viewer's band (the shelf and news take it from the band the list was asked for). */
export function storedRatingFilterForBand(kind: StampKind, band: AgeBand, ids: readonly string[]): (id: string) => boolean {
  const ceiling = ceilingFor(band);
  if (ceiling === 4) return () => true;
  const allowed = allowedIds(kind, ids, ceiling);
  return (id) => allowed.has(id);
}

/** Whether a stamp is missing, from another fingerprint, or from an older rater version. */
export function isStale(stamp: StoredStamp | undefined | null, fingerprint: string): boolean {
  return !stamp || stamp.fingerprint !== fingerprint || stamp.rater_version < STORED_RATER_VERSION;
}

const SOURCES: Record<Exclude<StampKind, "shelf_item">, { table: string; fingerprint: string; live: string; order: string }> = {
  media_item: { table: "media_items", fingerprint: "coalesce(t.fingerprint, t.external_id, t.id)", live: "t.deleted_at IS NULL", order: "t.created_at DESC" },
  attachment: { table: "attachments", fingerprint: "t.sha256", live: "t.deleted_at IS NULL", order: "t.created_at DESC" },
  creation: { table: "creations", fingerprint: "t.made_audience || ':' || t.updated_at", live: "1=1", order: "t.created_at DESC" },
};

/** Rows of that kind with no stamp, another fingerprint, or an older rater version, newest first. The shelf lives in another database
 * (knowledge.db), so `shelf_item` is swept from the shelf store by ratingsSweep.ts and answers [] here. */
export function staleOrMissing(kind: StampKind, limit: number): Array<{ id: string; fingerprint: string }> {
  if (kind === "shelf_item") return [];
  const s = SOURCES[kind];
  const rows = db.all<{ id: string; fingerprint: string }>(sql.raw(
    `SELECT t.id AS id, ${s.fingerprint} AS fingerprint FROM ${s.table} t
     LEFT JOIN content_ratings c ON c.subject_kind = '${kind}' AND c.subject_id = t.id
     WHERE ${s.live} AND (c.subject_id IS NULL OR c.fingerprint <> ${s.fingerprint} OR c.rater_version < ${Number(STORED_RATER_VERSION)})
     ORDER BY ${s.order} LIMIT ${Math.max(0, Math.floor(limit))}`));
  return rows;
}
