// NEWS-02 (news note section 17): the data behind `POST /api/plugins/news/data/<id>`. The block-returning ids (`today`, `mix`,
// `channel`, `story`, `household-today`) give the app-kind `{as_of, blocks, degraded?}` with one `story_feed` or `article`
// block; `topics`, `sources` and `saved` give the bare row array the `list` node binds. Everything here starts from the shelf's
// release path (`releaseShelfItems` / `releaseShelfItem`), so a viewer is only ever shown what their lists and band release.
// The routes (routes/newsRoutes.ts) check the role gate and the owning page's floor first; the block filter runs last, in
// `finishBlocks`.
import { getPersonSettingValue } from "@/lib/settings";
import type { MixSignal } from "./rankStories";
import { isNull } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { speakerAgeBand, type AgeBand } from "@/lib/ageBand";
import { filterAnswerBlocks } from "@/lib/answerBlocks";
import { nextHlc } from "@/lib/hlc";
import { randomSuffix } from "@/lib/id";
import { loadManifestOnly } from "@/lib/plugins";
import { listFeeds } from "@/lib/shelf/feedStore";
import { feedIsOfferedTo, releaseShelfItem, releaseShelfItems, visibleFeedIds } from "@/lib/shelf/shelfRead";
import { sharedShelfStore, type ShelfItem } from "@/lib/shelf/shelfStore";
import { FEED_LISTS, shelfEnabled } from "@/lib/shelf/shelfPolicy";
import type { PersonRow } from "@/types";
import { articleBlock } from "./article";
import { cardEnv, cardOf, enrichLeadCards, hostOf, itemIdFrom, pictureAlt, publishedAtOf, storyIdOf, type CardEnv, type StoryCard, type Viewer } from "./cards";
import { rankStories, type RankInput } from "./rankStories";
import { followedChannels, isFollowing, listSaves, recomputeMix, recordRead } from "./records";
import { TOPICS, topicById, topicOfferedTo, topicsFor } from "./topics";
import { bumpNewsCounter } from "./newsCounters";
import { feedLabels } from "./feedLabels";
import { datelineOf, dayGroupOf } from "./dayParts";

export interface BlocksData { as_of: string; blocks: unknown[]; degraded?: true }
export type RowsData = Array<Record<string, unknown>>;

const HOUR_MS = 3_600_000;
const TODAY_WINDOW_H = 48;
const ROWS_WINDOW_H = 24;
const CHANNEL_WINDOW_H = 24 * 7;
const CANDIDATES = 500;
const ROWS_PAGE = 20;
const ROWS_MAX = 60;
const SHELF_MAX = 8;
const FILTERS_MAX = 9;

export function viewerOf(person: PersonRow, now = new Date()): Viewer {
  return { personId: person.id, band: speakerAgeBand(person, now) };
}

/** The blocks a viewer may be shown: the manifest allowlist, the block schema, the band and the output floor. */
export function finishBlocks(person: Pick<PersonRow, "displayName">, band: AgeBand, raw: unknown[]): unknown[] {
  const loaded = loadManifestOnly("news");
  // No actor: publisher text is not the person's activity, so the filter never tells a parent about it.
  return filterAnswerBlocks(raw, "news", loaded.ok ? loaded.value.returns_blocks ?? [] : [], band, null);
}

export const blockBase = (kind: string, alt: string, provenance: string) => ({
  id: `blk-${randomSuffix(10)}`, kind, schema_version: 1, producer: "news", alt: alt.slice(0, 300), provenance, created_at: new Date().toISOString(), hlc: nextHlc(),
});

// ---- Ranked feeds ----------------------------------------------------------------------------

