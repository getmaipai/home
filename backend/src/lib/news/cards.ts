// NEWS-02: a shelf item as the `news_story_card` the answer blocks draw (spec/schemas/answer-block.schema.json).
// Every string a child sees passes the child gate here (a headline or source line that fails drops the card); a picture is a
// same-origin hub path, never the publisher's address; `open_url` is absent for a child. Before KS-06 (stories) every item is
// its own story with one outlet; the story id is derived from the item id so a saved or read record has the spec's shape.
import type { AgeBand } from "@/lib/ageBand";
import { listFeeds } from "@/lib/shelf/feedStore";
import { releaseShelfItem, visibleFeedIds } from "@/lib/shelf/shelfRead";
import { sharedShelfStore, type ShelfItem, type ShelfStore } from "@/lib/shelf/shelfStore";
import { openedItemIds, savedItemIds } from "./records";
import { gateFor, type Gate } from "./childGate";
import { newsImagesOn } from "./pictures";
import { enrichItem, enrichmentFresh } from "./enrich";
import { topicOfferedTo } from "./topics";

export interface StoryCard {
  story_id: string;
  item_id: string;
  title: string;
  dek?: string;
  publisher: string;
  site: string;
  published_at: string;
  outlets: number;
  topics: string[];
  image?: { w480: string; w1280: string; alt: string };
  saved: boolean;
  opened: boolean;
  open_url?: string;
  /** The hub-built line above the headline (data.ts `withKicker`). */
  kicker?: string;
  /** The day heading of a row (data.ts, `dayGroupOf`). */
  group?: string;
}

export interface Viewer { personId: string | null; band: AgeBand }

/** `story-xxxx` for `news-xxxx` (the spec's id shape) until stories exist; a story id from KS-06 would be stored on the item. */
export function storyIdOf(item: ShelfItem): string {
  return item.story_id ?? `story-${item.id.replace(/^news-/, "")}`;
}

/** The item id behind an id a client sent: a `news-` id as is, a derived `story-` id mapped back, anything else null. */
export function itemIdFrom(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  if (/^news-[a-z0-9]{6,}$/.test(id)) return id;
  const story = /^story-([a-z0-9]{6,})$/.exec(id);
  return story ? `news-${story[1]}` : null;
}

export function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

/** When the story was published, never later than when this hub fetched it (and never in the future): a feed that dates an item ahead
 * cannot put it at the top of Today or keep it inside every time window. */
export function publishedAtOf(item: ShelfItem, nowMs = Date.now()): string {
  const fetched = Date.parse(item.fetched_at);
  const at = Date.parse(item.published_at ?? item.fetched_at);
  const claimed = Number.isNaN(at) ? fetched : at;
  return new Date(Math.min(claimed, Number.isNaN(fetched) ? claimed : fetched, nowMs)).toISOString();
}

export interface CardEnv {
  viewer: Viewer;
  gate: Gate;
  store: ShelfStore;
  imagesOn: boolean;
  saved: Set<string>;
  opened: Set<string>;
  /** Feeds this viewer's band is shown, by id. */
  visibleFeeds: Set<string>;
  publishers: Map<string, string>;
}

export function cardEnv(viewer: Viewer, store: ShelfStore | null = sharedShelfStore()): CardEnv | null {
  if (!store) return null;
  const visible = new Set(visibleFeedIds(viewer.band));
  return {
    viewer, gate: gateFor(viewer.band), store, imagesOn: newsImagesOn(),
    saved: viewer.personId ? savedItemIds(viewer.personId) : new Set(), opened: viewer.personId ? openedItemIds(viewer.personId) : new Set(),
    visibleFeeds: visible, publishers: new Map(listFeeds().map((feed) => [feed.id, feed.publisher])),
  };
}

/** The publisher to show: the item's own feed when this band is shown that feed, else the first carrying feed it is shown. */
export function publisherOf(item: ShelfItem, env: CardEnv): string | null {
  if (env.visibleFeeds.has(item.feed_id)) return item.publisher;
  for (const feedId of env.store.feedIdsOf(item.canonical_url)) {
    if (env.visibleFeeds.has(feedId)) return env.publishers.get(feedId) ?? item.publisher;
  }
  return null;
}

export function pictureAlt(title: string, publisher: string): string {
  return `${title}, ${publisher}`.slice(0, 300);
}

