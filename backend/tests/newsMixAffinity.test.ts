import { expect, test } from "bun:test";
import { computeAffinity, type MixActivity } from "../src/lib/news/mixAffinity";
import { mixScore, rankStories, type RankInput } from "../src/lib/news/rankStories";

const now = new Date("2026-10-17T12:00:00Z");
const none = { topics: new Set<string>(), sources: new Set<string>() };
const activity = (over: Partial<MixActivity> = {}): MixActivity => ({ topics: ["science"], source: "feed1", at: now.toISOString(), finished: false, saved: false, feedback: null, ...over });

test("opens, finishes, saves and More add 1, 2, 3 and 3; old signals halve in 30 days", () => {
  const signal = computeAffinity([
    activity({ finished: true, saved: true, feedback: "more" }),
    activity({ topics: ["world"], source: "feed2", at: new Date(now.getTime() - 30 * 86400000).toISOString() }),
    activity({ topics: ["health"], source: "feed3", feedback: "less" }),
  ], now);
  expect(signal.topics.get("science")).toBe(1);
  expect(signal.topics.get("world")).toBeCloseTo(0.5 / 9);
  expect(signal.sources.get("feed2")).toBeCloseTo(0.5 / 9);
  expect(signal.topics.get("health")).toBe(0);
  expect(signal.lessSources.has("feed3")).toBe(true);
});

test("each channel is counted once per story and invalid dates contribute nothing", () => {
  expect(computeAffinity([activity({ topics: ["science", "science"] })], now).topics.get("science")).toBe(1);
  expect(computeAffinity([activity({ at: "invalid" })], now).topics.size).toBe(0);
});

test("Less halves matching topic or source scores for exactly 30 days", () => {
  const story: RankInput = { story_id: "s1", item_id: "i1", title: "Science", topics: ["science"], publisher: "P", feed_id: "feed1", published_at: now.toISOString(), publisher_count: 1, has_image: true };
  const less = computeAffinity([activity({ feedback: "less" })], now);
  expect(mixScore(story, now, none, less)).toBeCloseTo(1.15 * 0.5);
  const expired = computeAffinity([activity({ feedback: "less", at: new Date(now.getTime() - 30 * 86400000).toISOString() })], now);
  expect(mixScore(story, now, none, expired)).toBeCloseTo(1.15);
  expect(mixScore({ ...story, topics: [] }, now, none, less)).toBeCloseTo(1.15 * 0.5);
});

test("Nadia's replay on a seeded week keeps top-ten diversity and featured caps", () => {
  let seed = 20261017;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const topics = ["world", "science", "technology", "sports", "business", "health"];
  const week: RankInput[] = Array.from({ length: 700 }, (_, i) => {
    const source = Math.floor(random() ** 2 * 12);
    return { story_id: `s${i}`, item_id: `i${i}`, title: `Story ${i}`, topics: [topics[Math.floor(random() * topics.length)]!], publisher: `P${source}`, feed_id: `feed${source}`, published_at: new Date(now.getTime() - random() * 7 * 86400000).toISOString(), publisher_count: 1 + Math.floor(random() ** 3 * 9), has_image: random() < 0.7 };
  });
  const replay = week.filter((s) => s.topics.includes("science") && now.getTime() - Date.parse(s.published_at) > 48 * 3600000).slice(0, 20);
  const signal = computeAffinity(replay.map((s, i) => activity({ topics: s.topics, source: s.feed_id, at: s.published_at, finished: true, saved: i % 3 === 0, feedback: i % 4 === 0 ? "more" : null })), now);
  const stories = week.filter((s) => now.getTime() - Date.parse(s.published_at) <= 48 * 3600000);
  const metrics = (mode: "today" | "mix") => {
    const p = rankStories({ stories, now, followed: none, mode, signal });
    const ten = [p.hero!, ...p.featured, ...p.rest].slice(0, 10);
    expect(new Set(p.featured.map((s) => s.publisher)).size).toBe(p.featured.length);
    for (const t of topics) expect(p.featured.filter((s) => s.topics.includes(t)).length).toBeLessThanOrEqual(2);
    return { sources: new Set(ten.map((s) => s.publisher)).size, topics: new Set(ten.flatMap((s) => s.topics)).size, science: ten.filter((s) => s.topics.includes("science")).length };
  };
  const today = metrics("today"), mix = metrics("mix");
  console.log("NEWS-05 seeded week", JSON.stringify({ replay: replay.length, candidates: stories.length, today, mix }));
  expect(mix.sources).toBeGreaterThanOrEqual(3);
  expect(mix.topics).toBeGreaterThanOrEqual(2);
  expect(JSON.stringify(rankStories({ stories, now, followed: none, mode: "mix", signal }))).toBe(JSON.stringify(rankStories({ stories: [...stories].reverse(), now, followed: none, mode: "mix", signal })));
});
