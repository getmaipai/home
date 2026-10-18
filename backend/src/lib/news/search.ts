// NEWS-LOOK-02 (news note section 6, Search): the `search` data id and the person's recent searches. A search reads only what the
// shelf's release path already releases to the viewer's band (`releaseShelfItems`, then the same card and child gate Today uses),
// so a teen never meets an adult-only item and a child searches the Kids' lists alone. The query goes to this hub and nowhere
// else, and is never logged. A child's search keeps no recents, shows no Saved group and has no chips.
import type { AgeBand } from "@/lib/ageBand";
import { visibleFeedIds, releaseShelfItem, releaseShelfItems } from "@/lib/shelf/shelfRead";
import { listFeeds } from "@/lib/shelf/feedStore";
import type { ShelfItem } from "@/lib/shelf/shelfStore";
import { shelfEnabled } from "@/lib/shelf/shelfPolicy";
import type { PersonRow } from "@/types";
import { cardEnv, cardOf, type CardEnv, type StoryCard } from "./cards";
import { dayGroupOf, localDayKey } from "./dayParts";
import { blockBase, finishBlocks, viewerOf, type BlocksData, type RowsData } from "./data";
import { listRecents, listSaves } from "./records";
import { topicById, topicOfferedTo, topicsFor } from "./topics";

const CANDIDATES = 500;
const ROWS_MAX = 60;
const CHANNELS_MAX = 6;
const CHIPS_MAX = 6;
const QUERY_MAX = 120;
const WORDS_MAX = 8;
export const SEARCH_ALL = "";
export const SEARCH_SAVED = "__saved";
export const SEARCH_TODAY = "__today";

const queryOf = (body: Record<string, unknown>): string => (typeof body.q === "string" ? body.q.replace(/\s+/g, " ").trim().slice(0, QUERY_MAX) : "");
const wordsOf = (q: string): string[] => [...new Set(q.toLowerCase().split(" ").filter(Boolean))].slice(0, WORDS_MAX);

/** The chip a page sent back: "", "__saved" or "__today" (not for a child), else a topic this band is offered, else All. */
function chipOf(body: Record<string, unknown>, band: AgeBand): string {
  const value = typeof body.topic === "string" ? body.topic.trim() : "";
  if (band !== "child" && (value === SEARCH_SAVED || value === SEARCH_TODAY)) return value;
  return value && topicOfferedTo(value, band) ? value : SEARCH_ALL;
}

/** Every word must appear in the title, dek, publisher or a topic name of the card as this viewer sees it. */
function matches(card: StoryCard, words: string[]): boolean {
  if (words.length === 0) return true;
  const hay = [card.title, card.dek ?? "", card.publisher, ...card.topics.map((id) => topicById(id)?.label ?? "")].join(" ").toLowerCase();
  return words.every((word) => hay.includes(word));
}

const plural = (count: number): string => (count === 1 ? "result" : "results");

function channelsFor(env: CardEnv, band: AgeBand, words: string[]): Array<{ kind: "topic" | "source"; key: string; label: string }> {
  if (words.length === 0) return [];
  const has = (label: string): boolean => words.every((word) => label.toLowerCase().includes(word));
  const out: Array<{ kind: "topic" | "source"; key: string; label: string }> = [];
  for (const topic of topicsFor(band)) if (has(topic.label)) out.push({ kind: "topic", key: topic.id, label: topic.label });
  const visible = new Set(visibleFeedIds(band));
  const seen = new Set<string>();
  for (const feed of listFeeds()) {
    if (!visible.has(feed.id) || seen.has(feed.publisher) || !has(feed.publisher)) continue;
    if (band === "child" && !env.gate.passes(feed.publisher)) continue;
    seen.add(feed.publisher);
    out.push({ kind: "source", key: feed.id, label: feed.publisher });
  }
  return out.slice(0, CHANNELS_MAX);
}

