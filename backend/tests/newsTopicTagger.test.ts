// The topics idle step: one topic per story, the feed's label kept unless another topic beats it by a clear margin.
import { beforeEach, describe, expect, test } from "bun:test";
import { __resetTopicTaggerForTests, TOPIC_OVERRIDE_MARGIN, chooseTopic, classifyPendingTopics, cosine } from "@/lib/news/topicTagger";
import { openShelfStore, type ShelfStore } from "@/lib/shelf/shelfStore";
import { TOPICS } from "@/lib/news/topics";
import { nextHlc } from "@/lib/hlc";
import { newNewsItemId } from "@/lib/id";

beforeEach(() => __resetTopicTaggerForTests());

const scores = (entries: Record<string, number>) => new Map(Object.entries(entries));

describe("chooseTopic", () => {
  test("the feed's label stays when no other topic beats it by the margin", () => {
    expect(chooseTopic(["health"], scores({ health: 0.5, entertainment: 0.5 + TOPIC_OVERRIDE_MARGIN - 0.01 }))).toEqual(["health"]);
  });
  test("another topic wins once it beats the label by the margin", () => {
    expect(chooseTopic(["health"], scores({ health: 0.49, entertainment: 0.49 + TOPIC_OVERRIDE_MARGIN }))).toEqual(["entertainment"]);
  });
  test("a feed that names two topics settles on the better scoring one, never both", () => {
    expect(chooseTopic(["science", "environment"], scores({ science: 0.5, environment: 0.55, sports: 0.5 }))).toEqual(["environment"]);
  });
  test("a label that cannot be scored (Kids) is kept as the one topic, and no label leaves the story untagged", () => {
    expect(chooseTopic(["kids"], scores({ world: 0.9 }))).toEqual(["kids"]);
    expect(chooseTopic([], scores({ world: 0.9 }))).toEqual([]);
  });
});

test("cosine is 1 for the same direction, 0 for orthogonal, and 0 for an empty vector", () => {
  expect(cosine([1, 2], [2, 4])).toBeCloseTo(1, 6);
  expect(cosine([1, 0], [0, 1])).toBe(0);
  expect(cosine([0, 0], [1, 1])).toBe(0);
});

describe("classifyPendingTopics", () => {
  const movable = TOPICS.filter((t) => t.id !== "kids" && t.id !== "local");
  const unit = (index: number): number[] => movable.map((_, at) => (at === index ? 1 : 0));
  // The stub reads a story's topic from a marker in its text: "[entertainment]" points the vector at that topic.
  const stubEmbed = async (texts: string[]): Promise<number[][]> =>
    texts.map((text) => {
      const marker = /\[([a-z]+)\]/.exec(text)?.[1];
      const at = movable.findIndex((t) => t.id === marker);
      if (at >= 0) return unit(at);
      const descriptor = movable.findIndex((t) => text.includes(`${t.label}:`));
      return descriptor >= 0 ? unit(descriptor) : unit(0);
    });
  function put(store: ShelfStore, title: string, topics: string[], feed = "feed-aaaaaaaaaaaa") {
    const url = `https://news.example.com/${encodeURIComponent(title)}`;
    store.put({ id: newNewsItemId(), canonical_url: url, url, feed_id: feed, title, summary: "Words.", published_at: null, fetched_at: new Date().toISOString(), publisher: "Example", lang: "en", band_ok: "child", hlc: nextHlc(), provenance: "feed:x", topics } as never);
  }
  const topicsOf = (store: ShelfStore, title: string): string[] | undefined => store.list(["feed-aaaaaaaaaaaa"], ["child"], 50).find((i) => i.title === title)?.topics;

  test("a story whose words point elsewhere moves, one that agrees with its feed stays, and each is settled once", async () => {
    const store = openShelfStore(":memory:");
    put(store, "A games piece [entertainment]", ["health"]);
    put(store, "A clinic story [health]", ["health"]);
    expect(await classifyPendingTopics({ store, embedTexts: stubEmbed })).toBe(2);
    expect(topicsOf(store, "A games piece [entertainment]")).toEqual(["entertainment"]);
    expect(topicsOf(store, "A clinic story [health]")).toEqual(["health"]);
    expect(await classifyPendingTopics({ store, embedTexts: stubEmbed })).toBe(0);
  });

  test("a children's story keeps Kids and is never read", async () => {
    const store = openShelfStore(":memory:");
    put(store, "A kids story [sports]", ["kids"]);
    expect(await classifyPendingTopics({ store, embedTexts: stubEmbed })).toBe(0);
    expect(topicsOf(store, "A kids story [sports]")).toEqual(["kids"]);
  });

  test("a Stack that cannot embed leaves every story with its feed's label and tries again next time", async () => {
    const store = openShelfStore(":memory:");
    put(store, "A games piece [entertainment]", ["health"]);
    expect(await classifyPendingTopics({ store, embedTexts: async () => null })).toBe(0);
    expect(topicsOf(store, "A games piece [entertainment]")).toEqual(["health"]);
    expect(await classifyPendingTopics({ store, embedTexts: stubEmbed })).toBe(1);
    expect(topicsOf(store, "A games piece [entertainment]")).toEqual(["entertainment"]);
  });
});