interface FeedRequest {
  signal?: MixSignal;
  layout: "today" | "channel" | "rows";
  title: string;
  subtitle?: string;
  channel?: { kind: "topic" | "source"; key: string; followed: boolean };
  /** NEWS-SECTION-STYLES-01: a topic channel's arrangement, the topic's own `section_style` from spec/news/topics.json. */
  sectionStyle?: "top_stories" | "special" | "todays_news";
  windowH: number;
  match?: (item: ShelfItem) => boolean;
  /** The chosen topic chip (a topic id, or "" for All). The caller has already checked it against the band. */
  topic?: string;
  /** Whether the block carries the topic chip row (Today and My Mix, never a child's, never a channel). */
  filters?: boolean;
  /** Channel pages may show rows from the full channel window; Today keeps its shorter row window even for a selected chip. */
  channelRows?: boolean;
  followed: { topics: Set<string>; sources: Set<string> };
  shelf: boolean;
  page: number;
  provenance: string;
}

const ageMs = (item: ShelfItem, now: Date): number => now.getTime() - Date.parse(publishedAtOf(item));

function rankInputOf(item: ShelfItem, card: StoryCard): RankInput {
  return {
    story_id: card.story_id, item_id: item.id, title: card.title, publisher: card.publisher, topics: card.topics,
    published_at: card.published_at, publisher_count: card.outlets, has_image: card.image !== undefined, feed_id: item.feed_id,
  };
}

/** The topic chip a page sent back: a topic id this band is offered, else "" (All). Never an error, never a topic the band is not shown. */
export function topicParam(body: Record<string, unknown>, band: AgeBand): string {
  const value = typeof body.topic === "string" ? body.topic.trim() : "";
  return value && topicOfferedTo(value, band) ? value : "";
}

/** The line above a headline. A child is shown the topic name only: never "Top story", an outlet count, a time or a publisher address. */
export function withKicker(card: StoryCard, band: AgeBand, hero = false): StoryCard {
  const topic = card.topics[0] ? topicById(card.topics[0])?.label : undefined;
  const kicker = band === "child" ? topic : hero && card.outlets >= 2 ? `Top story · ${card.outlets} outlets` : topic ?? card.publisher;
  return kicker ? { ...card, kicker: kicker.slice(0, 80) } : card;
}

function feedBlock(env: CardEnv, request: FeedRequest, now: Date): unknown[] {
  const band = env.viewer.band;
  const items = releaseShelfItems(band, CANDIDATES, env.store)
    .filter((item) => ageMs(item, now) <= request.windowH * HOUR_MS && (!request.match || request.match(item)));
  const cards = new Map<string, StoryCard>();
  const byItem = new Map<string, ShelfItem>();
  for (const item of items) {
    const card = cardOf(item, env);
    if (card) { cards.set(item.id, card); byItem.set(item.id, item); }
  }
  // The chips list the topics that have stories in this window (before the chosen chip narrows it), in the topic file's order.
  const topic = request.topic ?? "";
  const present = new Set([...cards.values()].flatMap((card) => card.topics));
  const filters = request.filters && band !== "child"
    ? [{ id: "", label: "All", selected: topic === "" }, ...topicsFor(band).filter((entry) => present.has(entry.id) || entry.id === topic).slice(0, FILTERS_MAX).map((entry) => ({ id: entry.id, label: entry.label, selected: topic === entry.id }))]
    : undefined;
  if (topic) for (const [id, card] of cards) if (!card.topics.includes(topic)) cards.delete(id);
  const ranked = cards.size === 0 ? { hero: undefined, featured: [], rest: [] } : rankStories({ stories: [...cards.values()].map((card) => rankInputOf(byItem.get(card.item_id)!, card)), now, followed: request.followed, mode: request.signal ? "mix" : "today", signal: request.signal });
  const cardFor = (input: RankInput): StoryCard => cards.get(input.item_id)!;
  const hero = ranked.hero ? withKicker(cardFor(ranked.hero), band, true) : undefined;
  const featured = ranked.featured.map(cardFor).map((card) => withKicker(card, band));
  const shown = new Set([hero?.item_id, ...featured.map((card) => card.item_id)]);
  const recent = ranked.rest.map(cardFor).filter((card) => now.getTime() - Date.parse(card.published_at) <= ROWS_WINDOW_H * HOUR_MS || request.channelRows);
  recent.sort((a, b) => b.published_at.localeCompare(a.published_at));
  const rows = recent.slice(0, Math.min(ROWS_MAX, ROWS_PAGE * Math.max(1, request.page)))
    .map((card) => ({ ...withKicker(card, band), group: dayGroupOf(new Date(card.published_at), now) }));
  const shelves = request.shelf && !topic ? channelShelf(env, request.followed, shown, now) : [];
  const total = (hero ? 1 : 0) + featured.length + rows.length + shelves.reduce((sum, shelf) => sum + shelf.stories.length, 0);
  const lead = hero ?? featured[0] ?? rows[0] ?? shelves[0]?.stories[0];
  const alt = `${request.title}: ${lead ? `${lead.title}, ${lead.publisher}` : "no stories"}${total > 1 ? `, and ${total - 1} more ${total - 1 === 1 ? "story" : "stories"}` : ""}.`;
  return [{
    ...blockBase("story_feed", alt, request.provenance),
    props: {
      layout: request.layout,
      ...(request.layout === "channel" && request.sectionStyle ? { section_style: request.sectionStyle } : {}),
      header: { title: request.title, ...(request.subtitle ? { subtitle: request.subtitle } : {}), dateline: datelineOf(now), ...(request.channel ? { channel: request.channel } : {}) },
      ...(filters ? { filters } : {}),
      ...(hero ? { hero } : {}), featured, shelves, rows, as_of: now.toISOString(),
    },
  }];
}

