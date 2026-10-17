// KS-05: the one choke point where shelf items are released to an asker
// (RULES 0 and 7, the same shape as retrieval/minorFloor.ts's releaseToBand).
// What a user type gets is the intersection of: the shelf is on, the feed is
// enabled, the feed's audience includes the user type, a package feed's list
// is ticked for the user type AND offered to it by the policy, and the item's
// band_ok rank is at or below the user type's. For a minor the floor runs
// again on the text here, so a stored row is never trusted on its own word.
import type { AgeBand } from "@/lib/ageBand";
import { tripsMinorFloor } from "@/lib/retrieval/minorFloor";
import { listFeeds } from "./feedStore";
import { adminAddresses } from "./shelfFeeds";
import { bumpShelfCounter } from "./shelfCounters";
import { bandOkAllowedFor, feedVisibleTo, shelfEnabled, tickedByBand } from "./shelfPolicy";
import { sharedShelfStore, type ShelfItem, type ShelfStore } from "./shelfStore";

/** The ids of every feed whose items may reach this user type right now. */
export function visibleFeedIds(band: AgeBand): string[] {
  if (!shelfEnabled()) return [];
  const ticked = tickedByBand();
  // An admin's feed counts only while its address is still in the box, so a
  // removal takes effect at once, before the next tick deletes the row.
  const typed = adminAddresses();
  return listFeeds()
    .filter((feed) => feed.package_id || typed.get(feed.url) === feed.band)
    .filter((feed) => feedVisibleTo({ band: feed.band, packageId: feed.package_id ?? null, enabled: feed.enabled }, band, ticked))
    .map((feed) => feed.id);
}

export function releaseShelfItems(band: AgeBand, limit: number, store: ShelfStore | null = sharedShelfStore()): ShelfItem[] {
  if (!store || limit <= 0) return [];
  const feedIds = visibleFeedIds(band);
  if (feedIds.length === 0) return [];
  // Over-read so the release floor can drop a few and still fill the page.
  const candidates = store.list(feedIds, bandOkAllowedFor(band), band === "adult" ? limit : limit * 3);
  const released: ShelfItem[] = [];
  for (const item of candidates) {
    if (band !== "adult" && tripsMinorFloor(item.summary ? `${item.title}. ${item.summary}` : item.title)) {
      bumpShelfCounter("release_floor_dropped", band);
      continue;
    }
    released.push(item);
    if (released.length >= limit) break;
  }
  return released;
}

/** NEWS-02: one item by id, released to this user type or null. The same rules as `releaseShelfItems` (a carrying feed visible to
 * the band, band_ok at or below it, the minor floor run again on the text), so a story, a picture or a save can never be reached by
 * guessing an id the asker's lists do not release. */
export function releaseShelfItem(band: AgeBand, id: string, store: ShelfStore | null = sharedShelfStore()): ShelfItem | null {
  if (!store || !shelfEnabled()) return null;
  const item = store.get(id);
  if (!item) return null;
  const visible = new Set(visibleFeedIds(band));
  if (!store.feedIdsOf(item.canonical_url).some((feedId) => visible.has(feedId))) return null;
  if (!bandOkAllowedFor(band).includes(item.band_ok)) return null;
  if (band !== "adult" && tripsMinorFloor(item.summary ? `${item.title}. ${item.summary}` : item.title)) {
    bumpShelfCounter("release_floor_dropped", band);
    return null;
  }
  return item;
}
