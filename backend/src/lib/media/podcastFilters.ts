// PODCAST-PORT-03: saved episode filters. A filter is a `media-collection` of kind `filter` whose `rules` (spec-v0.1.261) say which
// episodes match; there is no table of its own. Rules are evaluated at read time over the episodes the person may already read
// (queryItems: band, source `visible_to`, child allowlist), so a filter can never show more than the Episodes page does.
import type { PersonRow } from "@/types";
import { allowedSources, queryItems } from "./appHost";
import { mediaBandOf, trips } from "./band";
import { createFilterCollection, listCollections, renameCollection, saveFilterRules, resolveCollection } from "./collections";
import type { MediaCollection, MediaItem, MediaProgress } from "./model";
import { getProgressMany } from "./progress";

/** The spec's `rules` object for kind `filter` (the generated type is `any` for a oneOf, so it is spelled out here). */
export interface FilterRules { unplayed?: true; in_progress?: true; saved?: true; min_minutes?: number; max_minutes?: number; source_ids?: string[]; released_within_days?: number }
export const MAX_FILTERS = 20;
const TITLE_MAX = 60;
const DAY_MS = 24 * 3600 * 1000;

const asBool = (value: unknown): boolean | undefined => (value === true || value === "true" || value === "on" ? true : undefined);
const asInt = (value: unknown): number | undefined | null => {
  if (value === undefined || value === null || value === "" || (typeof value === "string" && /^\{[^{}]+\}$/.test(value))) return undefined;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(n) && Number.isInteger(n) ? n : null;
};

export type ParsedRules = { ok: true; rules: FilterRules } | { ok: false; error: string };

/** Reads the rule fields of a request body (booleans and numbers may arrive as the text a form sends). `show` words are matched against
 * the shows this person may see; a name that matches none is an error rather than a filter that quietly shows nothing. */
export function parseRules(person: PersonRow, body: Record<string, unknown>): ParsedRules {
  const rules: FilterRules = {};
  const unplayed = asBool(body.unplayed);
  const inProgress = asBool(body.in_progress);
  if (unplayed && inProgress) return { ok: false, error: "Pick Unplayed or In progress, not both. Leave both off to include every episode." };
  if (unplayed) rules.unplayed = true;
  if (inProgress) rules.in_progress = true;
  if (asBool(body.saved)) rules.saved = true;
  for (const [field, min] of [["min_minutes", 0], ["max_minutes", 0], ["released_within_days", 1]] as const) {
    const n = asInt(body[field]);
    if (n === null || (n !== undefined && n < min)) return { ok: false, error: `${field === "released_within_days" ? "Released within" : field === "min_minutes" ? "Shortest length" : "Longest length"} needs a whole number${min === 1 ? " of 1 or more" : " of 0 or more"}.` };
    if (n !== undefined) rules[field] = n;
  }
  if (rules.min_minutes !== undefined && rules.max_minutes !== undefined && rules.min_minutes > rules.max_minutes) return { ok: false, error: "The shortest length is longer than the longest length. Swap them." };
  const feeds = allowedSources(person).filter((source) => source.kind === "feed");
  const ids = new Set<string>();
  if (Array.isArray(body.source_ids)) {
    for (const id of body.source_ids) {
      if (typeof id !== "string" || !feeds.some((feed) => feed.id === id)) return { ok: false, error: "One of those shows is not in your podcasts. Choose from your Shows." };
      ids.add(id);
    }
  }
  if (typeof body.source_id === "string" && body.source_id !== "" && !/^\{[^{}]+\}$/.test(body.source_id)) {
    if (!feeds.some((feed) => feed.id === body.source_id)) return { ok: false, error: "That show is not in your podcasts. Choose from your Shows." };
    ids.add(body.source_id);
  }
  const words = typeof body.show === "string" && !/^\{[^{}]+\}$/.test(body.show) ? body.show.trim().toLowerCase() : "";
  if (words !== "") {
    const hits = feeds.filter((feed) => feed.label.toLowerCase().includes(words));
    if (hits.length === 0) return { ok: false, error: `No show of yours has "${words.slice(0, 40)}" in its name. Check the spelling against your Shows.` };
    for (const hit of hits) ids.add(hit.id);
  }
  if (ids.size > 0) rules.source_ids = [...ids];
  return { ok: true, rules };
}