/** "From your channels": the newest story from each channel the person follows that the main grid does not already show. */
function channelShelf(env: CardEnv, followed: { topics: Set<string>; sources: Set<string> }, shown: Set<string | undefined>, now: Date): Array<{ title: string; channels: Array<{ kind: "topic" | "source"; key: string; label: string }>; stories: StoryCard[] }> {
  const channels: Array<{ kind: "topic" | "source"; key: string; label: string }> = [];
  for (const id of [...followed.topics].sort()) { const topic = topicById(id); if (topic && topicOfferedTo(id, env.viewer.band)) channels.push({ kind: "topic", key: id, label: topic.label }); }
  const labels = feedLabels();
  for (const id of [...followed.sources].sort()) { const label = labels.get(id); if (label && env.visibleFeeds.has(id)) channels.push({ kind: "source", key: id, label }); }
  if (channels.length === 0) return [];
  const items = releaseShelfItems(env.viewer.band, CANDIDATES, env.store).filter((item) => ageMs(item, now) <= TODAY_WINDOW_H * HOUR_MS);
  const stories: StoryCard[] = [];
  const used = new Set(shown);
  for (const channel of channels.slice(0, SHELF_MAX)) {
    const match = items.find((item) => !used.has(item.id) && (channel.kind === "topic" ? (item.topics ?? []).includes(channel.key) : item.feed_id === channel.key));
    const card = match ? cardOf(match, env) : null;
    if (card) { stories.push(card); used.add(card.item_id); }
  }
  return stories.length > 0 ? [{ title: "From your channels", channels: channels.slice(0, 6), stories: stories.slice(0, 12).map((card) => withKicker(card, env.viewer.band)) }] : [];
}

const pageOf = (body: Record<string, unknown>): number => {
  const page = Number(body.page);
  return Number.isFinite(page) ? Math.min(3, Math.max(1, Math.floor(page))) : 1;
};

function emptyBlocks(degraded: boolean): BlocksData {
  return { as_of: new Date().toISOString(), blocks: [], ...(degraded ? { degraded: true as const } : {}) };
}

