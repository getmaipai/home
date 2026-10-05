/**
 * CHAT-GROUND-BENCH-01 offline harness.
 *
 * Phase 1 owns the question fixture and the output scorer. Phase 2 can
 * consume the plan against the live Stack role after coordinator clearance.
 * This entry point intentionally performs no network or engine work.
 *
 *   bun run backend/scripts/bench/chat-ground-bench-01.ts --dry-run
 */

export type GroundBenchQuestion = {
  id: string;
  prompt: string;
  group: "grounding" | "control";
  context: "cold" | "warm" | "conversation";
  conversation?: readonly string[];
  manualInventedFactReview: true;
};

export const REPEATS = 10;

/** Design bench question set: failing conversational replays, current
 * information on cold/warm caches, and four controls that should not search. */
export const QUESTIONS: readonly GroundBenchQuestion[] = [
  {
    id: "replay-brazil-president",
    prompt: "who is the president of brazil",
    group: "grounding",
    context: "conversation",
    manualInventedFactReview: true,
  },
  {
    id: "replay-election-question",
    prompt: "wasnt there an election yesterday though",
    group: "grounding",
    context: "conversation",
    conversation: [],
    manualInventedFactReview: true,
  },
  {
    id: "replay-election-followup",
    prompt: "who won or is leading",
    group: "grounding",
    context: "conversation",
    conversation: ["wasnt there an election yesterday though"],
    manualInventedFactReview: true,
  },
  {
    id: "replay-citation-followup",
    prompt: "you are not citing your sources",
    group: "grounding",
    context: "conversation",
    manualInventedFactReview: true,
  },
  {
    id: "chile-election-cold",
    prompt: "who is the president of chile",
    group: "grounding",
    context: "cold",
    manualInventedFactReview: true,
  },
  {
    id: "france-warm-repeat",
    prompt: "What is the latest news in France?",
    group: "grounding",
    context: "warm",
    manualInventedFactReview: true,
  },
  {
    id: "france-warm-repeat-again",
    prompt: "What is the latest news in France?",
    group: "grounding",
    context: "warm",
    manualInventedFactReview: true,
  },
  {
    id: "control-wwii-year",
    prompt: "what year did WWII end",
    group: "control",
    context: "cold",
    manualInventedFactReview: true,
  },
  {
    id: "control-australia-capital",
    prompt: "capital of Australia",
    group: "control",
    context: "cold",
    manualInventedFactReview: true,
  },
  {
    id: "control-haiku-rain",
    prompt: "write a haiku about rain",
    group: "control",
    context: "cold",
    manualInventedFactReview: true,
  },
  {
    id: "control-arithmetic",
    prompt: "17 times 23",
    group: "control",
    context: "cold",
    manualInventedFactReview: true,
  },
];

export type RecordedRun = {
  searched: boolean;
  reply: string;
  firstTextMs: number | null;
  /** Probability of the first generated token being <tool_call>, if exposed. */
  firstTokenToolCallProbability?: number | null;
  /** Human annotation; deliberately never inferred by this scorer. */
  inventedFact?: "yes" | "no" | "review";
  cannotBrowse?: boolean;
};

export type QuestionScore = {
  id: string;
  runs: number;
  searchRate: number | null;
  citationMarkerRate: number | null;
  inventedFactJudgement: "manual review" | "annotated";
  cannotBrowseRate: number | null;
  meanFirstTextMs: number | null;
  firstTokenToolCallProbability: number | null;
  firstTokenToolCallSamples: number;
};

const mean = (values: number[]): number | null =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

/** Pure scorer; invented-fact annotations are carried through only as a
 * status so a person can inspect replies against the returned sources. */
export function scoreQuestion(id: string, runs: readonly RecordedRun[]): QuestionScore {
  const probabilities = runs.flatMap((run) =>
    typeof run.firstTokenToolCallProbability === "number" && Number.isFinite(run.firstTokenToolCallProbability)
      ? [run.firstTokenToolCallProbability]
      : [],
  );
  const firstText = runs.flatMap((run) =>
    typeof run.firstTextMs === "number" && Number.isFinite(run.firstTextMs) ? [run.firstTextMs] : [],
  );
  const hasAnnotations = runs.some((run) => run.inventedFact === "yes" || run.inventedFact === "no");
  return {
    id,
    runs: runs.length,
    searchRate: runs.length ? runs.filter((run) => run.searched).length / runs.length : null,
    citationMarkerRate: runs.length
      ? runs.filter((run) => /\[\d+\]/.test(run.reply)).length / runs.length
      : null,
    inventedFactJudgement: hasAnnotations ? "annotated" : "manual review",
    cannotBrowseRate: runs.length
      ? runs.filter((run) => run.cannotBrowse ?? /\b(?:cannot|can't|cannot) browse\b/i.test(run.reply)).length / runs.length
      : null,
    meanFirstTextMs: mean(firstText),
    firstTokenToolCallProbability: mean(probabilities),
    firstTokenToolCallSamples: probabilities.length,
  };
}

export function makePlan(): Array<{ id: string; prompt: string; context: string; rep: number }> {
  return QUESTIONS.flatMap((question) =>
    Array.from({ length: REPEATS }, (_, rep) => ({
      id: question.id,
      prompt: question.prompt,
      context: question.context,
      rep: rep + 1,
    })),
  );
}

if (import.meta.main) {
  if (!process.argv.includes("--dry-run")) {
    console.error("CHAT-GROUND-BENCH-01 is offline in phase 1; use --dry-run to print the plan.");
    process.exit(2);
  }
  console.log(JSON.stringify({
    bench: "CHAT-GROUND-BENCH-01",
    mode: "dry-run; no server or network access",
    repeats: REPEATS,
    questions: QUESTIONS.length,
    plannedRuns: QUESTIONS.length * REPEATS,
    logprobs: "record only if engine exposes first-token top_logprobs; otherwise report unavailable",
    inventedFacts: "flag for manual review against sources; no automatic judgement",
    plan: makePlan(),
  }, null, 2));
}
