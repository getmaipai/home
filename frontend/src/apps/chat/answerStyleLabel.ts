// ANSWER-LABEL-01: the small word under a reply that says which answer style produced it, and its one-line hover.
import type { TurnStats } from "@/lib/api";

export type AnswerStyleWord = "instant" | "thinking" | "max";

export const ANSWER_STYLE_LINES: Record<AnswerStyleWord, string> = {
  instant: "A quick answer.",
  thinking: "It took time to think this through first.",
  max: "The strongest answer. It looked into this in depth.",
};

export const ANSWER_STYLE_WORDS: Record<AnswerStyleWord, string> = { instant: "Instant", thinking: "Thinking", max: "Max" };

/** The style a stored or streamed reply came from; a reply with stats, no recorded style and no thinking was Instant. */
export function answerStyleOf(stats: Pick<TurnStats, "answer_style" | "thinking"> | undefined): AnswerStyleWord | undefined {
  if (!stats) return undefined;
  return stats.answer_style ?? (stats.thinking ? "thinking" : "instant");
}
