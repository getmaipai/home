// NEWS-02b: the News app's one ranking function (design note section 9). Pure and deterministic: stories and a clock in, an ordered
// page out. No model, no network, no store. `today` mode only; `mix` is a hook NEWS-05 fills in.
//
//   score = freshness x coverage x picture x channel
//   freshness = 2^(-age_h / 8)        coverage = 1 + log2(publisher_count)
//   picture   = 1.15 with a picture   channel  = 1.5 when a topic or the source is followed
//
// Hero: the top story with a picture (the top story when none has one). Featured: the next four by rank, one per publisher and at
// most two per topic. Rest: everything else, newest first.

export interface RankInput {
  story_id: string;
  item_id: string;
  title: string;
  publisher: string;
  topics: string[];
  published_at: string;
  publisher_count: number;
  has_image: boolean;
  feed_id: string;
}

export interface Followed {
  /** Topic ids the person follows. */
  topics: Set<string>;
  /** Channels the person follows: matched against a story's `feed_id` and its `publisher`. */
  sources: Set<string>;
}

export interface RankedPage { hero?: RankInput; featured: RankInput[]; rest: RankInput[] }

export const HALF_LIFE_HOURS = 8;
export const PICTURE_BONUS = 1.15;
export const CHANNEL_BONUS = 1.5;
export const FEATURED_COUNT = 4;
export const FEATURED_PER_TOPIC = 2;

const HOUR_MS = 3_600_000;

function publishedMs(story: RankInput): number {
  const ms = Date.parse(story.published_at);
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

export function isFollowed(story: RankInput, followed: Followed): boolean {
  return story.topics.some((t) => followed.topics.has(t)) || followed.sources.has(story.feed_id) || followed.sources.has(story.publisher);
}

/** The Today score. A story dated in the future counts as brand new; an undated one scores 0 and sorts last. */
export function todayScore(story: RankInput, now: Date, followed: Followed): number {
  const ms = publishedMs(story);
  if (ms === Number.NEGATIVE_INFINITY) return 0;
  const ageHours = Math.max(0, (now.getTime() - ms) / HOUR_MS);
  const freshness = 2 ** (-ageHours / HALF_LIFE_HOURS);
  const coverage = 1 + Math.log2(Math.max(1, Math.floor(story.publisher_count) || 1));
  const picture = story.has_image ? PICTURE_BONUS : 1;
  const channel = isFollowed(story, followed) ? CHANNEL_BONUS : 1;
  return freshness * coverage * picture * channel;
}

function byRank(scores: Map<RankInput, number>) {
  return (a: RankInput, b: RankInput): number =>
    (scores.get(b)! - scores.get(a)!) || (publishedMs(b) - publishedMs(a) || 0) || (a.story_id < b.story_id ? -1 : a.story_id > b.story_id ? 1 : 0);
}

function newestFirst(a: RankInput, b: RankInput): number {
  return (publishedMs(b) - publishedMs(a) || 0) || (a.story_id < b.story_id ? -1 : a.story_id > b.story_id ? 1 : 0);
}

export function rankStories(input: { stories: RankInput[]; now: Date; followed: Followed; mode: "today" }): RankedPage {
  if (input.mode !== "today") throw new Error(`rankStories: mode "${String(input.mode)}" is not supported here; use rankStoriesMix for "mix".`);
  const seen = new Set<string>();
  const stories = input.stories.filter((s) => (seen.has(s.story_id) ? false : (seen.add(s.story_id), true)));
  const scores = new Map<RankInput, number>();
  for (const s of stories) scores.set(s, todayScore(s, input.now, input.followed));
  const ranked = [...stories].sort(byRank(scores));

  const hero = ranked.find((s) => s.has_image) ?? ranked[0];
  const chosen = new Set<RankInput>();
  if (hero) chosen.add(hero);

  const featured: RankInput[] = [];
  const publishers = new Set<string>();
  const topicCount = new Map<string, number>();
  for (const s of ranked) {
    if (featured.length >= FEATURED_COUNT) break;
    if (chosen.has(s) || publishers.has(s.publisher)) continue;
    if (s.topics.some((t) => (topicCount.get(t) ?? 0) >= FEATURED_PER_TOPIC)) continue;
    featured.push(s);
    chosen.add(s);
    publishers.add(s.publisher);
    for (const t of new Set(s.topics)) topicCount.set(t, (topicCount.get(t) ?? 0) + 1);
  }

  const rest = stories.filter((s) => !chosen.has(s)).sort(newestFirst);
  return { ...(hero ? { hero } : {}), featured, rest };
}

/** The My Mix hook (design note section 9: `channel = 1 + affinity`, "Less like this" x 0.5). NEWS-05 builds it; until then it
 * refuses, so no caller can mistake Today's order for a person's mix. */
export function rankStoriesMix(_input: { stories: RankInput[]; now: Date; followed: Followed; mode: "mix" }): RankedPage {
  throw new Error("rankStoriesMix: My Mix ranking is not implemented yet (NEWS-05).");
}
