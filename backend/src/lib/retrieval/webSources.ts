// SEARCH-SOURCES-01: the household's choice of web search backends,
// `search.web_sources` (declared once in commons' spec/settings/keys.json).
// This file is the ONE place that list is interpreted: which sources a band may
// use, what a write is refused for, and how several answers become one list.
//
// "Offline" and "web off" are NOT options here: they stay with
// `search.source_mode` (sourceMode.ts), so there is one off switch. Hosted search,
// image and video search and page reads are outside the chooser and stay as they are.
//
// The blend reads ranks and URLs only, never text (rule 1): reciprocal-rank
// fusion (rrf.ts) keyed by the same key `dedupeRows` uses, so fusion and URL
// dedupe are one step. A source that fails contributes nothing; only when every
// picked source fails does the first one's error stand (rule 6).
import type { AgeBand } from "@/lib/ageBand";
import { getHouseholdSettingValue } from "@/lib/settings";
import { effectiveMode, type ModeSource } from "@/lib/retrieval/sourceMode";
import { reciprocalRankFusion } from "@/lib/retrieval/rrf";
import { ddgsConfigured, ddgsSearch } from "@/lib/retrieval/ddgsSource";

export const WEB_SOURCES_KEY = "search.web_sources";
export const DEFAULT_WEB_SOURCES = ["searxng"] as const;

export type WebSourceId = "searxng" | "ddgs";
export interface WebRow {
  title: string;
  url: string | null;
  snippet: string | null;
  image?: string | null;
  thumbnail?: string | null;
}
export interface WebRows {
  text: string;
  rows: WebRow[];
}
export type WebSourceSearch = () => Promise<WebRows>;

/** The source registry. A source that is not `built` is listed in the setting but cannot answer: ddgs
 * until the household runs the sidecar and names it (`MAIPAI_DDGS_URL`, ddgsSource.ts). */
const REGISTRY: { id: WebSourceId; built: () => boolean }[] = [
  { id: "searxng", built: () => true },
  { id: "ddgs", built: () => ddgsConfigured() },
];
const builtOverride: Partial<Record<WebSourceId, boolean>> = {};
const isBuilt = (id: WebSourceId): boolean => builtOverride[id] ?? REGISTRY.find((source) => source.id === id)!.built();

export interface WebSearchContext {
  args: unknown;
  band: AgeBand;
  signal?: AbortSignal;
  deadlineAt?: number;
  /** The asker's role; a guest carries no age signal and never reaches ddgs. */
  role?: string;
}
/** Rows-only search functions for sources other than SearXNG (whose step lives in packageHost.ts,
 * next to its tiers, cache and engine health). */
const SEARCHERS: Partial<Record<WebSourceId, (ctx: WebSearchContext) => Promise<WebRows>>> = { ddgs: ddgsSearch };

export function webSourceSearch(id: WebSourceId): ((ctx: WebSearchContext) => Promise<WebRows>) | undefined {
  return SEARCHERS[id];
}

/** Test seam: register a fake backend for a source (which marks it built), or clear it with null. */
export function __setWebSourceForTests(id: WebSourceId, search: ((ctx: WebSearchContext) => Promise<WebRows>) | null): void {
  if (search) {
    SEARCHERS[id] = search;
    builtOverride[id] = true;
  } else {
    if (id === "ddgs") SEARCHERS.ddgs = ddgsSearch;
    else delete SEARCHERS[id];
    delete builtOverride[id];
  }
}

export const WEB_SOURCE_IDS: readonly WebSourceId[] = REGISTRY.map((source) => source.id);

export const NO_SOURCE_NOTE = "Pick at least one web search source. To turn web search off, set Web searches to Library only.";
export const UNBUILT_ONLY_NOTE = "DuckDuckGo search is not set up on this computer yet. Keep SearXNG selected, or start the ddgs search service described in Set up web search.";

/** The stored list, in the household's order; an unset, malformed or empty value is the default. */
function storedSources(): WebSourceId[] {
  let raw: unknown;
  try {
    raw = getHouseholdSettingValue(WEB_SOURCES_KEY);
  } catch {
    raw = undefined;
  }
  const list = Array.isArray(raw) ? raw.filter((id): id is WebSourceId => (WEB_SOURCE_IDS as readonly unknown[]).includes(id)) : [];
  return [...new Set(list)].length > 0 ? [...new Set(list)] : [...DEFAULT_WEB_SOURCES];
}

/** The household's stored picks, whether or not they can answer now (the privacy page asks this). */
export function webSourcesPicked(): WebSourceId[] {
  return storedSources();
}

function modeSourceOf(id: WebSourceId): ModeSource {
  return id === "ddgs" ? "ddgs" : "web";
}

/** The sources that may answer this band's web search: the stored list, minus unbuilt sources,
 * minus any whose mode is closed or offline for the band. A child or teen reaches SearXNG only,
 * and only when the household picked it. */
export function webSourcesFor(band: AgeBand, temporary = false): WebSourceId[] {
  return storedSources().filter((id) => {
    if (!isBuilt(id)) return false;
    const mode = effectiveMode(modeSourceOf(id), band, temporary);
    return mode !== "closed" && mode !== "offline";
  });
}

/** The write refusals that need this file's knowledge. Everything else about the value (an array of
 * known options without duplicates) is the generic select + multiple check in lib/settings.ts.
 * Returns the message, or null. */
export function validateWebSources(key: string, value: unknown): string | null {
  if (key !== WEB_SOURCES_KEY || !Array.isArray(value)) return null;
  if (value.length === 0) return NO_SOURCE_NOTE;
  const known = value.filter((id): id is WebSourceId => (WEB_SOURCE_IDS as readonly unknown[]).includes(id));
  if (known.length === value.length && !known.some((id) => isBuilt(id))) return UNBUILT_ONLY_NOTE;
  return null;
}

const rowKey = (row: WebRow): string => row.url ?? `${row.title}\u001f${row.snippet ?? ""}`;

/** Reciprocal-rank fusion (k 60) of several sources' rows, one entry per URL. A URL two sources
 * return ranks above rows only one returned; ties follow the order of `lists`, then rank. */
export function blendWebRows(lists: WebRow[][]): WebRow[] {
  // A page both sources return keeps the first source's row unless that row has no snippet and the other has one.
  return reciprocalRankFusion(lists, rowKey).map((entry) => (entry.item.snippet || !entry.last.snippet ? entry.item : { ...entry.item, snippet: entry.last.snippet }));
}

export const NO_SOURCE_FOR_BAND_TEXT = "No web search source is available for this profile. An adult can pick SearXNG under Settings, Search, Web search sources.";
export const WEB_NO_RESULTS_TEXT = "No web search results were found.";

function textOf(rows: WebRow[]): string {
  if (rows.length === 0) return WEB_NO_RESULTS_TEXT;
  return rows.map((row, i) => `${i + 1}. ${row.title}${row.url ? ` (${row.url})` : ""}${row.snippet ? ` - ${row.snippet}` : ""}`).join("\n");
}

/** Run every picked source at once and blend what answers. `searches` is in the stored order. */
export async function runWebSources(searches: WebSourceSearch[]): Promise<WebRows> {
  const settled = await Promise.allSettled(searches.map((search) => search()));
  const answered = settled.flatMap((entry) => (entry.status === "fulfilled" ? [entry.value] : []));
  if (answered.length === 0) {
    const first = settled.find((entry): entry is PromiseRejectedResult => entry.status === "rejected");
    throw first?.reason ?? new Error("no web source answered");
  }
  const rows = blendWebRows(answered.map((result) => result.rows));
  return { text: textOf(rows), rows };
}
