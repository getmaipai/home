// NEWS-PICTURES-01 (owner, 2026-10-25): pictures for the stories a screen will show first are fetched ahead of time, under the same switch,
// idle rule and per-source pace as NEWS-07's full text: one request per picture host per pass (a pass is a minute), 150 a day per host, a
// refusing host quiet on its own. It runs the same `newsPicture` the picture route runs, so the guards, the cache and the 14 day expiry are
// the route's own; nothing here is a second fetcher.
import { isNull } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { appRouteAllowed } from "@/lib/apps";
import { getHouseholdSettingValue } from "@/lib/settings";
import { tryConsume } from "@/lib/rateLimiter";
import { DEFAULT_IDLE_WINDOW_MS, turnActiveWithin } from "@/lib/turnActivity";
import { sharedShelfStore } from "@/lib/shelf/shelfStore";
import { NEWS_FULL_TEXT_PREFETCH_KEY } from "@/settings/newsKeys";
import { pictureCandidates, viewerOf } from "./data";
import { newsImagesOn, newsPicture, newsPictureCached } from "./pictures";

let running = false;
const MAX_HOSTS_PER_PASS = 8;

export async function prefetchNewsPictures(deps: { now?: () => number; busy?: () => boolean } = {}): Promise<number> {
  if (running || getHouseholdSettingValue(NEWS_FULL_TEXT_PREFETCH_KEY) !== true || !newsImagesOn()) return 0;
  const now = deps.now ?? Date.now;
  const busy = deps.busy ?? (() => turnActiveWithin(DEFAULT_IDLE_WINDOW_MS));
  if (busy()) return 0;
  const store = sharedShelfStore();
  if (!store) return 0;
  running = true;
  try {
    const hostsTried = new Set<string>();
    let fetched = 0;
    for (const person of db.select().from(people).where(isNull(people.deletedAt)).all()) {
      if (person.role === "guest" || !person.enabled || person.memorializedAt || !appRouteAllowed(person, "news", "data", "today")) continue;
      const at = now();
      const { band } = viewerOf(person, new Date(at));
      for (const item of pictureCandidates(person, new Date(at))) {
        if (newsPictureCached(item.id)) continue;
        if (busy() || getHouseholdSettingValue(NEWS_FULL_TEXT_PREFETCH_KEY) !== true) return fetched;
        let host: string;
        try { host = new URL(item.image_url!).hostname.toLowerCase().replace(/^www\./, ""); } catch { continue; }
        if (hostsTried.has(host)) continue;
        if (!store.claimPrefetch(item.image_url!, host, at)) continue;
        if (!tryConsume(`net:news:prefetch:${host}`, { capacity: 1, refillPerSecond: 1 / 30 }, at)) continue;
        hostsTried.add(host);
        try {
          const picture = await newsPicture(item, 480, band, "prefetch");
          store.prefetchOutcome(picture !== null, now(), host);
        } catch {
          store.prefetchOutcome(false, now(), host);
        }
        fetched++;
        if (hostsTried.size >= MAX_HOSTS_PER_PASS) return fetched;
      }
    }
    return fetched;
  } finally { running = false; }
}
