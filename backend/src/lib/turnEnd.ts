// TALK-OVER-01 (docs/design/talk-over-2026-11-12.md section 2 item 1): the end-of-turn predictor. At the edge partial (the voice
// just stopped, so the acoustic cue is given) it scores the transcript so far for completeness and names the lowest
// "Talk before I finish" level at which the sentence counts as finished. Pure text rules, no model call; the Stack's Smart Turn
// (DUPLEX-02) can stand in for the shape rules behind the same `end` field once it is measured. This decides only when the
// person is done, never whether a message needs a search or a tool (rule 1 is untouched).

export type TalkOverLevel = "off" | "gentle" | "natural";
/** The lowest level at which an edge partial counts as a finished sentence; `none` means no level fires. */
export type TurnEndLevel = "none" | "gentle" | "natural";

export interface TurnEndScore {
  /** 0 (surely mid-sentence) to 1 (surely finished). */
  score: number;
  level: TurnEndLevel;
  /** True for an obviously unfinished fragment (a dangling word, a filler, a trailing comma or ellipsis): no held run is worth starting on it. */
  unfinished: boolean;
  /** The one cue that decided it, for the counts-only log. */
  reason: "connective" | "filler" | "trailing_comma" | "ellipsis" | "short" | "number" | "punctuated" | "shape" | "plain";
}

export const GENTLE_THRESHOLD = 0.85;
export const NATURAL_THRESHOLD = 0.5;
/** Below this the fragment is plainly mid-sentence (a dangling "and", "to", "uh", a trailing comma): the client starts no held run on it. */
export const UNFINISHED_BELOW = 0.3;

// A sentence does not end on one of these: the recognizer still adds a period to any segment ("I want to."), so the word wins
// over the punctuation. Connectives, prepositions, articles, auxiliaries, pronouns that start a clause, and hedges.
const DANGLING = new Set([
  "and", "but", "or", "so", "because", "cause", "if", "when", "while", "then", "than", "that", "which", "who", "whose", "where",
  "to", "the", "a", "an", "of", "with", "for", "in", "on", "at", "by", "from", "into", "onto", "about", "around", "like", "as",
  "is", "are", "was", "were", "be", "been", "being", "am", "do", "does", "did", "can", "could", "would", "should", "will", "shall",
  "may", "might", "must", "have", "has", "had", "not", "very", "really", "just", "also", "my", "your", "his", "her", "their", "our",
  "its", "this", "these", "those", "some", "any", "every", "each", "no", "i", "you", "we", "they", "he", "she", "it", "let", "let's",
  "want", "wanna", "need", "gonna", "going", "please", "maybe", "kind", "sort", "how", "what", "why", "whether",
]);
// Hesitation sounds and restart markers: the person is still forming the thought.
const FILLERS = new Set(["uh", "um", "er", "erm", "hmm", "hm", "mm", "like", "mean", "know", "basically", "actually", "well"]);
// A request or question up front makes a pause at a clean word boundary likelier to be the end.
const OPENERS = new Set([
  "what", "what's", "whats", "when", "when's", "where", "where's", "who", "who's", "why", "how", "how's", "which", "is", "are", "can",
  "could", "do", "does", "did", "will", "would", "should", "tell", "give", "set", "remind", "play", "turn", "show", "find", "add",
  "read", "call", "text", "start", "stop", "open", "make", "put", "wake", "let", "say", "sing", "search", "look", "check", "help",
]);
const NUMBER_WORDS = new Set([
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen",
  "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty",
  "ninety", "hundred", "thousand", "million",
]);

function words(text: string): string[] {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s'’-]/gu, " ").replace(/[’]/g, "'").split(/\s+/).filter(Boolean);
}

function levelFor(score: number): TurnEndLevel {
  if (score >= GENTLE_THRESHOLD) return "gentle";
  if (score >= NATURAL_THRESHOLD) return "natural";
  return "none";
}

/** Score the edge partial. Pure: the same text always gives the same answer. */
export function predictTurnEnd(text: string): TurnEndScore {
  const trimmed = text.trim();
  const list = words(trimmed);
  const result = (score: number, reason: TurnEndScore["reason"]): TurnEndScore => ({ score, level: levelFor(score), reason, unfinished: score < UNFINISHED_BELOW });
  if (list.length === 0) return result(0, "short");
  const last = list[list.length - 1]!;
  const lastTwo = list.slice(-2).join(" ");
  if (/\.\.\.$|…$/.test(trimmed)) return result(0.1, "ellipsis");
  if (/,$/.test(trimmed)) return result(0.1, "trailing_comma");
  if (FILLERS.has(last) || lastTwo === "i mean" || lastTwo === "you know" || lastTwo === "kind of" || lastTwo === "sort of") return result(0.05, "filler");
  if (DANGLING.has(last)) return result(0.05, "connective");
  const question = /\?$/.test(trimmed);
  const terminal = /[.?!]$/.test(trimmed);
  const shaped = list.length >= 3 && OPENERS.has(list[0]!);
  // A bare trailing number without a unit after a preposition ("set a timer for ten", "turn it to five") is usually the start
  // of a quantity; a question that ends on a number ("what is five times five?") is complete.
  const trailingNumber = NUMBER_WORDS.has(last) || /^\d+$/.test(last);
  if (trailingNumber && !question) {
    const before = list[list.length - 2];
    if (before && (before === "for" || before === "to" || before === "at" || before === "in" || before === "about" || before === "plus" || before === "minus" || before === "times" || before === "is")) return result(0.45, "number");
  }
  // One or two words ("okay", "hello there") are ambiguous whatever the punctuation: not worth a sound, and a held run on them is cheap to skip.
  if (list.length <= 2) return result(0.3, "short");
  let score = 0.5;
  // A question or exclamation mark is strong; a period is weak, since the recognizer closes any segment with one.
  if (question || /!$/.test(trimmed)) score += 0.35;
  else if (terminal) score += 0.2;
  if (shaped) score += 0.15;
  if (!terminal && !shaped) return result(score, "plain");
  return result(Math.min(1, score), terminal ? "punctuated" : "shape");
}

const ORDER: Record<TalkOverLevel, number> = { off: 0, gentle: 1, natural: 2 };

/** True when a partial scored at `end` counts as finished at the household's `level`: natural accepts gentle's cases too. */
export function firesAt(level: TalkOverLevel, end: TurnEndLevel): boolean {
  if (level === "off" || end === "none") return false;
  return ORDER[level] >= ORDER[end as TalkOverLevel];
}

/** Back-off (section 2 item 6): one step down, never below off. */
export function stepDown(level: TalkOverLevel): TalkOverLevel {
  return level === "natural" ? "gentle" : "off";
}
