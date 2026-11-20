import { evaluateSafety, carriesCrisisSignal } from "@/lib/safety";

// Edge partial completeness is used only to avoid speculative work on unfinished fragments.
export interface TurnEndScore {
  /** True for an obviously unfinished fragment (a dangling word, a filler, a trailing comma or ellipsis): no held run is worth starting on it. */
  unfinished: boolean;
}

/** Crisis checked edge score used by speculative start; unfinished fragments retain the existing no-run behavior. */
export function scoreEdgePartial(text: string): TurnEndScore {
  const scored = predictTurnEnd(text);
  const safety = evaluateSafety(text, "adult", "message");
  if (safety.action !== "allow" || carriesCrisisSignal(safety)) return { ...scored, unfinished: true };
  return scored;
}
/** Below this the fragment is plainly mid-sentence (a dangling "and", "to", "uh", a trailing comma): the client starts no held run on it. */
export const UNFINISHED_BELOW = 0.3;

/** Silence after a clearly closed, multiword sentence before committing the STT turn. */
export const SENTENCE_END_COMMIT_S = 0.5;
const FINISHED_SENTENCE_DANGLING = /(?:\b(?:and|but|so|because|or|um|uh|like|the|a|to|of|with|my|i|if|when|that|which)|,)\s*[?.!]?["')\]]*\s*$/i;
const SENTENCE_CLOSURE = /[?.!]["'’”’)}\]]*\s*$/;

/** Text-only turn boundary rule; does not decide whether to search or call a tool. */
export function isFinishedSentence(text: string): boolean {
  const trimmed = text.trim();
  return SENTENCE_CLOSURE.test(trimmed) && trimmed.split(/\s+/).length >= 3 && !FINISHED_SENTENCE_DANGLING.test(trimmed);
}

// Words that practically never complete a spoken fragment, even when STT adds a period.
const DANGLING = new Set([
  "and", "but", "or", "because", "cause", "than", "whether",
  "to", "the", "a", "an", "of", "by", "from", "into", "onto", "as", "per", "versus",
  "my", "your", "his", "their", "our", "its", "some", "every", "each",
  "i", "we", "they", "he", "she", "wanna", "gonna",
]);
// Hesitation sounds and restart markers: the person is still forming the thought.
const FILLERS = new Set(["uh", "um", "er", "erm", "hmm", "hm", "mm", "basically"]);

function words(text: string): string[] {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s'’-]/gu, " ").replace(/[’]/g, "'").split(/\s+/).filter(Boolean);
}

/** Mark an edge partial that is plainly unfinished. */
export function predictTurnEnd(text: string): TurnEndScore {
  const trimmed = text.trim();
  const list = words(trimmed);
  const result = (score: number): TurnEndScore => ({ unfinished: score < UNFINISHED_BELOW });
  if (list.length === 0) return result(0);
  const last = list[list.length - 1]!;
  const lastTwo = list.slice(-2).join(" ");
  if (/\.\.\.$|…$/.test(trimmed) || /,$/.test(trimmed)) return result(0.1);
  if (FILLERS.has(last) || lastTwo === "i mean" || lastTwo === "you know" || lastTwo === "kind of" || lastTwo === "sort of" || lastTwo === "it's like" || lastTwo === "was like") return result(0.05);
  if (DANGLING.has(last)) return result(0.05);
  return result(1);

}

