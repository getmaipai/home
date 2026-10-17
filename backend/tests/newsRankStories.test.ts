// NEWS-02b: rankStories in `today` mode, unit tests plus a deterministic seeded-week bench.
import { describe, expect, test } from "bun:test";
import { CHANNEL_BONUS, PICTURE_BONUS, isFollowed, rankStories, rankStoriesMix, todayScore, type Followed, type RankInput } from "@/lib/news/rankStories";

const NOW = new Date("2026-10-17T12:00:00Z");
const none: Followed = { topics: new Set(), sources: new Set() };
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
let n = 0;
function story(over: Partial<RankInput> = {}): RankInput {
  n += 1;
  return { story_id: `s${n}`, item_id: `i${n}`, title: `Story ${n}`, publisher: `pub${n}`, topics: [], published_at: hoursAgo(1), publisher_count: 1, has_image: false, feed_id: `f${n}`, ...over };
}
const rank = (stories: RankInput[], followed = none) => rankStories({ stories, now: NOW, followed, mode: "today" });
const ids = (xs: RankInput[]) => xs.map((s) => s.story_id);

describe("todayScore", () => {
  test("freshness halves every 8 hours", () => {
    const a = todayScore(story({ published_at: hoursAgo(0) }), NOW, none);
    const b = todayScore(story({ published_at: hoursAgo(8) }), NOW, none);
    const c = todayScore(story({ published_at: hoursAgo(16) }), NOW, none);
    expect(a).toBeCloseTo(1, 10);
    expect(b).toBeCloseTo(0.5, 10);
    expect(c).toBeCloseTo(0.25, 10);
  });
  test("coverage is 1 + log2(publisher_count); a count below 1 counts as 1", () => {
    expect(todayScore(story({ published_at: hoursAgo(0), publisher_count: 1 }), NOW, none)).toBeCloseTo(1, 10);
    expect(todayScore(story({ published_at: hoursAgo(0), publisher_count: 8 }), NOW, none)).toBeCloseTo(4, 10);
    expect(todayScore(story({ published_at: hoursAgo(0), publisher_count: 0 }), NOW, none)).toBeCloseTo(1, 10);
  });
  test("a picture multiplies by 1.15 and a followed topic or source by 1.5", () => {
    const base = todayScore(story({ published_at: hoursAgo(0) }), NOW, none);
    expect(todayScore(story({ published_at: hoursAgo(0), has_image: true }), NOW, none)).toBeCloseTo(base * PICTURE_BONUS, 10);
    const f: Followed = { topics: new Set(["science"]), sources: new Set(["feed-x", "Pub Y"]) };
    expect(todayScore(story({ published_at: hoursAgo(0), topics: ["science"] }), NOW, f)).toBeCloseTo(base * CHANNEL_BONUS, 10);
    expect(todayScore(story({ published_at: hoursAgo(0), feed_id: "feed-x" }), NOW, f)).toBeCloseTo(base * CHANNEL_BONUS, 10);
    expect(todayScore(story({ published_at: hoursAgo(0), publisher: "Pub Y" }), NOW, f)).toBeCloseTo(base * CHANNEL_BONUS, 10);
    expect(isFollowed(story({ topics: ["sport"] }), f)).toBe(false);
  });
  test("future dates count as new; undated or garbage dates score 0", () => {
    expect(todayScore(story({ published_at: hoursAgo(-5) }), NOW, none)).toBeCloseTo(1, 10);
    expect(todayScore(story({ published_at: "not a date" }), NOW, none)).toBe(0);
  });
});

