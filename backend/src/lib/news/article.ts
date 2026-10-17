// NEWS-02 (news note sections 8 step 3, 10, 11): opening a story. The one reader turns the item's page into the `ArticleBlock`
// list: one fetch of the item's own address through the shared page guards (the band's blocked sites, the fetch cache with its 24
// hour news time-to-live, robots.txt, the per-host pace, the SSRF guard, the Archive copy for a gone page), then
// `extractFullArticle` in its news mode (outbound links kept for a teen or an adult, none for a child; no figures: pictures come
// through the picture route only). A page whose text is not an article (under 400 characters, the quality rule) or that
// cannot be fetched shows the feed's own summary as a teaser. A failure is remembered 30 minutes; "Try again" bypasses.
// A child's text passes the minor floor and then the child gate sentence by sentence, into both `blocks` and `speech[]`.
import { randomSuffix } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { pageHtml } from "@/lib/packageHost";
import { tripsMinorFloor } from "@/lib/retrieval/minorFloor";
import { extractFullArticle, type ArticleBlock } from "@/lib/retrieval/extractArticle";
import { sharedShelfStore, type ContentVariant, type ShelfItem, type ShelfStore, type StoredContent } from "@/lib/shelf/shelfStore";
import { acceptArticleText, createFailureMemory } from "./contentQuality";
import { gateBlocks, inlineText, speechFor } from "./childGate";
import { hostOf, imageOf, publishedAtOf, publisherOf, storyIdOf, topicsShown, type CardEnv } from "./cards";
import { bumpNewsCounter } from "./newsCounters";
import { topicById } from "./topics";

const NEWS_TTL_MS = 24 * 60 * 60 * 1000;
// "Failures remembered 30 minutes" is contentQuality's rule (NEWS-02b); the memory is keyed by the item's address.
let failures = createFailureMemory();
export function __resetNewsArticleForTests(): void { failures = createFailureMemory(); }

export type ContentSource = StoredContent["source"];

function variantOf(band: "child" | "teen" | "adult"): ContentVariant {
  return band === "child" ? "plain" : "open";
}

function textOfBlocks(blocks: readonly ArticleBlock[]): string {
  return blocks.map((block) => {
    switch (block.type) {
      case "paragraph":
      case "quote": return inlineText(block.inlines);
      case "list": return block.items.map(inlineText).join(" ");
      case "heading":
      case "note": return block.type === "heading" ? "" : block.text;
      default: return "";
    }
  }).filter(Boolean).join("\n");
}

export function readingSeconds(blocks: readonly ArticleBlock[]): number {
  const words = textOfBlocks(blocks).split(/\s+/).filter(Boolean).length;
  return Math.max(0, Math.round((words * 60) / 238));
}

function teaserOf(item: ShelfItem): ArticleBlock[] {
  const text = item.summary.replace(/\s+/g, " ").trim();
  return text ? [{ type: "paragraph", inlines: [{ type: "text", text }] }] : [];
}

export interface LoadedContent { blocks: ArticleBlock[]; source: ContentSource; reading_s: number; stored: boolean }

/** The item's article for this band: the stored copy when it is fresh (or a saved story pinned it), else one fetch. */
export async function loadContent(item: ShelfItem, band: "child" | "teen" | "adult", options: { retry?: boolean; store?: ShelfStore | null } = {}): Promise<LoadedContent> {
  const store = options.store === undefined ? sharedShelfStore() : options.store;
  const variant = variantOf(band);
  const stored = store?.getContent(item.id, variant) ?? null;
  if (stored && stored.source !== "teaser" && (stored.pinned || Date.now() - Date.parse(stored.fetched_at) < NEWS_TTL_MS)) {
    return { blocks: stored.blocks as ArticleBlock[], source: stored.source, reading_s: stored.reading_s, stored: true };
  }
  const teaser = (): LoadedContent => {
    bumpNewsCounter("story_text_teaser");
    const blocks = teaserOf(item);
    return { blocks, source: "teaser", reading_s: readingSeconds(blocks), stored: false };
  };
  if (options.retry) failures.forget(item.url);
  else if (failures.has(item.url)) return teaser();
  try {
    const page = await pageHtml(item.url, undefined, band === "adult" ? undefined : band);
    const article = extractFullArticle(page.html, { book: "news", allowedBooks: new Set(), allowLinks: band !== "child", allowImages: false, mode: "news", baseUrl: item.url });
    const blocks = article.blocks.filter((block) => block.type !== "figure");
    const text = textOfBlocks(blocks);
    // A minor's fetched text meets the same floor a search page does; one that trips it shows the feed's own text, never the page.
    if (!acceptArticleText(text) || (band !== "adult" && tripsMinorFloor(text))) {
      failures.record(item.url);
      return teaser();
    }
    failures.forget(item.url);
    bumpNewsCounter("story_text_fetched");
    const content: LoadedContent = { blocks, source: page.wayback ? "archived" : "fetched", reading_s: readingSeconds(blocks), stored: true };
    try {
      store?.putContent(item.id, variant, { blocks, source: content.source, reading_s: content.reading_s, fetched_at: new Date().toISOString() });
    } catch { /* the cache is disposable: a failed write never fails the read */ }
    return content;
  } catch {
    failures.record(item.url);
    bumpNewsCounter("story_text_failed");
    return teaser();
  }
}

/** The `article` block for one released item. Null when nothing is left to show (a child's gate removed every sentence). */
export async function articleBlock(item: ShelfItem, env: CardEnv, options: { retry?: boolean } = {}): Promise<Record<string, unknown> | null> {
  const { band } = env.viewer;
  const publisher = publisherOf(item, env);
  if (!publisher) return null;
  const gate = env.gate;
  const title = band === "child" ? gate.text(item.title) : item.title;
  if (!title || (band === "child" && !gate.passes(publisher))) return null;
  const loaded = await loadContent(item, band, { retry: options.retry, store: env.store });
  const blocks = band === "child" ? gateBlocks(loaded.blocks, gate) : loaded.blocks;
  if (blocks.length === 0) return null;
  const topic = topicsShown(item, band).map((id) => topicById(id)?.label).find((label): label is string => !!label);
  const image = imageOf(item, title, publisher, env);
  const speech = speechFor(title, blocks);
  return {
    id: `blk-${randomSuffix(10)}`, kind: "article", schema_version: 1, producer: "news",
    alt: `${title}, ${publisher}`.slice(0, 300), provenance: "news data story", created_at: new Date().toISOString(), hlc: nextHlc(),
    props: {
      story_id: storyIdOf(item), item_id: item.id, kicker: topic ?? publisher, title,
      byline: { publisher, site: hostOf(item.canonical_url) || publisher, published_at: publishedAtOf(item), outlets: 1, reading_s: loaded.reading_s },
      ...(image ? { image } : {}),
      blocks, also_covering: [], speech,
      ...(band !== "child" ? { open_url: item.url } : {}),
      content_source: loaded.source,
    },
  };
}