export function imageOf(item: ShelfItem, title: string, publisher: string, env: CardEnv): StoryCard["image"] | undefined {
  if (!env.imagesOn || (!item.image_url && env.store.getEnrichment(item.id, env.viewer.band)?.status === "none")) return undefined;
  return { w480: `/api/plugins/news/images/${item.id}?w=480`, w1280: `/api/plugins/news/images/${item.id}?w=1280`, alt: pictureAlt(title, publisher) };
}

const DEK_MAX = 220;
function clampDek(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= DEK_MAX) return flat;
  const cut = flat.slice(0, DEK_MAX - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 80)).trimEnd()}…`;
}

export function topicsShown(item: ShelfItem, band: AgeBand): string[] {
  return (item.topics ?? []).filter((id) => topicOfferedTo(id, band));
}

/** One card, or null when the item is not shown to this viewer (no visible feed, or a child's headline or source line failed the gate). */
export function cardOf(item: ShelfItem, env: CardEnv): StoryCard | null {
  const { band } = env.viewer;
  const publisher = publisherOf(item, env);
  if (!publisher) return null;
  const title = band === "child" ? env.gate.text(item.title) : item.title;
  if (!title || (band === "child" && !env.gate.passes(publisher))) return null;
  const description = item.summary.trim() || env.store.getEnrichment(item.id, band)?.description || "";
  const dekText = band === "child" ? env.gate.text(description) : description;
  const dek = dekText ? clampDek(dekText) : "";
  const image = imageOf(item, title, publisher, env);
  return {
    story_id: storyIdOf(item), item_id: item.id, title, ...(dek ? { dek } : {}), publisher, site: hostOf(item.canonical_url) || publisher,
    published_at: publishedAtOf(item), outlets: 1, topics: topicsShown(item, band), ...(image ? { image } : {}),
    saved: env.saved.has(item.id), opened: env.opened.has(item.id),
    ...(band !== "child" ? { open_url: item.url } : {}),
  };
}

/** The item for an id a client sent, if this viewer's band is released it. */
export function releasedItem(viewer: Viewer, idValue: unknown, store: ShelfStore | null = sharedShelfStore()): ShelfItem | null {
  const id = itemIdFrom(idValue);
  return id ? releaseShelfItem(viewer.band, id, store) : null;
}

/** Only the existing hero/featured slots, never rows or shelf tiles. Late work may populate the next request's cache. */
export async function enrichLeadCards(raw: unknown[], env: CardEnv): Promise<void> {
  type Feed = { props: { hero?: StoryCard; featured?: StoryCard[] } };
  const feeds = raw.filter((block): block is Feed => !!block && typeof block === "object" && "props" in block);
  const leads = feeds.flatMap(({ props }) => [props.hero, ...(props.featured ?? []).slice(0, 4)])
    .filter((card): card is StoryCard => !!card);
  const selected = [...new Map(leads.map((card) => [card.item_id, card])).values()].slice(0, 5);
  const deadlineAt = Date.now() + 2500;
  let index = 0;
  const worker = async (): Promise<void> => {
    while (index < selected.length && Date.now() < deadlineAt) {
      const card = selected[index++]!;
      const item = releaseShelfItem(env.viewer.band, card.item_id, env.store);
      if (!item) continue;
      const stored = env.store.getEnrichment(item.id, env.viewer.band);
      if (!card.dek || (env.imagesOn && !item.image_url && !enrichmentFresh(stored))) {
        await enrichItem(item, env.viewer.band, { store: env.store, deadlineAt });
      }
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.all([worker(), worker()]),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, Math.max(0, deadlineAt - Date.now())); }),
    ]);
  } catch { /* enrichment never fails a response */ }
  finally { clearTimeout(timer); }
  // Rebuild only these slots from what finished in budget. Do not let a late worker mutate a released response.
  const refresh = (card: StoryCard): StoryCard => {
    const item = releaseShelfItem(env.viewer.band, card.item_id, env.store);
    const updated = item ? cardOf(item, env) : null;
    return updated ? { ...updated, ...(card.kicker ? { kicker: card.kicker } : {}) } : card;
  };
  for (const feed of feeds) {
    if (feed.props.hero) feed.props.hero = refresh(feed.props.hero);
    if (feed.props.featured) feed.props.featured = feed.props.featured.map(refresh);
  }
}