describe("rankStories today", () => {
  test("empty input gives an empty page with no hero", () => {
    const page = rank([]);
    expect(page.hero).toBeUndefined();
    expect(page.featured).toEqual([]);
    expect(page.rest).toEqual([]);
  });
  test("a lone story is the hero", () => {
    const s = story();
    const page = rank([s]);
    expect(page.hero).toBe(s);
    expect(page.featured).toEqual([]);
    expect(page.rest).toEqual([]);
  });
  test("the hero has a picture when any story has one, even if a text story outranks it", () => {
    const top = story({ published_at: hoursAgo(0), publisher_count: 6 });
    const pic = story({ published_at: hoursAgo(20), has_image: true });
    const page = rank([top, pic]);
    expect(page.hero).toBe(pic);
    expect(ids(page.featured)).toEqual([top.story_id]);
  });
  test("with no picture anywhere the top story is the hero", () => {
    const a = story({ published_at: hoursAgo(5) }), b = story({ published_at: hoursAgo(1) });
    expect(rank([a, b]).hero).toBe(b);
  });
  test("a followed channel can lift an older story above a fresher one", () => {
    const fresh = story({ published_at: hoursAgo(1) }), older = story({ published_at: hoursAgo(3), topics: ["space"] });
    expect(rank([fresh, older]).hero).toBe(fresh);
    expect(rank([fresh, older], { topics: new Set(["space"]), sources: new Set() }).hero).toBe(older);
  });
  test("featured is the next four by rank, never the hero, rest newest first", () => {
    const stories = Array.from({ length: 10 }, (_, i) => story({ published_at: hoursAgo(i + 1), has_image: true }));
    const page = rank(stories);
    expect(page.hero).toBe(stories[0]!);
    expect(ids(page.featured)).toEqual(ids(stories.slice(1, 5)));
    expect(ids(page.rest)).toEqual(ids(stories.slice(5)));
  });
  test("featured holds one story per publisher; a second story from the same publisher falls to rest", () => {
    const hero = story({ publisher: "H", published_at: hoursAgo(0), has_image: true });
    const a1 = story({ publisher: "A", published_at: hoursAgo(1) });
    const a2 = story({ publisher: "A", published_at: hoursAgo(2) });
    const b = story({ publisher: "B", published_at: hoursAgo(3) });
    const page = rank([hero, a1, a2, b]);
    expect(page.hero).toBe(hero);
    expect(ids(page.featured)).toEqual([a1.story_id, b.story_id]);
    expect(ids(page.rest)).toEqual([a2.story_id]);
  });
  test("the hero's publisher may still appear once in featured", () => {
    const a1 = story({ publisher: "A", has_image: true }), a2 = story({ publisher: "A", published_at: hoursAgo(2) });
    expect(ids(rank([a1, a2]).featured)).toEqual([a2.story_id]);
  });
  test("featured holds at most two per topic", () => {
    const s = Array.from({ length: 6 }, (_, i) => story({ topics: ["tech"], published_at: hoursAgo(i + 1), has_image: i === 0 }));
    const page = rank(s);
    expect(page.featured).toHaveLength(2);
    expect(page.rest).toHaveLength(3);
  });
  test("a story with several topics is held back when any of its topics is full", () => {
    const t1 = story({ topics: ["tech"], published_at: hoursAgo(1), has_image: true });
    const t2 = story({ topics: ["tech"], published_at: hoursAgo(2) });
    const t3 = story({ topics: ["tech"], published_at: hoursAgo(3) });
    const mixed = story({ topics: ["tech", "money"], published_at: hoursAgo(4) });
    const page = rank([t1, t2, t3, mixed]);
    expect(ids(page.featured)).toEqual([t2.story_id, t3.story_id]);
    expect(ids(page.rest)).toEqual([mixed.story_id]);
  });
  test("a story with no topics is never held back by topic", () => {
    const s = Array.from({ length: 6 }, (_, i) => story({ published_at: hoursAgo(i + 1) }));
    expect(rank(s).featured).toHaveLength(4);
  });
  test("every input story appears exactly once", () => {
    const s = Array.from({ length: 30 }, (_, i) => story({ published_at: hoursAgo(i), topics: [`t${i % 3}`], publisher: `p${i % 5}`, has_image: i % 2 === 0 }));
    const page = rank(s);
    const all = [...(page.hero ? [page.hero] : []), ...page.featured, ...page.rest];
    expect(all).toHaveLength(30);
    expect(new Set(ids(all)).size).toBe(30);
  });
  test("duplicate story ids are collapsed", () => {
    const a = story();
    expect(rank([a, { ...a }]).rest).toEqual([]);
  });
  test("ties break by newest then story id, so the order is stable under input shuffling", () => {
    const s = [story({ story_id: "b", published_at: hoursAgo(1) }), story({ story_id: "a", published_at: hoursAgo(1) }), story({ story_id: "c", published_at: hoursAgo(1) })];
    const forward = rank(s), backward = rank([...s].reverse());
    expect(ids([forward.hero!, ...forward.featured, ...forward.rest])).toEqual(["a", "b", "c"]);
    expect(ids([backward.hero!, ...backward.featured, ...backward.rest])).toEqual(["a", "b", "c"]);
  });
  test("does not mutate its input", () => {
    const s = [story({ published_at: hoursAgo(9) }), story({ published_at: hoursAgo(1) })];
    const copy = s.map((x) => x.story_id);
    rank(s);
    expect(ids(s)).toEqual(copy);
  });
  test("an undated story sorts last, below dated ones", () => {
    const dated = story({ published_at: hoursAgo(100) }), undated = story({ published_at: "garbage" });
    const page = rank([undated, dated]);
    expect(page.hero).toBe(dated);
    expect(page.featured[0]).toBe(undated);
  });
  test("a child's follows are only what the caller passes: empty follows rank by the base score alone", () => {
    const a = story({ topics: ["space"], published_at: hoursAgo(2) }), b = story({ published_at: hoursAgo(1) });
    expect(rank([a, b], none).hero).toBe(b);
  });
  test("mix accepts an empty candidate set", () => {
    expect(rankStoriesMix({ stories: [], now: NOW, followed: none, mode: "mix" }).rest).toEqual([]);
  });
});

