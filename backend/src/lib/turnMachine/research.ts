// RESEARCH-TIER-01: research depth follows the answer style the person picked for this message.
// Instant keeps the model record's one tool round. Thinking takes more rounds, and Max takes the most,
// with a first-round note that asks the model to split the question and a nudge before each later round
// that says what was already searched and from how many sites. The model still decides every search
// (RULES.md rule 1: tool_choice stays auto); this only widens how many rounds it may take and tells
// it what the earlier rounds found. Counting sites is structural (a host count), not reading wording.
// Age and surface gates outrank it (rule 0): only an adult's written turn is ever raised.
import type { AgeBand } from "@/lib/ageBand";
import type { ToolExecutionOutcome } from "@/lib/turnContext";
import type { TurnBudget } from "./contract";

/** Appended to the final answering instruction of a research turn. */
export const RESEARCH_ANSWER_CLAUSE = "Say where each claim comes from (the site, or who was interviewed) beside its [n]. Say plainly which parts are your own guess and which the sources state. If the sources disagree or are thin, say so.";

export type AnswerStyle = "instant" | "thinking" | "max";

/** The style this message runs under. Max needs the page's say-so AND the server's own lease check. */
export function answerStyleFor(input: { thinking?: boolean; max?: boolean; maxLeaseHeld: boolean; band: AgeBand; surfaceClass?: string; bare?: boolean }): AnswerStyle {
  if (input.band !== "adult" || input.bare === true || input.surfaceClass === "spoken") return "instant";
  if (input.max === true && input.maxLeaseHeld) return "max";
  return input.thinking === true ? "thinking" : "instant";
}

/** The budget this style runs on: more rounds, and a total deadline that grows by each added round's model and tool time. */
export function budgetForStyle(budget: TurnBudget, style: AnswerStyle): TurnBudget {
  if (style === "instant" || !budget.model_transitions || budget.rounds < 1) return budget;
  const thinking = budget.rounds_thinking ?? budget.rounds;
  const rounds = Math.max(budget.rounds, style === "max" ? Math.max(budget.rounds_max ?? thinking, thinking) : thinking);
  if (rounds === budget.rounds) return budget;
  const d = budget.deadlines_ms;
  return { ...budget, rounds, deadlines_ms: { ...d, total: d.total + (rounds - budget.rounds) * (d.model + d.tool) } };
}

/** Whether this turn may take more than one tool round (the first-round note and the later nudges apply). */
export const isResearchStyle = (style: AnswerStyle | undefined, budget: TurnBudget): boolean => style !== undefined && style !== "instant" && budget.rounds > 1;

/** Added to the first round of a research turn. */
export function firstRoundNote(style: AnswerStyle, rounds: number): string {
  if (style === "max") {
    return `This question deserves research. Before you search, split it into the separate things that need looking up (what the subject actually is, why something happened, what came after, what the people involved said in interviews, books or follow-ups) and look each one up with its own search, one step at a time, each with a different query. Prefer more than one site and a primary source such as an interview or the creators' own words. You may search up to ${rounds} times; stop as soon as every part is answered.`;
  }
  return `You may search more than once. If the first results leave part of the question unanswered, search again with a different query before you answer. You may search up to ${rounds} times.`;
}

export interface ResearchProgress {
  queries: string[];
  sites: string[];
}

/** What the rounds so far searched and which sites they read, from the outcomes alone. */
export function researchProgress(outcomes: readonly ToolExecutionOutcome[]): ResearchProgress {
  const queries: string[] = [];
  const sites = new Set<string>();
  for (const outcome of outcomes) {
    if (outcome.packageId !== "websearch") continue;
    const args = outcome.args as { expression?: unknown } | undefined;
    const query = typeof args?.expression === "string" ? args.expression.trim() : "";
    if (query) queries.push(query.slice(0, 120));
    if (outcome.status === "succeeded") for (const source of outcome.sources ?? []) if (source.site) sites.add(source.site.replace(/^www\./, ""));
  }
  return { queries, sites: [...sites] };
}

/** The user-role nudge before a later tool round: what was searched, what was read, what is left. */
export function continuationInstruction(style: AnswerStyle, utterance: string, progress: ResearchProgress, roundsLeft: number): string {
  const searched = progress.queries.length > 0 ? `Searched so far: ${progress.queries.map((q) => `"${q.replace(/"/g, "'")}"`).join("; ")}.` : "Nothing has been searched yet.";
  const read = progress.sites.length > 0 ? `Sites read so far (${progress.sites.length}): ${progress.sites.join(", ")}.` : "No site has been read yet.";
  const left = `You have ${roundsLeft} more search${roundsLeft === 1 ? "" : "es"} available.`;
  const question = `my question: "${utterance.replace(/"/g, "'")}"`;
  if (style === "max") {
    return `${searched} ${read} ${left} Check what is still missing for ${question}. If a part is unanswered, if everything so far came from one site, or if no primary source (an interview, the creators' own words) has been looked at, search again with a different query. Cite sources by their numbers. If nothing important is missing, answer now. ${RESEARCH_ANSWER_CLAUSE}`;
  }
  return `${searched} ${read} ${left} If something important for ${question} is still missing, search again with a different query; otherwise answer now. ${RESEARCH_ANSWER_CLAUSE}`;
}

/** The stop rule (Jina-style): a round whose searches found no source the earlier rounds had not already shown has nothing
 * new to add, so the turn goes to its answer instead of searching on. Counts and URLs only, no wording is read. */
export function roundAddedNothing(previous: readonly ToolExecutionOutcome[], round: readonly ToolExecutionOutcome[]): boolean {
  const searches = round.filter((o) => o.packageId === "websearch");
  if (searches.length === 0) return false;
  const seen = new Set(previous.flatMap((o) => (o.sources ?? []).map((source) => source.url)));
  return !searches.some((o) => (o.sources ?? []).some((source) => !seen.has(source.url)));
}

/** The reply's citation check, mechanical: a [n] that names no source of this reply is dropped (a fabricated reference is the
 * documented failure of research agents). Returns the text and how many markers were dropped. */
export function dropUnknownCitations(text: string, sourceCount: number): { text: string; dropped: number } {
  let dropped = 0;
  const cleaned = text.replace(/\s?\[(\d{1,3})\]/g, (whole, n: string) => {
    const number = Number(n);
    if (number >= 1 && number <= sourceCount) return whole;
    dropped += 1;
    return "";
  });
  return { text: cleaned, dropped };
}