/** `search {q, topic}`: one `story_feed` block in the rows layout, or no block at all when there is nothing to show. */
export function searchData(person: PersonRow, body: Record<string, unknown>, now = new Date()): BlocksData {
  const viewer = viewerOf(person, now);
  const band = viewer.band;
  const q = queryOf(body);
  const chip = chipOf(body, band);
  const empty = (blocks: unknown[] = []): BlocksData => ({ as_of: now.toISOString(), blocks });
  if (!shelfEnabled()) return empty();
  const env = cardEnv(viewer);
  if (!env) return { ...empty(), degraded: true };
  if (!q && chip === SEARCH_ALL) {
    // A child's page opens on "Find a story" (the page document is one for every band, so the hub supplies this heading).
    return band === "child" ? empty(finishBlocks(person, band, [feedOf("Find a story", [], [], null, now)])) : empty();
  }
  const words = wordsOf(q);
  const cards = new Map<string, StoryCard>();
  const add = (item: ShelfItem | null | undefined): void => {
    if (!item || cards.has(item.id)) return;
    const card = cardOf(item, env);
    if (card) cards.set(item.id, card);
  };
  for (const item of releaseShelfItems(band, CANDIDATES, env.store)) add(item);
  const saves = band === "child" ? [] : listSaves(person.id);
  // A saved story older than the candidate window is still searchable, through the same release gate.
  for (const save of saves) add(releaseShelfItem(band, save.item_id, env.store));
  const textHits = [...cards.values()].filter((card) => matches(card, words));
  const today = localDayKey(now);
  const chosen = textHits.filter((card) => {
    if (chip === SEARCH_SAVED) return card.saved;
    if (chip === SEARCH_TODAY) return localDayKey(new Date(card.published_at)) === today;
    return chip === SEARCH_ALL || card.topics.includes(chip);
  });
  const savedIds = new Set(saves.map((save) => save.item_id));
  const savedRows = band === "child" ? [] : saves.map((save) => chosen.find((card) => card.item_id === save.item_id)).filter((card): card is StoryCard => card !== undefined);
  const rest = chosen.filter((card) => !(band !== "child" && savedIds.has(card.item_id))).sort((a, b) => b.published_at.localeCompare(a.published_at));
  const rows = [
    ...savedRows.map((card) => ({ ...withTopic(card), group: "Saved" })),
    ...rest.map((card) => ({ ...withTopic(card), group: dayGroupOf(new Date(card.published_at), now) })),
  ].slice(0, ROWS_MAX);
  const channels = chip === SEARCH_ALL ? channelsFor(env, band, words) : [];
  const count = rows.length + channels.length;
  // Chips: Saved only and Today, then the topics that the text matches have stories in (before the chip narrows the list).
  const present = new Set(textHits.flatMap((card) => card.topics));
  const chips = band === "child" ? null : [
    { id: SEARCH_ALL, label: "All", selected: chip === SEARCH_ALL },
    { id: SEARCH_SAVED, label: "Saved only", selected: chip === SEARCH_SAVED },
    { id: SEARCH_TODAY, label: "Today", selected: chip === SEARCH_TODAY },
    ...topicsFor(band).filter((topic) => present.has(topic.id)).slice(0, CHIPS_MAX).map((topic) => ({ id: topic.id, label: topic.label, selected: chip === topic.id })),
  ];
  // Nothing found and no chip chosen: no block, so the page's own empty state speaks. With a chip chosen the block stays so the chips can be changed back.
  if (count === 0 && chip === SEARCH_ALL) return empty();
  const title = `${count} ${plural(count)}${q ? ` for “${q}”` : ""}`;
  return empty(finishBlocks(person, band, [feedOf(title, rows, channels, chips, now)]));
}

const withTopic = (card: StoryCard): StoryCard => {
  const label = card.topics[0] ? topicById(card.topics[0])?.label : undefined;
  return label ? { ...card, kicker: label } : card;
};

function feedOf(title: string, rows: unknown[], channels: Array<{ kind: "topic" | "source"; key: string; label: string }>, filters: unknown[] | null, now: Date): unknown {
  return {
    ...blockBase("story_feed", `${title}.`, "news data search"),
    props: {
      layout: "rows",
      header: { title },
      ...(filters ? { filters } : {}),
      featured: [],
      shelves: channels.length > 0 ? [{ title: "Topics and sources", channels, stories: [] }] : [],
      rows, as_of: now.toISOString(),
    },
  };
}

/** `search-recents`: the person's last five searches, newest first, as the `{key, label}` rows the search field draws. A child has none. */
export function recentRows(person: PersonRow, now = new Date()): RowsData {
  if (person.role === "guest" || viewerOf(person, now).band === "child") return [];
  return listRecents(person.id).map((recent) => ({ key: recent.id, label: recent.q }));
}
