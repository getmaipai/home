// KS-05 (docs/design/knowledge-sources.md, "The shelf"): who may see which
// feed. One definition, used by the poller (what is worth fetching), by the
// reader (what is released to an asker) and by the settings sync.
//
//   Feed.band is the audience of a feed:
//     child feed: child only        teen feed: teen and adult
//     adult feed: adult only
//   A package list reaches a user type only when ALL of these hold:
//     1. the admin ticked the list for that user type (news.lists.<band>),
//     2. the list is offered to that user type in spec/news/feed-lists.json
//        (checked here whatever the stored value says: a minor never gets a
//        list the policy does not mark for them),
//     3. that user type is inside the feed's audience.
//   An item is released to a user type only when its band_ok rank is at or
//   below that user type's (the minor floor stamped it at ingest and runs
//   again at release). The floor has no child/teen split today, so band_ok
//   is "child" (passes, usable by child and teen) or "adult" (tripped it);
//   "teen" is a legal value nothing writes yet.
import feedListsPolicy from "@maipai/spec/news/feed-lists.json" with { type: "json" };
import { FeedLists } from "@maipai/spec/gen/ts/feed-lists.js";
import type { AgeBand } from "@/lib/ageBand";
import { getHouseholdSettingValue } from "@/lib/settings";

export const BANDS: readonly AgeBand[] = ["child", "teen", "adult"];
const RANK: Record<AgeBand, number> = { child: 0, teen: 1, adult: 2 };

const policy = FeedLists.parse(feedListsPolicy);
export const FEED_LISTS = policy.lists;

export function isBand(value: unknown): value is AgeBand {
  return value === "child" || value === "teen" || value === "adult";
}

/** The user types that may see a feed of this audience. */
export function audienceOf(feedBand: AgeBand): AgeBand[] {
  if (feedBand === "child") return ["child"];
  if (feedBand === "teen") return ["teen", "adult"];
  return ["adult"];
}

/** The band_ok values a user type may be shown, best first. */
export function bandOkAllowedFor(band: AgeBand): AgeBand[] {
  return BANDS.filter((candidate) => RANK[candidate] <= RANK[band]);
}

export function listIdForPackage(packageId: string): string | null {
  return FEED_LISTS.find((list) => list.package_id === packageId)?.id ?? null;
}

export function shelfEnabled(): boolean {
  return getHouseholdSettingValue("news.shelf.enabled") !== false;
}

/** The lists ticked for a user type, intersected with the policy's
 * offered_for: the stored value can never widen what the policy allows. */
export function listsTickedFor(band: AgeBand): string[] {
  const stored = getHouseholdSettingValue(`news.lists.${band}`);
  if (!Array.isArray(stored)) return [];
  const ticked = new Set(stored.filter((v): v is string => typeof v === "string"));
  return FEED_LISTS.filter((list) => ticked.has(list.id) && list.offered_for.includes(band)).map((list) => list.id);
}

export interface FeedAudienceFields {
  band: AgeBand;
  packageId: string | null;
  enabled: boolean;
}

/** Whether a feed's items may reach a user type right now. */
export function feedVisibleTo(feed: FeedAudienceFields, band: AgeBand, ticked: ReadonlyMap<AgeBand, readonly string[]> = tickedByBand()): boolean {
  return shelfEnabled() && feedOfferedTo(feed, band, ticked);
}

/** The same rule without the shelf switch: whether this feed is one the band is offered, whether or not the shelf is on right now
 * (an answer that must not depend on the switch, such as whether a channel exists, asks this). */
export function feedOfferedTo(feed: FeedAudienceFields, band: AgeBand, ticked: ReadonlyMap<AgeBand, readonly string[]> = tickedByBand()): boolean {
  if (!feed.enabled) return false;
  // An admin's own feed (no package) is as visible as its audience.
  if (!feed.packageId) return audienceOf(feed.band).includes(band);
  // A bundled feed follows its list: ticked for this user type and offered to it
  // (listsTickedFor already intersects the two). Its stored band is only the
  // youngest user type the list is offered to, not a limit on the older ones.
  const listId = listIdForPackage(feed.packageId);
  return listId !== null && (ticked.get(band) ?? []).includes(listId);
}

export function tickedByBand(): Map<AgeBand, string[]> {
  return new Map(BANDS.map((band) => [band, listsTickedFor(band)] as const));
}

/** Whether a feed is worth fetching at all: somebody can see it. */
export function feedIsWanted(feed: FeedAudienceFields): boolean {
  if (!shelfEnabled() || !feed.enabled) return false;
  const ticked = tickedByBand();
  return BANDS.some((band) => feedVisibleTo(feed, band, ticked));
}

const DEFAULT_RETENTION_DAYS = 90;

export function retentionDays(): number {
  const value = getHouseholdSettingValue("news.retention_days");
  return typeof value === "number" && Number.isFinite(value) && value >= 1 ? Math.floor(value) : DEFAULT_RETENTION_DAYS;
}

export function pollIntervalSeconds(): number {
  const value = getHouseholdSettingValue("news.poll_interval_s");
  return typeof value === "number" && Number.isFinite(value) && value >= 900 ? Math.floor(value) : 1800;
}