const startedOf = (progress: MediaProgress | undefined): boolean => {
  if (!progress) return false;
  return "seconds" in progress.position ? progress.position.seconds > 0 : progress.position.percent > 0;
};

export interface FilterContext {
  progress: ReadonlyMap<string, MediaProgress>;
  nowMs: number;
}

const publishedMs = (item: MediaItem): number => Date.parse(item.external?.published_at ?? item.added_at);

/** Whether one episode matches every rule given. Pure: the progress and the clock come in. */
export function matchesRules(rules: FilterRules, item: MediaItem, context: FilterContext): boolean {
  const progress = context.progress.get(item.id);
  const finished = progress?.completed === true;
  if (rules.unplayed && (finished || startedOf(progress))) return false;
  if (rules.in_progress && (finished || !startedOf(progress))) return false;
  if (rules.saved && Boolean((item.location as { url?: string }).url)) return false;
  if (rules.min_minutes !== undefined && (item.duration_s === null || item.duration_s < rules.min_minutes * 60)) return false;
  if (rules.max_minutes !== undefined && (item.duration_s === null || item.duration_s > rules.max_minutes * 60)) return false;
  if (rules.source_ids && !rules.source_ids.includes(item.source_id ?? "")) return false;
  if (rules.released_within_days !== undefined) {
    const at = publishedMs(item);
    if (!Number.isFinite(at) || at < context.nowMs - rules.released_within_days * DAY_MS) return false;
  }
  return true;
}

/** The episodes that match, newest first. */
export function evaluateFilter(rules: FilterRules, items: readonly MediaItem[], progress: readonly MediaProgress[], nowMs: number): MediaItem[] {
  const context: FilterContext = { progress: new Map(progress.map((p) => [p.media_id, p])), nowMs };
  return items.filter((item) => matchesRules(rules, item, context)).sort((a, b) => (b.external?.published_at ?? b.added_at).localeCompare(a.external?.published_at ?? a.added_at));
}

/** What a filter does, in the person's words: "Unplayed · Under 30 min · Last 14 days". */
export function filterSummary(rules: FilterRules | null, showLabels: ReadonlyMap<string, string> = new Map()): string {
  if (!rules) return "Every episode";
  const parts: string[] = [];
  if (rules.unplayed) parts.push("Unplayed");
  if (rules.in_progress) parts.push("In progress");
  if (rules.saved) parts.push("Saved on the hub");
  if (rules.min_minutes !== undefined && rules.max_minutes !== undefined) parts.push(`${rules.min_minutes} to ${rules.max_minutes} min`);
  else if (rules.min_minutes !== undefined) parts.push(`At least ${rules.min_minutes} min`);
  else if (rules.max_minutes !== undefined) parts.push(`Under ${rules.max_minutes} min`);
  if (rules.source_ids?.length) parts.push(rules.source_ids.map((id) => showLabels.get(id) ?? "A show").join(", "));
  if (rules.released_within_days !== undefined) parts.push(`Last ${rules.released_within_days} day${rules.released_within_days === 1 ? "" : "s"}`);
  return parts.length ? parts.join(" · ") : "Every episode";
}

const LENGTHS: Record<string, { min_minutes?: number; max_minutes?: number }> = { u15: { max_minutes: 15 }, u30: { max_minutes: 30 }, u60: { max_minutes: 60 }, o60: { min_minutes: 60 } };
const WITHIN = new Set(["7", "30", "90"]);

