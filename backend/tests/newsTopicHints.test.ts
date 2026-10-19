import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FeedListPackage } from "@maipai/spec/gen/ts/feed-list-package.js";
import { PACKAGES_DIR } from "@/lib/paths";
import { __resetTopicHintsForTests, topicsHintFor } from "@/lib/shelf/shelfFeeds";
import { openShelfStore } from "@/lib/shelf/shelfStore";
import { topicsFor } from "@/lib/news/topics";
import { nextHlc } from "@/lib/hlc";
import { newNewsItemId } from "@/lib/id";

const list = (id: string) => FeedListPackage.parse(JSON.parse(readFileSync(join(PACKAGES_DIR, id, "feeds.json"), "utf8")));

beforeEach(() => __resetTopicHintsForTests());

describe("feed topic hints", () => {
  test("the bundled lists carry topics a reader of that user type is offered", () => {
    const teenTopics = new Set(topicsFor("teen").map((t) => t.id));
    for (const feed of list("feeds-household").feeds) for (const id of feed.topics_hint ?? []) expect(teenTopics.has(id)).toBe(true);
    const childTopics = new Set(topicsFor("child").map((t) => t.id));
    for (const feed of list("feeds-children").feeds) expect(feed.topics_hint?.every((id) => childTopics.has(id))).toBe(true);
  });

  test("every topic offered to teens and adults except Local has at least three feeds", () => {
    const counts = new Map<string, number>();
    for (const feed of list("feeds-household").feeds) for (const id of feed.topics_hint ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const topic of topicsFor("teen")) if (topic.id !== "local") expect(counts.get(topic.id) ?? 0).toBeGreaterThanOrEqual(3);
  });

  test("a feed's hint is found by its address; an unlisted address has none", () => {
    expect(topicsHintFor("https://feeds.npr.org/1007/rss.xml")).toEqual(["science"]);
    expect(topicsHintFor("https://feeds.bbci.co.uk/news/rss.xml")).toEqual([]);
    expect(topicsHintFor("https://feeds.bbci.co.uk/newsround/rss.xml")).toEqual(["kids"]);
    expect(topicsHintFor("https://example.com/feed.xml")).toEqual([]);
  });

  test("no household feed names more than one topic, so a story never starts under two", () => {
    for (const feed of list("feeds-household").feeds) expect((feed.topics_hint ?? []).length).toBeLessThanOrEqual(1);
  });

  test("a story two feeds carry keeps the topic of the first feed that stored it", () => {
    const store = openShelfStore(":memory:");
    const base = { canonical_url: "https://news.example.com/a", url: "https://news.example.com/a", title: "A story", summary: "Words.", published_at: null, fetched_at: new Date().toISOString(), publisher: "Example", lang: "en", band_ok: "child" as const, provenance: "feed:x" };
    const put = (feed: string, topics: string[]) => store.put({ ...base, id: newNewsItemId(), feed_id: feed, hlc: nextHlc(), topics } as never);
    expect(put("feed-aaaaaaaaaaaa", ["world"]).inserted).toBe(true);
    expect(put("feed-bbbbbbbbbbbb", ["business"]).inserted).toBe(false);
    const items = store.list(["feed-aaaaaaaaaaaa", "feed-bbbbbbbbbbbb"], ["child"], 10);
    expect(items).toHaveLength(1);
    expect(items[0]!.topics).toEqual(["world"]);
  });
});
