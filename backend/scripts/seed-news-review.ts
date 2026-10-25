#!/usr/bin/env bun
// News review content for the dev Home: turns the News shelf on, adds three adult feeds and one Kids' feed (admin addresses on
// example.com, never polled), 16 invented stories with generated same-origin pictures, and two channel follows for Sage.
// Pictures are written straight into the news picture cache (news-images/<ref>-480|1280.webp), so the picture route serves
// them without any fetch. Persona-neutral outlet names only. Run against the dev hub's data directory, never a live hub:
//
//   cd backend && MAIPAI_DATA_DIR=../data/dev/hub bun scripts/seed-news-review.ts [ownerDisplayName]
//
// Or from the repo root: bun run news:seed (see scripts/dev.sh header). Safe to run again: items are keyed by address.
import sharp from "sharp";
import { mkdirSync, writeFileSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { packageStatus, people } from "../src/db/schema";
import { setHouseholdSettingValue } from "../src/lib/settings";
import { syncShelfFeeds } from "../src/lib/shelf/shelfFeeds";
import { findFeedByUrl, updateFeed } from "../src/lib/shelf/feedStore";
import { sharedShelfStore } from "../src/lib/shelf/shelfStore";
import { newNewsItemId } from "../src/lib/id";
import { nextHlc } from "../src/lib/hlc";
import { newsPictureDir, pictureRefOf } from "../src/lib/news/pictures";
import { setFollow } from "../src/lib/news/records";
import { speakerAgeBand } from "../src/lib/ageBand";

const ownerName = process.argv[2] ?? "Sage";
const owner = db.select().from(people).where(eq(people.displayName, ownerName)).get();
if (!owner) { console.error(`no such person: ${ownerName} (is this the seeded dev hub data directory?)`); process.exit(1); }
const store = sharedShelfStore();
if (!store) { console.error("could not open knowledge.db"); process.exit(1); }

const ok = (result: { ok: boolean; error?: string }, what: string) => { if (!result.ok) { console.error(`${what}: ${result.error}`); process.exit(1); } };

// The News package's startup smoke test runs `deno test` with a cache-only flag; on a machine whose Deno cache lacks @std/assert
// it fails and the package is disabled (no app, no page). Mark it enabled in this dev hub so the app shows. A hub restart
// that re-runs the smoke test can flip it back: run this script again.
{
  const now = new Date().toISOString();
  db.insert(packageStatus).values({ packageId: "news", status: "enabled", lastSmokeAt: now, smokeOk: true, smokeMessage: "enabled by seed-news-review" })
    .onConflictDoUpdate({ target: packageStatus.packageId, set: { status: "enabled", lastSmokeAt: now, smokeOk: true, smokeMessage: "enabled by seed-news-review" } }).run();
}

// Feeds: admin addresses (one per line) per audience box; the admin's own feeds, so no bundled real-world list is ticked.
const FEEDS = {
  wire: { host: "examplewire.example.com", band: "adult" as const },
  sample: { host: "dailysample.example.com", band: "teen" as const },
  harbor: { host: "harborpost.example.com", band: "teen" as const },
  kids: { host: "kidsgazette.example.com", band: "child" as const },
};
const address = (key: keyof typeof FEEDS) => `https://${FEEDS[key].host}/feed.xml`;
ok(setHouseholdSettingValue("news.shelf.enabled", true), "news.shelf.enabled");
for (const band of ["adult", "teen", "child"] as const) {
  const list = (Object.keys(FEEDS) as Array<keyof typeof FEEDS>).filter((key) => FEEDS[key].band === band).map(address).join("\n");
  ok(setHouseholdSettingValue(`news.feeds.${band}`, list), `news.feeds.${band}`);
}
syncShelfFeeds();
const PUBLISHER = { wire: "Example Wire", sample: "Daily Sample", harbor: "Harbor Post", kids: "Kids Gazette" } as const;
const feedId: Record<string, string> = {};
for (const key of Object.keys(FEEDS) as Array<keyof typeof FEEDS>) {
  const feed = findFeedByUrl(address(key));
  if (!feed) { console.error(`feed not created for ${key}`); process.exit(1); }
  feedId[key] = feed.id;
  // Never polled: the addresses are placeholders. The poll time is pushed far out.
  updateFeed(feed.id, { nextPollAt: "2099-01-01T00:00:00.000Z", publisher: PUBLISHER[key] }, new Date().toISOString());
}

interface Story { feed: keyof typeof FEEDS; topic: string; hoursAgo: number; title: string; dek: string; picture?: [string, string] }
const STORIES: Story[] = [
  { feed: "wire", topic: "world", hoursAgo: 1.2, title: "Leaders agree on a shared plan to clear river shipping lanes", dek: "Eleven countries signed a two-year schedule for dredging and lock repairs. Cargo operators say the first backlog should ease by spring.", picture: ["#1f4e79", "#7fb3d5"] },
  { feed: "sample", topic: "technology", hoursAgo: 2.5, title: "A small team's open translator now runs on a phone with no network", dek: "The model fits in under two gigabytes and handles twelve languages. Testers report it keeps up with live conversation.", picture: ["#4a2c7a", "#c39bd3"] },
  { feed: "harbor", topic: "local", hoursAgo: 3.1, title: "Ferry service adds early sailings after a record summer", dek: "Riders asked for more morning trips to the island, and the harbor authority agreed to add two a day starting Monday.", picture: ["#0e6655", "#76d7c4"] },
  { feed: "wire", topic: "business", hoursAgo: 4.0, title: "Grain prices ease as harvests come in ahead of forecasts", dek: "Traders expect steadier bread and cereal costs by winter. Analysts caution that fuel costs remain a risk.", picture: ["#9a7d0a", "#f7dc6f"] },
  { feed: "sample", topic: "sports", hoursAgo: 5.4, title: "Late goal lifts the home side into the cup semifinal", dek: "A header in the 88th minute settled a tense match. The semifinal is set for the second week of next month.", picture: ["#196f3d", "#82e0aa"] },
  { feed: "harbor", topic: "science", hoursAgo: 6.2, title: "Tide pools reveal a species thought to have left the coast", dek: "Volunteers counting shoreline life found dozens of the small snails near the north rocks. Researchers will survey again in spring.", picture: ["#1b4f72", "#85c1e9"] },
  { feed: "wire", topic: "science", hoursAgo: 7.7, title: "Telescope team maps the faint glow between two distant galaxies", dek: "The new map suggests a thin bridge of gas links them. The finding helps explain how large clusters grow." },
  { feed: "sample", topic: "business", hoursAgo: 8.5, title: "Corner bakeries band together to buy flour in bulk", dek: "Fourteen shops pooled orders and cut costs by a fifth. They plan to share a delivery van next year.", picture: ["#a04000", "#f0b27a"] },
  { feed: "harbor", topic: "sports", hoursAgo: 9.9, title: "Youth rowing club opens its doors for a free trial week", dek: "Boats, lifejackets and coaches are provided. Sessions start at seven each morning on the old pier.", picture: ["#154360", "#5dade2"] },
  { feed: "wire", topic: "technology", hoursAgo: 11.0, title: "Battery recycler says it can recover nearly all of a pack's metals", dek: "A pilot plant processed a ton of used packs last month. The company wants a second site by the end of next year.", picture: ["#212f3d", "#85929e"] },
  { feed: "sample", topic: "world", hoursAgo: 13.2, title: "Mountain villages reopen as the road repair finishes early", dek: "Crews cleared the last slide on Tuesday. Buses to the high valley resume tomorrow." },
  { feed: "harbor", topic: "local", hoursAgo: 15.5, title: "Library extends evening hours through the exam season", dek: "The main branch will stay open until ten on weeknights. Study rooms can be booked a week ahead.", picture: ["#6e2c00", "#e59866"] },
  { feed: "wire", topic: "business", hoursAgo: 17.0, title: "Regional airline restores two routes it paused last year", dek: "Flights to the coast and the northern hub return in March. Fares will match current levels for the first month." },
  { feed: "kids", topic: "kids", hoursAgo: 2.0, title: "Baby otters learn to swim at the aquarium", dek: "Two pups took their first dips this week. Keepers say they love floating on their backs.", picture: ["#117864", "#a2d9ce"] },
  { feed: "kids", topic: "kids", hoursAgo: 6.0, title: "Students plant a hundred trees around the school field", dek: "Every class picked a spot and a name for their tree. They will measure how tall each one grows.", picture: ["#1e8449", "#abebc6"] },
  { feed: "kids", topic: "kids", hoursAgo: 14.0, title: "A robot helper joins the town library story hour", dek: "It turns the pages and does funny voices. Children voted on the first book it would read.", picture: ["#7d3c98", "#d7bde2"] },
];

// A picture: a soft gradient with a few shapes, written as the two WebP sizes the picture route serves from its cache.
async function writePicture(itemId: string, from: string, to: string, seed: number): Promise<void> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
<rect width="1280" height="720" fill="url(#g)"/><circle cx="${200 + (seed * 137) % 800}" cy="${150 + (seed * 71) % 300}" r="${140 + (seed * 13) % 80}" fill="#fff" fill-opacity="0.18"/>
<circle cx="${1000 - (seed * 97) % 500}" cy="${520 - (seed * 41) % 200}" r="${220 + (seed * 29) % 100}" fill="#000" fill-opacity="0.12"/><rect x="0" y="560" width="1280" height="160" fill="#000" fill-opacity="0.15"/></svg>`;
  const base = sharp(Buffer.from(svg));
  const dir = newsPictureDir();
  mkdirSync(dir, { recursive: true });
  const ref = pictureRefOf(itemId);
  const big = await base.clone().webp({ quality: 80 }).toBuffer();
  const small = await base.clone().resize(480).webp({ quality: 80 }).toBuffer();
  writeFileSync(join(dir, `${ref}-1280.webp`), big);
  writeFileSync(join(dir, `${ref}-480.webp`), small);
  const indexPath = join(dir, "index.json");
  let index: Record<string, unknown> = {};
  try { index = JSON.parse(readFileSync(indexPath, "utf8")) as Record<string, unknown>; } catch { /* first picture */ }
  index[ref] = { bytes: big.byteLength + small.byteLength, lastUsedAt: new Date().toISOString() };
  writeFileSync(`${indexPath}.tmp`, JSON.stringify(index));
  renameSync(`${indexPath}.tmp`, indexPath);
  store!.setImageRef(itemId, ref);
}

const now = Date.now();
let added = 0;
for (const [index, story] of STORIES.entries()) {
  const slug = story.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  const url = `https://${FEEDS[story.feed].host}/news/${slug}`;
  const published = new Date(now - story.hoursAgo * 3_600_000).toISOString();
  const item = {
    id: newNewsItemId(), feed_id: feedId[story.feed]!, url, canonical_url: url, title: story.title, summary: story.dek,
    published_at: published, fetched_at: published, publisher: PUBLISHER[story.feed], lang: "en", band_ok: "child" as const,
    hlc: nextHlc(), provenance: "seed-news-review", topics: [story.topic],
    ...(story.picture ? { image_url: `https://${FEEDS[story.feed].host}/img/${index + 1}.jpg` } : {}),
  };
  const result = store.put(item);
  if (!result.inserted) continue;
  added++;
  if (story.picture) await writePicture(item.id, story.picture[0], story.picture[1], index + 1);
}

// Sage follows two channels: the Technology topic and the Harbor Post source.
const band = speakerAgeBand(owner, new Date());
setFollow(owner.id, band, "topic", "technology", true);
setFollow(owner.id, band, "source", feedId.harbor!, true);
console.log(`seeded News: ${added} new stories (${STORIES.length} total), shelf on, ${ownerName} follows Technology and Harbor Post`);
