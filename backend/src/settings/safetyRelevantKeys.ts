// SETTINGS-AUDIT-01: which settings keys an owner or admin change is recorded for, and which way a change points.
// This file decides nothing about who may write; it only labels a write that already succeeded.

/** Keys recorded even when their declaration has no band layer. */
export const SAFETY_RELEVANT_KEYS: readonly string[] = Object.freeze([
  "search.web.child_mode", "search.web.teen_mode", "search.web_sources", "search.blocklists", "search.blocklists.child",
  "search.blocklists.teen", "search.blocklists.adult", "search.hosts.allow", "search.hosts.deny", "search.safe_search",
  "search.page_text_cleaning", "media.allowlist_only", "synths.real_people", "generation.kids", "generation.kid_enabled",
  "generation.kids_daily_pictures", "generation.kids_daily_videos", "generation.adults", "generation.video.enabled",
  "generation.music.enabled", "companions.allowed", "content.filters", "talent.minors.make",
]);

export const SAFETY_RELEVANT_PREFIXES: readonly string[] = Object.freeze(["topics.", "coding.person.", "search.ddgs", "content.", "access."]);

export function isSafetyRelevantKey(key: string, def?: { layers?: string[] }): boolean {
  if (def?.layers?.includes("band")) return true;
  if (SAFETY_RELEVANT_KEYS.includes(key)) return true;
  return SAFETY_RELEVANT_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export type ChangeDirection = "widens" | "narrows" | "changes";

const TRUE_WIDENS = new Set([
  "search.web.child_mode", "search.web.teen_mode", "generation.kids", "generation.kid_enabled", "generation.video.enabled",
  "generation.music.enabled", "companions.allowed", "talent.minors.make",
]);
const TRUE_NARROWS = new Set(["media.allowlist_only", "search.page_text_cleaning"]);
const SAFE_SEARCH_ORDER = ["off", "moderate", "strict"];

function isListKey(key: string): "fewer-widens" | "fewer-narrows" | null {
  if (key.startsWith("search.blocklists") || key === "search.hosts.deny") return "fewer-widens";
  if (key === "search.hosts.allow" || key === "content.filters") return "fewer-narrows";
  return null;
}

/** The number of entries a list value stands for, or the net change of a `{ add, remove }` delta (previous is then ignored). */
function listSize(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

export function directionFor(key: string, previous: unknown, value: unknown): ChangeDirection {
  if (key === "search.safe_search") {
    const before = SAFE_SEARCH_ORDER.indexOf(String(previous ?? ""));
    const after = SAFE_SEARCH_ORDER.indexOf(String(value ?? ""));
    if (before < 0 || after < 0 || before === after) return "changes";
    return after < before ? "widens" : "narrows";
  }
  if (key.startsWith("search.ddgs")) {
    // off < teens < teens_and_children: more people reaching the web widens; a boolean works too.
    const rank = (v: unknown): number => (v === true || v === "on" ? 2 : v === false || v === "off" || v == null ? 0 : v === "teens" ? 1 : v === "teens_and_children" ? 2 : -1);
    const before = rank(previous);
    const after = rank(value);
    if (before < 0 || after < 0 || before === after) return "changes";
    return after > before ? "widens" : "narrows";
  }
  const on = (v: unknown): boolean | null => (v === true || v === "on" ? true : v === false || v === "off" ? false : null);
  if (TRUE_WIDENS.has(key) || TRUE_NARROWS.has(key)) {
    const now = on(value);
    if (now === null || on(previous) === now) return "changes";
    const trueWidens = !TRUE_NARROWS.has(key);
    return now === trueWidens ? "widens" : "narrows";
  }
  const list = isListKey(key);
  if (list) {
    let net: number;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const delta = value as { add?: unknown; remove?: unknown };
      net = listSize(delta.add) - listSize(delta.remove);
    } else {
      net = listSize(value) - listSize(previous);
    }
    if (net === 0) return "changes";
    const more = net > 0;
    return (list === "fewer-widens" ? more : !more) ? "narrows" : "widens";
  }
  return "changes";
}
