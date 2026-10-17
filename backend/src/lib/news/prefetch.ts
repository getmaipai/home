// NEWS-07: the owner's 2026-09-24 exception. One idle attempt per tick, through the existing reader, never a fetcher.
import { isNull } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { appRouteAllowed } from "@/lib/apps";
import { getHouseholdSettingValue } from "@/lib/settings";
import { tryConsume } from "@/lib/rateLimiter";
import { DEFAULT_IDLE_WINDOW_MS, turnActiveWithin } from "@/lib/turnActivity";
import { sharedShelfStore } from "@/lib/shelf/shelfStore";
import { NEWS_FULL_TEXT_PREFETCH_KEY } from "@/settings/newsKeys";
import { loadContent } from "./article";
import { fullTextCandidates, viewerOf } from "./data";

let running = false;

/** Scheduler granularity is one minute, deliberately slower than the allowed 30 second floor.
 * Receipts and rolling site counts live in the shelf database and survive prune and process restart.
 * Failed or unusable pages quiet the entire background class, doubling from one hour to one day.
 * A receipt is kept even on failure: no retry of that item in the background, ever.
 */
export async function prefetchNewsText(deps: { now?: () => number; busy?: () => boolean } = {}): Promise<number> {
  if (running || getHouseholdSettingValue(NEWS_FULL_TEXT_PREFETCH_KEY) !== true) return 0;
  const now = deps.now ?? Date.now;
  const busy = deps.busy ?? (() => turnActiveWithin(DEFAULT_IDLE_WINDOW_MS));
  if (busy()) return 0;
  const store = sharedShelfStore();
  if (!store) return 0;
  running = true;
  try {
    for (const person of db.select().from(people).where(isNull(people.deletedAt)).all()) {
      if (person.role === "guest" || !person.enabled || person.memorializedAt || !appRouteAllowed(person, "news", "data", "today") || !appRouteAllowed(person, "news", "data", "story")) continue;
      const at = now();
      const { band } = viewerOf(person, new Date(at));
      for (const item of fullTextCandidates(person, new Date(at))) {
        // Already opened or saved by any band: background work has nothing to add. A later open can still refresh it.
        if ((["child", "teen", "adult"] as const).some((variant) => store.getContent(item.id, variant))) continue;
        if (busy() || getHouseholdSettingValue(NEWS_FULL_TEXT_PREFETCH_KEY) !== true) return 0;
        const site = new URL(item.canonical_url).hostname.toLowerCase().replace(/^www\./, "");
        if (!store.claimPrefetch(item.canonical_url, site, at)) continue;
        if (!tryConsume("net:news:prefetch", { capacity: 1, refillPerSecond: 1 / 30 }, at)) return 0;
        try {
          const loaded = await loadContent(item, band, { store, background: true });
          store.prefetchOutcome(loaded.source !== "teaser", now());
        } catch {
          store.prefetchOutcome(false, now());
        }
        return 1;
      }
    }
    return 0;
  } finally { running = false; }
}
