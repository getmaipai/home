// KS-05: the one choke point where shelf items are released to an asker
// (RULES 0 and 7, the same shape as retrieval/minorFloor.ts's releaseToBand).
// What a user type gets is the intersection of: the shelf is on, the feed is
// enabled, the feed's audience includes the user type, a package feed's list
// is ticked for the user type AND offered to it by the policy, and the item's
// band_ok rank is at or below the user type's, and (FILTER-MEDIA-01, RULES.md C9) for a minor the stored stamp is within the
// viewer's ceiling. The minor floor on the text ran once, when the story arrived (shelfStamp.ts), and the stamp carries it; no
// word check runs on a read.
import type { AgeBand } from "@/lib/ageBand";
import { storedRatingFilterForBand } from "@/lib/filter/stamps";
import { listFeeds } from "./feedStore";
import { adminAddresses } from "./shelfFeeds";
import { bumpShelfCounter } from "./shelfCounters";
import { bandOkAllowedFor, feedOfferedTo, feedVisibleTo, shelfEnabled, tickedByBand } from "./shelfPolicy";
import { sharedShelfStore, type ShelfItem, type ShelfStore } from "./shelfStore";

/** Kept for tests written when a floor memo existed; the read path has no memo now (the stamp carries the verdict). */
export function __resetFloorMemoForTests(): void { /* nothing to reset */ }

/** The ids of every feed whose items may reach this user type right now. */
export function visibleFeedIds(band: AgeBand): string[] {
  if (!shelfEnabled()) return [];
  const ticked = tickedByBand();
  // An admin's feed counts only while its address is still in the box, so a
  // removal takes effect at once, before the next tick deletes the row.
  const typed = adminAddresses();
  return listFeeds("news")
    .filter((feed) => feed.package_id || typed.get(feed.url) === feed.band)
    .filter((feed) => feedVisibleTo({ band: feed.band, packageId: feed.package_id ?? null, enabled: feed.enabled }, band, ticked))
    .map((feed) => feed.id);
}

/** Whether a feed is one this user type is offered, independent of the shelf switch. */
export function feedIsOfferedTo(band: AgeBand, feedId: string): boolean {
  const feed = listFeeds().find((candidate) => candidate.id === feedId);
  if (!feed) return false;
  if (!feed.package_id && adminAddresses().get(feed.url) !== feed.band) return false;
  return feedOfferedTo({ band: feed.band, packageId: feed.package_id ?? null, enabled: feed.enabled }, band, tickedByBand());
}

export function releaseShelfItems(band: AgeBand, limit: number, store: ShelfStore | null = sharedShelfStore()): ShelfItem[] {
  if (!store || limit <= 0) return [];
  const feedIds = visibleFeedIds(band);
  if (feedIds.length === 0) return [];
  // Over-read so the stamp can drop a few and still fill the page.
  const candidates = store.list(feedIds, bandOkAllowedFor(band), band === "adult" ? limit : limit * 3);
  const released: ShelfItem[] = [];
  // RATE-INGEST-01 (C9): a minor reads the stored rating only (one query for the page; no rater runs here).
  // An item with no stamp yet is Unrated and waits for the ratings sweep. An adult reads no stamps.
  const stamped = storedRatingFilterForBand("shelf_item", band, candidates.map((item) => item.id));
  for (const item of candidates) {
    if (!stamped(item.id)) { // the stamp holds the floor's verdict (X) and an unrated story (Unrated): both are dropped and counted
      bumpShelfCounter("release_floor_dropped", band);
      continue;
    }
    released.push(item);
    if (released.length >= limit) break;
  }
  return released;
}

/** NEWS-02: one item by id, released to this user type or null. The same rules as `releaseShelfItems` (a carrying feed visible to
 * the band, band_ok at or below it, the stored stamp within the band's ceiling), so a story, a picture or a save can never be reached by
 * guessing an id the asker's lists do not release. */
export function releaseShelfItem(band: AgeBand, id: string, store: ShelfStore | null = sharedShelfStore()): ShelfItem | null {
  if (!store || !shelfEnabled()) return null;
  const item = store.get(id);
  if (!item) return null;
  const visible = new Set(visibleFeedIds(band));
  if (!store.feedIdsOf(item.canonical_url).some((feedId) => visible.has(feedId))) return null;
  if (!bandOkAllowedFor(band).includes(item.band_ok)) return null;
  if (!storedRatingFilterForBand("shelf_item", band, [item.id])(item.id)) {
    bumpShelfCounter("release_floor_dropped", band);
    return null;
  }
  return item;
}