/** `today`: the person's Today. A child's holds the Kids' lists only (the shelf's release path), follows of kid channels, nothing inferred. */
export async function todayData(person: PersonRow, body: Record<string, unknown>, now = new Date()): Promise<BlocksData> {
  if (!shelfEnabled()) return emptyBlocks(false);
  const viewer = viewerOf(person, now);
  const env = cardEnv(viewer);
  if (!env) return emptyBlocks(true);
  const followed = followedChannels(person.id);
  const topic = topicParam(body, viewer.band);
  const selectedTopic = topic ? topicById(topic) : undefined;
  const raw = feedBlock(env, {
    layout: selectedTopic ? "channel" : "today", title: selectedTopic?.label ?? "Today",
    ...(selectedTopic ? { sectionStyle: selectedTopic.section_style, channel: { kind: "topic" as const, key: topic, followed: isFollowing(person.id, "topic", topic) } } : {}),
    windowH: TODAY_WINDOW_H, followed, shelf: true, page: pageOf(body), topic, filters: true, provenance: "news data today",
  }, now);
  await enrichLeadCards(raw, env);
  return { as_of: now.toISOString(), blocks: finishBlocks(person, viewer.band, raw) };
}

/** My Mix uses only this person's reading and follows. A child, guest or opted-out person never gets it. */
export async function mixData(person: PersonRow, body: Record<string, unknown>, now = new Date()): Promise<BlocksData | null> {
  const viewer = viewerOf(person, now);
  if (person.role === "guest" || viewer.band === "child" || getPersonSettingValue(person, "news.my_mix") === false) return null;
  if (!shelfEnabled()) return emptyBlocks(false);
  const env = cardEnv(viewer);
  if (!env) return emptyBlocks(true);
  const raw = feedBlock(env, { layout: "today", title: "My Mix", signal: recomputeMix(person.id, now), windowH: TODAY_WINDOW_H, followed: followedChannels(person.id), shelf: true, page: pageOf(body), topic: topicParam(body, viewer.band), filters: true, provenance: "news data mix" }, now);
  await enrichLeadCards(raw, env);
  return { as_of: now.toISOString(), blocks: finishBlocks(person, viewer.band, raw) };
}

/** `channel {kind, key}`: one topic or one source, in the `channel` layout. Null when the channel does not exist for this band. */
export async function channelData(person: PersonRow, body: Record<string, unknown>, now = new Date()): Promise<BlocksData | null> {
  const viewer = viewerOf(person, now);
  const kind = body.kind === "topic" || body.kind === "source" ? body.kind : null;
  const key = typeof body.key === "string" ? body.key : "";
  if (!kind || !key) return null;
  // Whether the channel exists for this band is settled first, from the topic set and the lists alone, so the answer
  // (a 404 or a page) does not depend on the shelf switch.
  if (kind === "topic" ? !topicOfferedTo(key, viewer.band) : !feedIsOfferedTo(viewer.band, key)) return null;
  if (!shelfEnabled()) return emptyBlocks(false);
  const env = cardEnv(viewer);
  if (!env) return emptyBlocks(true);
  let title: string;
  let subtitle: string | undefined;
  let match: (item: ShelfItem) => boolean;
  let sectionStyle: FeedRequest["sectionStyle"];
  if (kind === "topic") {
    const topic = topicById(key);
    if (!topic || !topicOfferedTo(key, viewer.band)) return null;
    title = topic.label;
    sectionStyle = topic.section_style;
    const sources = new Set(releaseShelfItems(viewer.band, CANDIDATES, env.store).filter((item) => (item.topics ?? []).includes(key)).map((item) => item.publisher));
    subtitle = sources.size > 0 ? `${sources.size} ${sources.size === 1 ? "source" : "sources"}` : undefined;
    match = (item) => (item.topics ?? []).includes(key);
  } else {
    const feed = listFeeds().find((candidate) => candidate.id === key);
    if (!feed || !env.visibleFeeds.has(key)) return null;
    title = feed.publisher;
    // A teen or an adult is shown where the feed lives; a child is shown the name only.
    subtitle = viewer.band === "child" ? undefined : `${feed.publisher} · ${hostOf(feed.url) || feed.title}`;
    match = (item) => item.feed_id === key || env.store.feedIdsOf(item.canonical_url).includes(key);
  }
  const followed = followedChannels(person.id);
  const raw = feedBlock(env, {
    layout: "channel", title, ...(subtitle ? { subtitle } : {}), ...(sectionStyle ? { sectionStyle } : {}), channel: { kind, key, followed: isFollowing(person.id, kind, key) },
    windowH: CHANNEL_WINDOW_H, match, followed, shelf: false, channelRows: true, page: pageOf(body), topic: topicParam(body, viewer.band), provenance: "news data channel",
  }, now);
  await enrichLeadCards(raw, env);
  return { as_of: now.toISOString(), blocks: finishBlocks(person, viewer.band, raw) };
}

