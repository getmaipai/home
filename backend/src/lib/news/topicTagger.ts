// NEWS-02's topics idle step (docs/design/news-app-2026-10-17.md section 8): every story ends with exactly one topic. A story starts with
// its feed's own label (a feed says what it covers; `topics_hint` in the feed list), and a feed's label can be wrong for one story (a games
// piece in a health feed). This step reads the story's words with the embed role and moves it only when another topic beats the feed's
// label by a clear margin, so a feed that is right is never second-guessed and the odd story lands where it belongs. The margin was
// measured on 645 real stories: scoring alone agreed with feeds 72% of the time (too noisy to trust), while this rule changed 17 of them
// and the changes it made were the right ones (a games piece in Health moved to Entertainment, an orangutan rescue to Environment).
// Nothing here decides a live turn, and a Stack that is down just leaves the feed's label in place.
import { embed } from "@/lib/llm";
import { sharedShelfStore, type ShelfItem, type ShelfStore } from "@/lib/shelf/shelfStore";
import { TOPICS } from "./topics";

/** How much better another topic must score than the feed's own label before the story moves. */
export const TOPIC_OVERRIDE_MARGIN = 0.08;
const PREFIX = "classification: ";
const BATCH = 48;
const PER_TICK = 160;

/** Topics a story can be moved to: the adult and teen set, never Kids (a children's feed keeps it) and not Local (no feed carries it). */
const MOVABLE = TOPICS.filter((topic) => topic.id !== "kids" && topic.id !== "local");

export type EmbedFn = (texts: string[]) => Promise<number[][] | null>;

async function embedViaStack(texts: string[]): Promise<number[][] | null> {
  const out: number[][] = [];
  for (let at = 0; at < texts.length; at += BATCH) {
    const result = await embed(texts.slice(at, at + BATCH));
    if (!result.ok) return null;
    out.push(...result.value.vectors);
  }
  return out;
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0, x = 0, y = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; x += a[i]! ** 2; y += b[i]! ** 2; }
  return x === 0 || y === 0 ? 0 : dot / Math.sqrt(x * y);
}

/** The one topic a story keeps. `hint` is its feed's label (one or more ids), `scores` how close the story's words sit to each movable
 * topic. The label stays unless another topic beats the best-scoring label by the margin; with no usable label the story is left untagged. */
export function chooseTopic(hint: readonly string[], scores: ReadonlyMap<string, number>): string[] {
  const labels = hint.filter((id) => scores.has(id)).sort((a, b) => scores.get(b)! - scores.get(a)!);
  if (labels.length === 0) return hint.length > 0 ? [hint[0]!] : [];
  const best = [...scores.entries()].sort((a, b) => b[1] - a[1])[0]!;
  const own = labels[0]!;
  // A tiny epsilon so a gap of exactly the margin counts however the two floats round.
  return best[1] - scores.get(own)! >= TOPIC_OVERRIDE_MARGIN - 1e-9 ? [best[0]] : [own];
}

let descriptors: { vectors: number[][] } | null = null;
export function __resetTopicTaggerForTests(): void { descriptors = null; }

const textOf = (item: ShelfItem): string => `${PREFIX}${item.title}. ${item.summary}`.slice(0, 700);

/** Reads the newest stories whose topic is still only their feed's label and settles each on one topic. Returns how many it settled. */
export async function classifyPendingTopics(options: { store?: ShelfStore | null; embedTexts?: EmbedFn; limit?: number } = {}): Promise<number> {
  const store = options.store === undefined ? sharedShelfStore() : options.store;
  if (!store) return 0;
  const items = store.pendingTopicItems(options.limit ?? PER_TICK);
  if (items.length === 0) return 0;
  const embedTexts = options.embedTexts ?? embedViaStack;
  if (!descriptors || options.embedTexts) {
    const vectors = await embedTexts(MOVABLE.map((topic) => `${PREFIX}${topic.label}: ${topic.description}`));
    if (!vectors) return 0;
    descriptors = { vectors };
  }
  const itemVectors = await embedTexts(items.map(textOf));
  if (!itemVectors) return 0;
  let settled = 0;
  items.forEach((item, index) => {
    const scores = new Map(MOVABLE.map((topic, at) => [topic.id, cosine(itemVectors[index]!, descriptors!.vectors[at]!)] as const));
    store.setTopics(item.id, chooseTopic(item.topics ?? [], scores), "embed");
    settled++;
  });
  return settled;
}