// A seeded week: 7 days of a 12-publisher, 6-topic shelf, ranked at every 3 hours of the week. The generator is a fixed PRNG so the
// run is the same every time; the assertions are the invariants plus measured floors for diversity.
describe("seeded week bench", () => {
  function mulberry32(seed: number) {
    return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const rnd = mulberry32(20261017);
  const topics = ["world", "science", "tech", "sport", "money", "health"];
  const weekStart = new Date("2026-10-10T00:00:00Z").getTime();
  const week: RankInput[] = Array.from({ length: 700 }, (_, i) => {
    const pub = Math.floor(rnd() ** 2 * 12);
    return { story_id: `w${i}`, item_id: `wi${i}`, title: `Week story ${i}`, publisher: `pub${pub}`, feed_id: `feed${pub}`, topics: [topics[Math.floor(rnd() * 6)]!, ...(rnd() < 0.3 ? [topics[Math.floor(rnd() * 6)]!] : [])], published_at: new Date(weekStart + rnd() * 7 * 86_400_000).toISOString(), publisher_count: 1 + Math.floor(rnd() ** 3 * 9), has_image: rnd() < 0.7 };
  });
  const followed: Followed = { topics: new Set(["science"]), sources: new Set(["feed3"]) };

  test("invariants hold at every sampled hour of the week, with and without follows", () => {
    let samples = 0, minPublishers = 99, minTopicsTop5 = 99;
    for (let h = 24; h <= 7 * 24; h += 3) {
      const now = new Date(weekStart + h * 3_600_000);
      const visible = week.filter((s) => Date.parse(s.published_at) <= now.getTime() && now.getTime() - Date.parse(s.published_at) <= 48 * 3_600_000);
      for (const f of [none, followed]) {
        const page = rankStories({ stories: visible, now, followed: f, mode: "today" });
        samples++;
        if (visible.length === 0) { expect(page.hero).toBeUndefined(); continue; }
        if (visible.some((s) => s.has_image)) expect(page.hero!.has_image).toBe(true);
        expect(page.featured.length).toBeLessThanOrEqual(4);
        expect(new Set(page.featured.map((s) => s.publisher)).size).toBe(page.featured.length);
        const perTopic = new Map<string, number>();
        for (const s of page.featured) for (const t of new Set(s.topics)) perTopic.set(t, (perTopic.get(t) ?? 0) + 1);
        for (const c of perTopic.values()) expect(c).toBeLessThanOrEqual(2);
        expect(1 + page.featured.length + page.rest.length).toBe(visible.length);
        const rest = page.rest.map((s) => Date.parse(s.published_at));
        for (let i = 1; i < rest.length; i++) expect(rest[i - 1]!).toBeGreaterThanOrEqual(rest[i]!);
        const top5 = [page.hero!, ...page.featured];
        minPublishers = Math.min(minPublishers, new Set(top5.map((s) => s.publisher)).size);
        if (page.featured.length === 4) minTopicsTop5 = Math.min(minTopicsTop5, new Set(top5.flatMap((s) => s.topics)).size);
      }
    }
    expect(samples).toBeGreaterThan(90);
    // Measured floors on this seed: the top five never collapse to a couple of sources or one topic.
    expect(minPublishers).toBeGreaterThanOrEqual(3);
    expect(minTopicsTop5).toBeGreaterThanOrEqual(2); // the per-topic cap of two makes two the floor by construction
  });
  test("the same input gives byte-identical output on every run", () => {
    const now = new Date(weekStart + 100 * 3_600_000);
    const a = rankStories({ stories: week, now, followed, mode: "today" });
    const b = rankStories({ stories: [...week].reverse(), now, followed, mode: "today" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  test("following a channel never lowers a followed story's place in the hero-plus-featured set", () => {
    const now = new Date(weekStart + 100 * 3_600_000);
    const visible = week.filter((s) => Date.parse(s.published_at) <= now.getTime());
    const count = (f: Followed) => { const p = rankStories({ stories: visible, now, followed: f, mode: "today" }); return [p.hero!, ...p.featured].filter((s) => isFollowed(s, followed)).length; };
    expect(count(followed)).toBeGreaterThanOrEqual(count(none));
  });
});