/** The band a shared screen is shown at, or null when a child lives here (then it shows nothing). */
export function householdBand(now = new Date()): AgeBand | null {
  // A disabled profile still counts: it is a child (or teen) who lives here and may be turned back on. Only a deleted one does not.
  const rows = db.select().from(people).where(isNull(people.deletedAt)).all().filter((row) => row.role !== "guest");
  const bands = rows.map((row) => speakerAgeBand(row, now));
  if (bands.includes("child")) return null;
  return bands.includes("teen") ? "teen" : "adult";
}

/** `household-today`: Today for a shared screen. Takes no person: no follows, no saves, no reads, no affinity, no outbound link; the household's band
 * (adult, or teen when a teen profile exists); nothing at all in a household with a child profile (decision 1b is still open). */
export function householdTodayData(requester: Pick<PersonRow, "displayName">, now = new Date()): BlocksData {
  const band = householdBand(now);
  if (band === null || !shelfEnabled()) return emptyBlocks(false);
  const env = cardEnv({ personId: null, band });
  if (!env) return emptyBlocks(true);
  const raw = feedBlock(env, { layout: "today", title: "Today", windowH: TODAY_WINDOW_H, followed: { topics: new Set(), sources: new Set() }, shelf: false, page: 1, provenance: "news data household-today" }, now);
  // The shared screen is not a place to open an outbound link from.
  const stripped = raw.map((block) => stripOpenUrls(block));
  return { as_of: now.toISOString(), blocks: finishBlocks(requester, band, stripped) };
}

function stripOpenUrls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripOpenUrls);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => key !== "open_url").map(([key, child]) => [key, stripOpenUrls(child)]));
  }
  return value;
}

/** `story {id}`: the article block for one released item, opening it for this person (the NewsRead row an open writes). Null when the id is not one this viewer is released. */
export async function storyData(person: PersonRow, body: Record<string, unknown>, now = new Date()): Promise<BlocksData | null> {
  const viewer = viewerOf(person, now);
  const id = itemIdFrom(body.id ?? body.item_id ?? body.story_id);
  if (!id) return null;
  const item = releaseShelfItem(viewer.band, id);
  if (!item) return null;
  const env = cardEnv(viewer);
  if (!env) return emptyBlocks(true);
  const block = await articleBlock(item, env, { retry: body.retry === true });
  if (block) {
    bumpNewsCounter("story_opened");
    recordRead(person.id, { itemId: item.id, storyId: storyIdOf(item) }, now.toISOString());
  }
  return { as_of: now.toISOString(), blocks: block ? finishBlocks(person, viewer.band, [block]) : [] };
}

// ---- List rows (the bare array the `list` node binds) -------------------------------------------

/** "1 story today" and "3 stories today": the Following rows say the count in the right number (verification pass: "1 stories today"). */
export function storiesTodayLabel(count: number): string {
  return count === 1 ? "1 story today" : `${count} stories today`;
}

