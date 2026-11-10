// APPS-PARITY (2026-11-09): the Videos app's chips and sort. The kit's chip rows and sort control write page state, and the page binds it as params
// (`filter`, `type`, `channel`, `sort`); the rules here narrow or order the rows the existing data ids already build. Everything reads the household's own
// library and its made clips; nothing here makes a request.
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { mediaItems } from "@/db/schema";
import type { PersonRow } from "@/types";
import { madeFiles, madeVideoRow, type DataParams, type MediaRow } from "./appHost";

/** Data ids whose rows the Videos chips may narrow. Library also takes the sort (Recents unless A to Z), the search words and the Type chip. */
export const VIDEO_FILTERED_IDS: readonly string[] = ["continue", "new", "recent", "more-from", "again", "library"];

export const SHORT_BELOW_S = 240; // YouTube's own "Under 4 minutes"
export const LONG_FROM_S = 600;
const DAY_MS = 86_400_000;

export type VideoFilter = "made" | "unwatched" | "long" | "short" | "today" | "week" | "month";
const FILTERS = new Set<string>(["made", "unwatched", "long", "short", "today", "week", "month"]);
export const videoFilterOf = (value: unknown): VideoFilter | null => (typeof value === "string" && FILTERS.has(value) ? (value as VideoFilter) : null);
export const videoSortOf = (value: unknown): "recents" | "a-z" => (value === "a-z" || value === "az" ? "a-z" : "recents");

/** True when the page asked for anything these rules act on. */
export function wantsVideoRules(dataId: string, params: DataParams): boolean {
  if (!VIDEO_FILTERED_IDS.includes(dataId)) return false;
  return videoFilterOf(params.filter) !== null || !!params.channel || (dataId === "library" && (params.query === undefined || params.type === "made" || params.type === "all"));
}

const publishedOf = (external: string | null, addedAt: string): string => {
  try { const value = (JSON.parse(external ?? "null") as { published_at?: unknown } | null)?.published_at; if (typeof value === "string") return value; } catch { /* the added date stands in */ }
  return addedAt;
};

/** When each library row was published or added, by id. A made clip has no entry (the Library lists it newest first). */
function datesOf(ids: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  for (const row of db.select({ id: mediaItems.id, external: mediaItems.external, addedAt: mediaItems.addedAt }).from(mediaItems).where(inArray(mediaItems.id, [...ids])).all()) out.set(row.id, publishedOf(row.external, row.addedAt));
  return out;
}

const seconds = (row: MediaRow): number | null => (typeof row.duration_s === "number" ? row.duration_s : null);

/** Narrows rows by one chip. A row with no length is neither Short nor Long; a row with no date is never "Today / This week / This month". */
export function applyVideoFilter(rows: MediaRow[], filter: VideoFilter | null, nowMs = Date.now()): MediaRow[] {
  if (filter === null || filter === "made") return rows;
  if (filter === "unwatched") return rows.filter((row) => row.progress === undefined && row.completed !== true);
  if (filter === "long") return rows.filter((row) => (seconds(row) ?? -1) >= LONG_FROM_S);
  if (filter === "short") return rows.filter((row) => { const s = seconds(row); return s !== null && s > 0 && s < SHORT_BELOW_S; });
  const days = filter === "today" ? 1 : filter === "week" ? 7 : 30;
  const dates = datesOf(rows.map((row) => row.id));
  return rows.filter((row) => { const at = Date.parse(dates.get(row.id) ?? ""); return Number.isFinite(at) && nowMs - at < days * DAY_MS; });
}

/**
 * The chips and sort on top of one data id's own rows. `ask` builds the id's rows for given params (the caller passes a larger limit so a
 * narrowed list still fills). Only `recent` and `library` list made clips, so the "Made at home" chip leaves every other shelf empty (the page hides it).
 */
export function videoRules(person: PersonRow, dataId: string, params: DataParams, ask: (params: DataParams) => MediaRow[], limit: number, nowMs = Date.now()): MediaRow[] {
  const filter = videoFilterOf(params.filter);
  const wide: DataParams = { ...params, limit: 200 };
  const query = params.query?.trim().toLocaleLowerCase() ?? "";
  const made = (): MediaRow[] => madeFiles(person, "videos").map(madeVideoRow).filter((row) => query === "" || row.title.toLocaleLowerCase().includes(query)) as MediaRow[];
  let rows: MediaRow[];
  if (filter === "made" || (dataId === "library" && params.type === "made")) rows = dataId === "recent" || dataId === "library" ? made() : [];
  else {
    rows = ask(wide);
    // Search with the Type chip on All: saved videos first, then the clips made at home that match the words.
    if (dataId === "library" && params.type === "all" && query.length >= 2) { const seen = new Set(rows.map((row) => row.id)); rows = [...rows, ...made().filter((row) => !seen.has(row.id))]; }
  }
  if (params.channel) rows = rows.filter((row) => row.channel === params.channel);
  rows = applyVideoFilter(rows, filter === "made" ? null : filter, nowMs);
  if (dataId === "library" && params.query === undefined) {
    if (videoSortOf(params.sort) === "a-z") rows = [...rows].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
    else { const dates = datesOf(rows.map((row) => row.id)); rows = [...rows].sort((a, b) => (dates.get(b.id) ?? "9").localeCompare(dates.get(a.id) ?? "9")); }
  }
  return rows.slice(0, limit);
}
