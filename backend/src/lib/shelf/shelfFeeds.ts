// KS-05: keeps the feeds table equal to what the household asked for.
//   - package feeds: every list in spec/news/feed-lists.json names a bundled
//     module package whose feeds.json carries its feeds. A row exists for
//     each (whether or not the list is ticked: ticking is a read-time and
//     poll-time gate, so the admin's tick takes effect at once).
//   - admin feeds: addresses typed into `news.feeds.<band>`. A row exists
//     for each while the address is in its box; removing the address
//     removes the row and the items only it carried. An address in more
//     than one box goes to the oldest user type's box (adult, then teen,
//     then child): the safe direction for a minor.
// The audience of a package feed is the youngest user type its list is
// offered to; an admin feed's audience is its box.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FeedListPackage } from "@maipai/spec/gen/ts/feed-list-package.js";
import { PACKAGES_DIR } from "@/lib/paths";
import type { AgeBand } from "@/lib/ageBand";
import { getHouseholdSettingValue } from "@/lib/settings";
import { BANDS, FEED_LISTS, isBand, pollIntervalSeconds, shelfEnabled } from "./shelfPolicy";
import { checkFeedAddress, splitFeedAddresses } from "./feedAddresses";
import { createFeed, deleteFeed, findFeedByUrl, listFeeds, updateFeed } from "./feedStore";
import { sharedShelfStore, type ShelfStore } from "./shelfStore";

import { reportShelfEvent } from "./shelfEvents";

const RANK: Record<AgeBand, number> = { child: 0, teen: 1, adult: 2 };

interface Desired { url: string; title: string; publisher: string; band: AgeBand; packageId: string | null; provenance: string; topics?: readonly string[] }

function youngestOffered(offered: readonly string[]): AgeBand {
  return offered.filter(isBand).sort((a, b) => RANK[a] - RANK[b])[0] ?? "adult";
}

function readPackageFeeds(packagesDir: string): Desired[] {
  const out: Desired[] = [];
  for (const list of FEED_LISTS) {
    let parsed: FeedListPackage;
    try {
      parsed = FeedListPackage.parse(JSON.parse(readFileSync(join(packagesDir, list.package_id, "feeds.json"), "utf8")));
    } catch {
      // A missing or malformed package file means no feeds for that list, never a failed tick.
      console.warn(`[shelf] the feed list ${list.id} has no readable feeds.json; it contributes no feeds`);
      continue;
    }
    if (parsed.list_id !== list.id) continue;
    for (const feed of parsed.feeds) {
      const checked = checkFeedAddress(feed.url);
      if (!checked.ok) continue;
      out.push({ url: checked.url, title: feed.title, publisher: feed.publisher, band: youngestOffered(list.offered_for), packageId: list.package_id, provenance: `package:${list.package_id}`, ...(feed.topics_hint?.length ? { topics: feed.topics_hint } : {}) });
    }
  }
  return out;
}

let hintsByUrl: Map<string, readonly string[]> | null = null;
export function __resetTopicHintsForTests(): void { hintsByUrl = null; }

/** The topic ids a feed-list package says a feed covers (its `topics_hint`), by feed address; empty for any other feed. The poller
 * tags every story such a feed carries with them, so a topic's count and channel fill without a classifier. */
export function topicsHintFor(feedUrl: string, packagesDir: string = PACKAGES_DIR): readonly string[] {
  hintsByUrl ??= new Map(readPackageFeeds(packagesDir).filter((feed) => feed.topics).map((feed) => [feed.url, feed.topics!] as const));
  return hintsByUrl.get(feedUrl) ?? [];
}

/** The addresses in each admin box right now, valid ones only, by the band whose box wins. */
export function adminAddresses(): Map<string, AgeBand> {
  const winner = new Map<string, AgeBand>();
  for (const band of [...BANDS].sort((a, b) => RANK[a] - RANK[b])) {
    for (const part of splitFeedAddresses(getHouseholdSettingValue(`news.feeds.${band}`))) {
      const checked = checkFeedAddress(part);
      // Later (older) boxes overwrite earlier ones: the older user type wins.
      if (checked.ok) winner.set(checked.url, band);
    }
  }
  return winner;
}

/** The distinct hosts of the feeds an adult typed in, while the shelf is on (for the privacy page). */
export function shelfAdminHosts(): string[] {
  if (!shelfEnabled()) return [];
  const hosts = new Set<string>();
  for (const url of adminAddresses().keys()) {
    const checked = checkFeedAddress(url);
    if (checked.ok) hosts.add(checked.host);
  }
  return [...hosts].sort();
}

export function syncShelfFeeds(options: { nowIso?: string; store?: ShelfStore | null; packagesDir?: string } = {}): { created: number; removed: number } {
  const nowIso = options.nowIso ?? new Date().toISOString();
  const store = options.store === undefined ? sharedShelfStore() : options.store;
  const interval = pollIntervalSeconds();
  const desired = new Map<string, Desired>();
  for (const [url, band] of adminAddresses()) {
    const host = checkFeedAddress(url);
    const name = host.ok ? host.host : url;
    desired.set(url, { url, title: name, publisher: name, band, packageId: null, provenance: "admin" });
  }
  // A package's own feed wins over the same address typed by an admin.
  const packageFeeds = readPackageFeeds(options.packagesDir ?? PACKAGES_DIR);
  for (const feed of packageFeeds) desired.set(feed.url, feed);
  hintsByUrl = new Map(packageFeeds.filter((feed) => feed.topics).map((feed) => [feed.url, feed.topics!] as const));

  let created = 0;
  let removed = 0;
  const existing = new Map(listFeeds("news").map((feed) => [feed.url, feed] as const));
  for (const [url, want] of desired) {
    if (findFeedByUrl(url)?.purpose === "podcast") {
      reportShelfEvent("purpose_conflict");
      continue;
    }
    const have = existing.get(url);
    if (!have) {
      createFeed({ url, title: want.title, publisher: want.publisher, band: want.band, packageId: want.packageId, pollIntervalS: interval, provenance: want.provenance, nowIso });
      created++;
      continue;
    }
    const changed = have.band !== want.band || have.title !== want.title || have.publisher !== want.publisher || have.poll_interval_s !== Math.max(900, interval) || (have.package_id ?? null) !== want.packageId;
    if (changed && (have.package_id ?? null) === want.packageId) {
      updateFeed(have.id, { band: want.band, title: want.title, publisher: want.publisher, pollIntervalS: interval }, nowIso);
    } else if (changed) {
      // Moved between "admin typed it" and "a package carries it": start the row fresh.
      store?.forgetFeed(have.id);
      deleteFeed(have.id);
      createFeed({ url, title: want.title, publisher: want.publisher, band: want.band, packageId: want.packageId, pollIntervalS: interval, provenance: want.provenance, nowIso });
    }
  }
  for (const [url, have] of existing) {
    if (desired.has(url)) continue;
    store?.forgetFeed(have.id);
    deleteFeed(have.id);
    removed++;
  }
  return { created, removed };
}