/** The "Save this filter" row of the new-filter pickers: what the chosen options mean, as fields the save action posts. No options, no row. */
export function draftRows(person: PersonRow, params: { status?: string; copy?: string; length?: string; within?: string; show?: string }): Array<Record<string, string>> {
  const body: Record<string, unknown> = {
    unplayed: params.status === "unplayed" ? "true" : "", in_progress: params.status === "in_progress" ? "true" : "", saved: params.copy === "saved" ? "true" : "",
    min_minutes: String(LENGTHS[params.length ?? ""]?.min_minutes ?? ""), max_minutes: String(LENGTHS[params.length ?? ""]?.max_minutes ?? ""),
    released_within_days: WITHIN.has(params.within ?? "") ? params.within : "", source_id: params.show ?? "",
  };
  const parsed = parseRules(person, body);
  if (!parsed.ok || Object.keys(parsed.rules).length === 0) return [];
  const summary = filterSummary(parsed.rules, showLabelsFor(person));
  return [{ id: "draft", title: "Save this filter", summary, thumbnail: "", ...Object.fromEntries(Object.entries(body).map(([key, value]) => [key, String(value ?? "")])) }];
}

export const personFilters = (person: PersonRow): MediaCollection[] => listCollections(person.id, "filter");

export function showLabelsFor(person: PersonRow): Map<string, string> {
  return new Map(allowedSources(person).filter((source) => source.kind === "feed").map((source) => [source.id, source.label]));
}

export type FilterView = { id: string; title: string; summary: string; rules: FilterRules | null };
export const rulesOf = (collection: MediaCollection): FilterRules | null => (collection.rules && typeof collection.rules === "object" ? (collection.rules as FilterRules) : null);
export const viewOf = (person: PersonRow, collection: MediaCollection): FilterView => ({ id: collection.id, title: collection.title, summary: filterSummary(rulesOf(collection), showLabelsFor(person)), rules: rulesOf(collection) });

type Saved = { ok: true; filter: FilterView } | { ok: false; status: 400 | 404 | 409; error: string };

/** Creates a filter, or (with `id`) replaces the rules and title of one of the person's own. A minor's title is held to the same word floor as a shared playlist name. */
export function saveFilter(person: PersonRow, body: Record<string, unknown>): Saved {
  const parsed = parseRules(person, body);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  const named = typeof body.title === "string" && !/^\{[^{}]+\}$/.test(body.title) ? body.title.trim().slice(0, TITLE_MAX) : "";
  const title = named !== "" ? named : filterSummary(parsed.rules, showLabelsFor(person)).slice(0, TITLE_MAX);
  if (mediaBandOf(person) !== "adult" && trips(title)) return { ok: false, status: 400, error: "That name cannot be used. Choose a different name for the filter." };
  const id = typeof body.id === "string" && body.id !== "" ? body.id : null;
  if (id) {
    const own = resolveCollection(person.id, id);
    if (!own || own.kind !== "filter") return { ok: false, status: 404, error: "That filter is not yours or no longer exists. Reload the page." };
    return { ok: true, filter: viewOf(person, saveFilterRules(renameCollection(own, title), parsed.rules)) };
  }
  if (personFilters(person).length >= MAX_FILTERS) return { ok: false, status: 409, error: `You have ${MAX_FILTERS} filters already. Delete one you no longer use first.` };
  return { ok: true, filter: viewOf(person, createFilterCollection(person.id, title, parsed.rules)) };
}

/** The episodes a saved filter shows this person now. An unknown or another person's filter shows nothing. */
export function filterEpisodes(person: PersonRow, filterId: string, limit: number, nowMs = Date.now()): MediaItem[] {
  const own = filterId === "" ? null : resolveCollection(person.id, filterId);
  if (!own || own.kind !== "filter") return [];
  const items = queryItems(person, "podcasts", { limit: 500 });
  return evaluateFilter(rulesOf(own) ?? {}, items, getProgressMany(person.id, items.map((item) => item.id)), nowMs).slice(0, limit);
}
