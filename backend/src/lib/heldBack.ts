/**
 * UNSEEN-01 (RULES.md C10, 6a, S6): the household's count of what the content filters held back, for an owner or admin's Status page.
 * Counts only: no title, no person, no item. It sums the filter-drop counters that already exist (condition C: never a failure
 * counter) and they live in memory since the hub started (condition B), so the Status line says "since the hub started".
 */
import { newsCounters } from "@/lib/news/newsCounters";
import { referenceCounters } from "@/lib/retrieval/referenceCounters";
import { shelfCounters } from "@/lib/shelf/shelfCounters";

export type HeldBackSurface = "news" | "shelf" | "reference" | "search";
export interface HeldBackView { since: string; surfaces: { surface: HeldBackSurface; count: number }[] }

/** Sums one counter over every band: `news.story_gate_dropped` and `shelf.release_floor_dropped.child` both read. */
function sumOf(counters: Record<string, number>, ...names: string[]): number {
  let total = 0;
  for (const [key, value] of Object.entries(counters)) {
    if (names.some((name) => key === name || key.startsWith(`${name}.`))) total += value;
  }
  return total;
}

export function heldBackView(now = Date.now()): HeldBackView {
  const news = newsCounters(), shelf = shelfCounters(), reference = referenceCounters();
  return {
    since: new Date(now - Math.round(process.uptime() * 1000)).toISOString(),
    surfaces: [
      { surface: "news", count: sumOf(news, "news.story_gate_dropped") },
      { surface: "shelf", count: sumOf(shelf, "shelf.release_floor_dropped") },
      { surface: "reference", count: sumOf(reference, "reference.floor_dropped", "reference.ingest_floor_dropped") },
      { surface: "search", count: sumOf(reference, "reference.search_floor_dropped") },
    ],
  };
}