/** `topics`: the topics offered to this band, with today's story count and whether the person follows each. */
export function topicRows(person: PersonRow, now = new Date()): RowsData {
  const viewer = viewerOf(person, now);
  const store = sharedShelfStore();
  const items = store && shelfEnabled() ? releaseShelfItems(viewer.band, CANDIDATES, store).filter((item) => ageMs(item, now) <= ROWS_WINDOW_H * HOUR_MS) : [];
  const followed = followedChannels(person.id).topics;
  return topicsFor(viewer.band).map((topic) => {
    const count = items.filter((item) => (item.topics ?? []).includes(topic.id)).length;
    return { key: topic.id, id: topic.id, label: topic.label, icon: topic.icon, count, count_label: storiesTodayLabel(count), followed: followed.has(topic.id) };
  });
}

/** `sources`: the feeds this band is shown, grouped by list, with the person's follow. A child's rows carry the list name, never an address. */
export function sourceRows(person: PersonRow, now = new Date()): RowsData {
  const viewer = viewerOf(person, now);
  const visible = new Set(visibleFeedIds(viewer.band));
  const store = sharedShelfStore();
  const items = store && shelfEnabled() ? releaseShelfItems(viewer.band, CANDIDATES, store).filter((item) => ageMs(item, now) <= ROWS_WINDOW_H * HOUR_MS) : [];
  const followed = followedChannels(person.id).sources;
  return listFeeds().filter((feed) => visible.has(feed.id)).map((feed) => {
    const list = FEED_LISTS.find((candidate) => candidate.package_id === feed.package_id);
    const group = list?.label ?? "Added by your home";
    return {
      key: feed.id, id: feed.id, label: feed.publisher, icon: "newspaper", group, site: viewer.band === "child" ? group : hostOf(feed.url) || group,
      count: items.filter((item) => item.feed_id === feed.id).length, followed: followed.has(feed.id),
    };
  }).sort((a, b) => String(a.group).localeCompare(String(b.group)) || String(a.label).localeCompare(String(b.label)));
}

/** `saved`: the person's saves, newest first, that this band is still released. */
export function savedRows(person: PersonRow, now = new Date()): RowsData {
  const viewer = viewerOf(person, now);
  const env = cardEnv(viewer);
  const rows: RowsData = [];
  for (const save of listSaves(person.id)) {
    const item = releaseShelfItem(viewer.band, save.item_id);
    const card = item && env ? cardOf(item, env) : null;
    if (!card) continue;
    rows.push({
      key: save.item_id, id: save.item_id, item_id: save.item_id, story_id: save.story_id, label: card.title, publisher: card.publisher, site: card.site,
      saved_at: save.saved_at, published_at: card.published_at, offline: save.offline, icon: "bookmark", ...(card.image ? { image: card.image.w480, image_alt: pictureAlt(card.title, card.publisher) } : {}),
    });
  }
  return rows;
}

/** NEWS-07: only explicit follows and the Today lead set, through the same card and source gates as Today. */
export function fullTextCandidates(person: PersonRow, now = new Date()): ShelfItem[] {
  if (person.role === "guest" || !person.enabled || person.deletedAt || person.memorializedAt || !shelfEnabled()) return [];
  const env = cardEnv(viewerOf(person, now));
  if (!env) return [];
  const followed = followedChannels(person.id);
  const items = releaseShelfItems(env.viewer.band, CANDIDATES, env.store)
    .filter((item) => ageMs(item, now) <= TODAY_WINDOW_H * HOUR_MS);
  const inputs = items.flatMap((item) => {
    const card = cardOf(item, env);
    return card ? [rankInputOf(item, card)] : [];
  });
  const ranked = rankStories({ stories: inputs, now, followed, mode: "today" });
  const chosen = new Set([ranked.hero?.item_id, ...ranked.featured.map((story) => story.item_id)]);
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const story of inputs) {
    if (story.topics.some((topic) => followed.topics.has(topic)) || env.store.feedIdsOf(byId.get(story.item_id)!.canonical_url).some((id) => followed.sources.has(id))) chosen.add(story.item_id);
  }
  return items.filter((item) => chosen.has(item.id));
}
