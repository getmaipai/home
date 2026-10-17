// The one definition of the empty chat's illustrations and the chooser that
// rotates through them. Files live in public/chat-art/.

export type ChatArt = { id: string; src: string; alt: string; when?: "morning" | "night" };

export const CHAT_ART_WIDTH = 1312;
export const CHAT_ART_HEIGHT = 1199;

const art = (id: string, alt: string, when?: ChatArt["when"]): ChatArt => ({ id, src: `/chat-art/${id}.webp`, alt, when });

export const CHAT_ART: readonly ChatArt[] = [
  art("morning", "The robot waving good morning in a sunny kitchen with coffee and fruit", "morning"),
  art("good-night", "The robot in bed with a cat, a cup of tea and the moon outside", "night"),
  art("listening", "The robot in headphones, listening, on a cushion by a window"),
  art("pondering", "The robot thinking at a desk with a notebook and a lightbulb"),
  art("search", "The robot on a ladder with a magnifying glass, searching a library"),
  art("weather", "The robot holding an umbrella on a balcony with a smiling cloud"),
  art("timer", "The robot setting a kitchen timer next to fresh cookies"),
  art("remembering", "The robot putting a memory into a labelled box on a shelf"),
  art("music", "The robot dancing in headphones next to a record player"),
  art("family", "The robot hugging a heart on a sofa under family photos"),
];

const KEY = "maipai.chatArt";
const MORNING = [5, 11] as const;
const NIGHT_FROM = 21;
const NIGHT_TO = 5;

type State = { order: string[]; cursor: number; last: string | null };
let memory: State = { order: [], cursor: 0, last: null };

function shuffled(ids: string[], rng: () => number): string[] {
  const out = [...ids];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function load(): { state: State; persisted: boolean } {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Partial<State>;
      if (Array.isArray(parsed.order) && typeof parsed.cursor === "number") {
        return { state: { order: parsed.order.filter((id) => typeof id === "string"), cursor: parsed.cursor, last: parsed.last ?? null }, persisted: true };
      }
    }
    return { state: { order: [], cursor: 0, last: null }, persisted: true };
  } catch {
    return { state: memory, persisted: false };
  }
}

function save(state: State, persisted: boolean): void {
  memory = state;
  if (!persisted) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage full or blocked: the in-memory copy keeps the rotation going.
  }
}

export function timeHint(now: Date): ChatArt["when"] | undefined {
  const hour = now.getHours();
  if (hour >= MORNING[0] && hour < MORNING[1]) return "morning";
  if (hour >= NIGHT_FROM || hour < NIGHT_TO) return "night";
  return undefined;
}

/** Next illustration: a shuffled order kept per browser, never the same one
 * twice in a row, leaning to the morning or night one about half the time. */
export function nextChatArt({ now = new Date(), rng = Math.random }: { now?: Date; rng?: () => number } = {}): ChatArt {
  const { state: loaded, persisted } = load();
  const ids = CHAT_ART.map((a) => a.id);
  let { order, cursor } = loaded;
  const { last } = loaded;
  if (order.length !== ids.length || !ids.every((id) => order.includes(id)) || cursor >= order.length) {
    order = shuffled(ids, rng);
    cursor = 0;
  }
  let id: string;
  const hinted = CHAT_ART.find((a) => a.when !== undefined && a.when === timeHint(now));
  if (hinted !== undefined && hinted.id !== last && rng() < 0.5) {
    id = hinted.id;
  } else {
    if (order[cursor] === last) {
      if (cursor + 1 < order.length) {
        [order[cursor], order[cursor + 1]] = [order[cursor + 1]!, order[cursor]!];
      } else {
        order = shuffled(ids, rng);
        cursor = 0;
        if (order[0] === last) [order[0], order[1]] = [order[1]!, order[0]!];
      }
    }
    id = order[cursor]!;
    cursor += 1;
  }
  save({ order, cursor, last: id }, persisted);
  return CHAT_ART.find((a) => a.id === id)!;
}
