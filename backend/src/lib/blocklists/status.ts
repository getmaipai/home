// MINOR-SEARCH-01e-6: the one-line status under each "Blocked sites" setting. It reports only counts and an age,
// never a site, a search or a block (design section 6: nothing about what was blocked is shown).
import type { AgeBand } from "@/lib/ageBand";
import { enabledListIds } from "@/lib/blocklists/policy";
import { isListLoaded, readState } from "@/lib/blocklists/listStore";

const DAY_MS = 86_400_000;

function ageText(iso: string | null, now: number): string | null {
  const at = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(at)) return null;
  const days = Math.max(0, Math.floor((now - at) / DAY_MS));
  return days === 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;
}

function sitesText(entries: number): string {
  if (entries <= 0) return "no sites";
  if (entries >= 950_000) return `about ${(Math.round(entries / 100_000) / 10).toString()} million sites`;
  if (entries >= 1000) return `about ${(Math.round(entries / 1000)).toLocaleString("en-US")} thousand sites`;
  return `${entries} sites`;
}

/** The status sentence for a band's blocked-sites setting: the lists that count for it (locked ones included). */
export function blocklistStatusNote(band: AgeBand, now = Date.now()): string {
  const ids = enabledListIds(band);
  if (ids.length === 0) return "No lists are checked.";
  const state = readState();
  const loaded = ids.filter((id) => isListLoaded(id));
  const waiting = ids.length - loaded.length;
  if (loaded.length === 0) return "Waiting for the first download. Web search for these controls stays off until it finishes.";
  const total = loaded.reduce((sum, id) => sum + (state.lists[id]?.entries ?? 0), 0);
  const age = ageText(state.lastGoodAt, now);
  const counts = `${loaded.length} ${loaded.length === 1 ? "list" : "lists"}, ${sitesText(total)} blocked.`;
  const base = age ? `Updated ${age}, ${counts}` : `${counts[0]!.toUpperCase()}${counts.slice(1)}`;
  return waiting > 0
    ? `${base} ${waiting} more ${waiting === 1 ? "list is" : "lists are"} still downloading, and web search for these controls stays off until they finish.`
    : base;
}
