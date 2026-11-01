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
import { plainQuery } from "./entityPin";

/** Appended to the final answering instruction of a research turn. */
export const RESEARCH_ANSWER_CLAUSE = "Say where each claim comes from (the site, or who was interviewed) beside its [n]. Say plainly which parts are your own guess and which the sources state. If the sources disagree or are thin, say so.";

export type AnswerStyle = "instant" | "thinking" | "max";

/** The style this message runs under. Max needs the page's say-so AND the server's own lease check. */
export function answerStyleFor(input: { thinking?: boolean; max?: boolean; maxLeaseHeld: boolean; band: AgeBand; surfaceClass?: string; bare?: boolean }): AnswerStyle {
  if (input.band !== "adult" || input.bare === true || input.surfaceClass === "spoken") return "instant";
  if (input.max === true && input.maxLeaseHeld) return "max";
  return input.thinking === true ? "thinking" : "instant";
}

/** Room for the model's reasoning on top of the visible reply, by style. The live V run (2026-11-01) showed both Thinking and Max
 * replies cut off after a few words: the reasoning over several searches' evidence used the whole 512-token allowance and the
 * ceiling with it, so the visible answer stopped mid-sentence. The visible ceiling stays the record's; only the reasoning room grows. */
export const THINKING_ALLOWANCE_FACTOR = { thinking: 4, max: 12 } as const;

/** The budget this style runs on: more rounds, more reasoning room, and a total deadline that grows by each added round's model and tool time. */
export function budgetForStyle(budget: TurnBudget, style: AnswerStyle): TurnBudget {
  if (style === "instant" || !budget.model_transitions || budget.rounds < 1) return budget;
  const thinking = budget.rounds_thinking ?? budget.rounds;
  const rounds = Math.max(budget.rounds, style === "max" ? Math.max(budget.rounds_max ?? thinking, thinking) : thinking);
  const d = budget.deadlines_ms;
  const room = budget.thinking_budget_tokens_toggled > 0 ? { thinking_budget_tokens_toggled: budget.thinking_budget_tokens_toggled * THINKING_ALLOWANCE_FACTOR[style] } : {};
  if (rounds === budget.rounds && Object.keys(room).length === 0) return budget;
  return { ...budget, ...room, rounds, deadlines_ms: { ...d, total: d.total + (rounds - budget.rounds) * (d.model + d.tool) } };
}

/** RESEARCH-CLOCK-01 (Jesse, 2026-11-01: "we can't have 8-minute runs, no one will wait"): research is bounded by wall-clock time, and the
 * round counts (4 and 12) are only ceilings. The cap is the moment the WRITING starts, counted from the start of the turn: at
 * NO_NEW_ROUND_SHARE of it no new round starts, and at it page reading stops and the answer is written from the notes so far. Measured on
 * the Studio (2026-11-01, the V question): the analysis takes 3 to 10 seconds and the writing 25 to 35 more, and the answer streams while
 * it is written, so the first words reach the person about 5 to 10 seconds after the cap. Adult written answers have no cap on their own
 * length (rule 5); the cap is on the searching. */
export const RESEARCH_CAP_MS = { thinking: 35_000, max: 75_000 } as const;
export const NO_NEW_ROUND_SHARE = 0.7;
let capOverride: { thinking: number; max: number } | undefined;
/** Tests: replaces the caps (milliseconds); undefined restores them. */
export function __setResearchCapForTests(caps: { thinking: number; max: number } | undefined): void { capOverride = caps; }

export function researchCapMs(style: AnswerStyle | undefined): number | undefined {
  return style === "thinking" || style === "max" ? (capOverride ?? RESEARCH_CAP_MS)[style] : undefined;
}

/** True once a research turn is past 70% of its cap: the machine starts no new tool round. */
export function researchNoNewRound(state: { answerStyle?: AnswerStyle; startedAt: number }, now: number = Date.now()): boolean {
  const cap = researchCapMs(state.answerStyle);
  return cap !== undefined && now - state.startedAt >= cap * NO_NEW_ROUND_SHARE;
}

/** The moment (ms since the epoch) page reading and note waiting stop for this turn; undefined for Instant. */
export function researchCutAt(state: { answerStyle?: AnswerStyle; startedAt: number }): number | undefined {
  const cap = researchCapMs(state.answerStyle);
  return cap === undefined ? undefined : state.startedAt + cap;
}

/** True once a research turn is past its cap: the analysis is skipped and the notes wait is short. */
export function researchPastCut(state: { answerStyle?: AnswerStyle; startedAt: number }, now: number = Date.now()): boolean {
  const cut = researchCutAt(state);
  return cut !== undefined && now >= cut;
}

/** The time-line a research turn leaves for the bench and the trace: milliseconds since the turn began, labels only (rule 6a). */
export type ResearchMarkSink = (turnId: string, atMs: number, what: string) => void;
let markSink: ResearchMarkSink | undefined;
export function __setResearchMarkSinkForTests(sink: ResearchMarkSink | undefined): void { markSink = sink; }
export function markResearch(state: { turnId: string; startedAt: number }, what: string): void {
  markSink?.(state.turnId, Date.now() - state.startedAt, what);
}

/** Whether this turn may take more than one tool round (the first-round note and the later nudges apply). */
export const isResearchStyle = (style: AnswerStyle | undefined, budget: TurnBudget): boolean => style !== undefined && style !== "instant" && budget.rounds > 1;

/** Added to the first round of a research turn. */
export function firstRoundNote(style: AnswerStyle, rounds: number): string {
  if (style === "max") {
    return `This question deserves research. Work in this order. (1) Say exactly which subject, version, edition, person, product or event I mean, from my own words; if several fit, pick the one my words describe and say which you chose. (2) Find the authoritative or primary sources for that subject first (the people or bodies that own, wrote, made or govern it; original documents, interviews, official statements), and from then on use only the names and titles those sources gave; never credit a person or body with a work or a claim unless a source says so. (3) Decide the 4 to 8 angles that matter for this particular question and search each one on its own: one angle per search, a specific query (the exact name, the year or version, and the angle), never repeating an earlier query. (4) If a search comes back thin, rewrite the query using what you have found so far. (5) For any part still unanswered, or backed by only one source, search again. You may search up to ${rounds} times; stop as soon as every part is answered.`;
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
    return `${searched} ${read} ${left} Check what is still missing for ${question}. If a part is unanswered, if a claim rests on one site, or if no primary source (an official statement, an interview, the original document) has been looked at, search again with a different, more specific query that uses the names and titles found so far. Do not credit anyone with a work or a claim unless a source says so. Cite sources by their numbers. If nothing important is missing, answer now. ${RESEARCH_ANSWER_CLAUSE}`;
  }
  return `${searched} ${read} ${left} If something important for ${question} is still missing, search again with a different query; otherwise answer now. ${RESEARCH_ANSWER_CLAUSE}`;
}

/** The stop rule (Jina-style): a round whose searches found no source the earlier rounds had not already shown has nothing
 * new to add, so the turn goes to its answer instead of searching on. Counts and URLs only, no wording is read. */
export function roundAddedNothing(previous: readonly ToolExecutionOutcome[], round: readonly ToolExecutionOutcome[]): boolean {
  // A skipped repeat is not a result: the next round tells the model and lets it search another angle.
  const searches = round.filter((o) => o.packageId === "websearch" && o.errorCode !== "repeat_query" && o.errorCode !== "memory_query");
  if (searches.length === 0) return false;
  const sourcesIn = (list: readonly ToolExecutionOutcome[]) => list.filter((o) => o.packageId === "websearch").flatMap((o) => o.sources ?? []);
  const seen = new Set(sourcesIn(previous).map((source) => source.url));
  const found = searches.flatMap((o) => o.sources ?? []);
  if (found.length === 0) {
    // An empty round is a thin query, not the end: the model gets one more try to rewrite it, and a second empty round in a row ends the searching.
    const earlierSearches = previous.filter((o) => o.packageId === "websearch" && o.errorCode !== "repeat_query" && o.errorCode !== "memory_query");
    return earlierSearches.length > 0 && seen.size === 0;
  }
  return !found.some((source) => !seen.has(source.url));
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

const STOP_WORDS = new Set(["the", "a", "an", "of", "and", "or", "in", "on", "for", "to", "is", "was", "what", "why", "how", "did", "about"]);
const tokensOf = (query: string): Set<string> => new Set(query.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((t) => t.length > 0 && !STOP_WORDS.has(t)));

/** Whether this query repeats an earlier search of the turn: the same words, or nearly (four in five shared). Counts words only. */
export function isRepeatQuery(earlier: readonly string[], query: string): boolean {
  const mine = tokensOf(query);
  if (mine.size === 0) return false;
  return earlier.some((previous) => {
    const theirs = tokensOf(previous);
    const shared = [...mine].filter((t) => theirs.has(t)).length;
    return shared / Math.max(mine.size, theirs.size) >= 0.8;
  });
}

/** The repeat-skip note the next round's nudge carries, so the model knows why a search did not run. */
export const REPEAT_SKIPPED_NOTE = "A search that repeated an earlier one was skipped; search a different angle or answer.";

const CREDIT_CUE = /\b(created|creator of|wrote|written by|produced|directed|developed by|showrunner|founded|invented|designed)\b/i;
const NAME = /\b[A-Z][a-z]+(?:\s+(?:[A-Z]\.|[A-Z][a-z]+)){1,2}\b/g;

/** The reply's credit check: a sentence that credits a named person with a work or claim ("created by Jane Roe") is dropped when no
 * fetched source and no word of the person's own question names that person. Returns the text and how many sentences went. Names are
 * capitalized word runs; the sources' titles, snippets and page text are the evidence. */
export function dropUnsupportedCredits(text: string, evidence: string, question: string): { text: string; dropped: number } {
  const haystack = `${evidence}\n${question}`.toLowerCase();
  let dropped = 0;
  const parts = text.split(/(?<=[.!?])(\s+)/);
  const kept = parts.filter((part) => {
    if (!CREDIT_CUE.test(part)) return true;
    const names = part.match(NAME) ?? [];
    const unsupported = names.some((name) => !haystack.includes(name.toLowerCase()));
    if (unsupported) dropped += 1;
    return !unsupported;
  });
  return { text: kept.join("").replace(/\s{3,}/g, "\n\n").trim(), dropped };
}

/** Said when the answer is written after searches that found nothing at all, so a memory answer is never dressed as research. */
export const NO_WEB_RESULTS_CLAUSE = "Every search returned nothing usable. Say so in your first sentence (that you could not reach the web for this), then give what you know and mark it as from memory, not researched.";

/** Everything the searches returned as text (titles, snippets, page text), for the credit check. */
export function researchEvidence(outcomes: readonly ToolExecutionOutcome[]): string {
  const parts: string[] = [];
  for (const outcome of outcomes) {
    const data = outcome.result?.data as { rows?: { title?: unknown; snippet?: unknown }[]; pages?: { text?: unknown; title?: unknown }[] } | undefined;
    for (const row of data?.rows ?? []) parts.push(String(row.title ?? ""), String(row.snippet ?? ""));
    for (const page of data?.pages ?? []) parts.push(String(page.title ?? ""), String(page.text ?? ""));
  }
  return parts.join("\n");
}

/** The text each numbered source gave this turn, in source-number order (index 0 is [1]): the fetched page when one was read, else the
 * search row's title and snippet. A source with no text at all is an empty string. */
export function evidenceBySource(outcomes: readonly ToolExecutionOutcome[], notes: readonly { url: string; quote: string }[] = []): string[] {
  const byUrl = new Map<string, string>();
  for (const outcome of outcomes) {
    const data = outcome.result?.data as { rows?: { url?: unknown; title?: unknown; snippet?: unknown }[]; pages?: { url?: unknown; text?: unknown; title?: unknown }[] } | undefined;
    for (const row of data?.rows ?? []) if (typeof row.url === "string" && !byUrl.has(row.url)) byUrl.set(row.url, `${String(row.title ?? "")}. ${String(row.snippet ?? "")}`);
    for (const page of data?.pages ?? []) if (typeof page.url === "string") byUrl.set(page.url, `${String(page.title ?? "")}. ${String(page.text ?? "")}`);
  }
  // RESEARCH-NOTES-01: the quotes taken from deep in a page (checked against it) are passages of that source too.
  const quotes = new Map<string, string[]>();
  for (const note of notes) quotes.set(note.url, [...(quotes.get(note.url) ?? []), note.quote]);
  return outcomes.flatMap((o) => o.sources ?? []).map((source) => {
    const deep = quotes.get(source.url);
    // The checked quotes come first: a page is kept up to 8,000 characters and the judge reads only the start of the passages.
    return `${deep ? `${deep.join("\n")}\n` : ""}${byUrl.get(source.url) ?? ""}`.trim();
  });
}

/** One model call: a prompt in, the model's text out, or null when the model is unavailable. */
export type ClaimJudge = (prompt: string) => Promise<string | null>;

export const CLAIM_UNCONFIRMED = " (not confirmed by the sources)";

export function claimPrompt(sentence: string, passages: string): string {
  return `You check one sentence from a research answer against the passages its cited sources returned.
Sentence: "${sentence}"

Passages:
"""
${passages.slice(0, 6000)}
"""

Answer with one JSON object and nothing else: {"supported": true | false}
"supported" is true only when a passage above states what the sentence claims (the facts, names, dates and who said or did what). A sentence that says it is a guess, an opinion or what is likely is supported. If the passages say something different, or say nothing about it, answer false.`;
}

export interface ClaimCheckResult { text: string; checked: number; unsupported: number; skipped: number }

/** The reply's claim check: every sentence that cites [n] is judged against the passages of the sources it cites. A sentence the passages
 * do not back keeps its words, loses its citation markers and gains "(not confirmed by the sources)", so a citation never points at a page
 * that does not say it. A sentence whose sources gave no text is skipped, an unreadable or missing judge answer leaves the sentence as
 * written, and the whole check stops at its time cap. The judge calls run a few at a time. */
export async function checkClaims(text: string, evidence: readonly string[], judge: ClaimJudge, opts: { concurrency?: number; deadlineMs?: number; maxChecks?: number; now?: () => number } = {}): Promise<ClaimCheckResult> {
  const now = opts.now ?? Date.now;
  const stopAt = now() + (opts.deadlineMs ?? 25_000);
  const parts = text.split(/(?<=[.!?])(\s+)/);
  const jobs: { index: number; sentence: string; passages: string }[] = [];
  let noText = 0;
  parts.forEach((part, index) => {
    const numbers = [...part.matchAll(/\[(\d{1,3})\]/g)].map((m) => Number(m[1]));
    if (numbers.length === 0) return;
    const passages = [...new Set(numbers)].map((n) => (evidence[n - 1] ?? "").trim()).filter(Boolean).join("\n---\n");
    if (passages === "") { noText += 1; return; }
    jobs.push({ index, sentence: part.trim(), passages });
  });
  const limited = jobs.slice(0, opts.maxChecks ?? 24);
  const unsupportedAt = new Set<number>();
  let checked = 0;
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < limited.length && now() < stopAt) {
      const job = limited[next++]!;
      let reply: string | null = null;
      try { reply = await judge(claimPrompt(job.sentence.replace(/"/g, "'"), job.passages)); } catch { reply = null; }
      if (reply === null) continue;
      checked += 1;
      const supported = (() => { try { return (JSON.parse(reply.match(/\{[\s\S]*?\}/)?.[0] ?? "{}") as { supported?: unknown }).supported !== false; } catch { return true; } })();
      if (!supported) unsupportedAt.add(job.index);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 3) }, () => worker()));
  const out = parts.map((part, index) => {
    if (!unsupportedAt.has(index)) return part;
    const bare = part.replace(/\s?\[\d{1,3}\]/g, "").replace(/\s+$/, "");
    const punct = bare.match(/[.!?]$/)?.[0] ?? "";
    return `${punct ? bare.slice(0, -1) : bare}${CLAIM_UNCONFIRMED}${punct}`;
  });
  return { text: out.join(""), checked, unsupported: unsupportedAt.size, skipped: noText + (jobs.length - checked) };
}

const QUERY_NAME = /\b[A-Z][a-z]+(?:\s+(?:[A-Z]\.|[A-Z][a-z]+)){1,2}\b/g;
const QUERY_YEAR = /\b(?:19|20)\d{2}\b/g;

/** Names and years a search query carries that neither the person's question nor anything the searches returned has shown: details
 * the model supplied from its own memory. A research query built on one can aim at the wrong subject (the live V run searched a
 * miniseries' year and a producer's name for a different, later show), so such a search waits until a source has shown the detail. */
export function memoryDetailsIn(query: string, allowedText: string): string[] {
  const allowed = allowedText.toLowerCase();
  const found = [...(query.match(QUERY_NAME) ?? []), ...(query.match(QUERY_YEAR) ?? [])];
  return [...new Set(found.filter((detail) => !allowed.includes(detail.toLowerCase())))];
}

/** The query with those memory details taken out and the spaces closed up ("V 1984 TV series finale" becomes "V TV series finale"). */
export function withoutMemoryDetails(query: string, allowedText: string): string {
  let cleaned = query;
  for (const detail of memoryDetailsIn(query, allowedText)) cleaned = cleaned.split(detail).join(" ");
  return cleaned.replace(/\s{2,}/g, " ").trim();
}

/** Said to the model in the next round when a search of this turn ran without a name or year from memory. */
export const MEMORY_QUERY_SKIPPED_NOTE = "A search ran without a name or year that neither the question nor any source had shown yet; find out from the sources who made it and when, then use the names and dates they show.";

/** One model call that writes searches: a prompt in, text out, or null when the model is unavailable. */
export type QueryWriter = (prompt: string) => Promise<string | null>;

/** The titles the searches so far returned, one per line with their site, for the query writer to take names from. */
export function resultDigest(outcomes: readonly ToolExecutionOutcome[], max = 24): string {
  const lines: string[] = [];
  for (const outcome of outcomes) {
    if (outcome.packageId !== "websearch") continue;
    const data = outcome.result?.data as { rows?: { title?: unknown; snippet?: unknown; url?: unknown }[] } | undefined;
    for (const row of data?.rows ?? []) {
      if (lines.length >= max) return lines.join("\n");
      const site = typeof row.url === "string" ? (() => { try { return new URL(row.url).hostname.replace(/^www\./, ""); } catch { return ""; } })() : "";
      lines.push(`- ${site}: ${String(row.title ?? "").slice(0, 110)}. ${String(row.snippet ?? "").slice(0, 140)}`);
    }
  }
  return lines.join("\n");
}

/** The prompt for the query writer: a dedicated step that writes the next searches for this question. It names no subject and no
 * angle of its own; the angles come from the question and the names from the question and the results already read. */
export function queryWriterPrompt(utterance: string, progress: ResearchProgress, digest: string, count: number, anchorNote = ""): string {
  const searched = progress.queries.length > 0 ? progress.queries.map((q) => `- ${q}`).join("\n") : "(none yet)";
  const found = digest.trim() === "" ? "(nothing read yet)" : digest;
  return `You write web searches for a research assistant.
The person asked: "${utterance.replace(/"/g, "'")}"
${anchorNote ? `${anchorNote}\n` : ""}
Searches already run:
${searched}

What the results showed so far (site: title, snippet):
${found}

${digest.trim() === "" ? "Nothing has been read yet, so write only searches that identify the subject and how it turned out: what it is, when it was made or aired, who made it, how it ended. Include no person's name and no year unless the question gave it.\n" : ""}Write up to ${count} new web searches. Rules:
- Each search is specific: the exact name of the subject, the year or version when known, and ONE angle. A search with only a bare name is too vague.
- Choose the angles that matter for this particular question and vary them (what happened and why; what the people involved said in interviews or official statements; what came after; how it was received; the original documents). Split a question that has several parts into one search per part.
- Take names only from the question, the pinned subject or the results shown above. Never add a name from your own memory. If the results do not yet say who made or ran the subject, write a search that finds that first.
- Write plain keyword searches of 3 to 8 words: no quotation marks, no "or", no operators. The search engines return nothing for them.
- Never repeat or lightly reword a search already run. If a result was thin, write the search again with the names and titles the results gave.
- For any part of the question still unanswered or backed by one site, write a search that targets it.
Reply with one JSON object and nothing else: {"queries": ["...", "..."]}`;
}

/** RESEARCH-QUERY-04: a planned search is plain keywords of at most eight words. The engines return nothing for the long quoted and OR forms
 * (8 of 20 searches of one live run), so a query is cleaned and cut to its first eight words here, whoever wrote it. */
export function shortKeywordQuery(query: string, maxWords = 8): string {
  const cleaned = plainQuery(query);
  const words = cleaned.split(/\s+/).filter(Boolean);
  return words.length > maxWords ? words.slice(0, maxWords).join(" ") : cleaned;
}

export function parsePlannedQueries(text: string): string[] {
  try {
    const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "{}") as { queries?: unknown };
    return Array.isArray(parsed.queries) ? parsed.queries.filter((q): q is string => typeof q === "string").map((q) => shortKeywordQuery(q.trim().slice(0, 200))).filter((q) => q.length > 3 && q.split(/\s+/).length >= 2) : [];
  } catch {
    return [];
  }
}

/** The searches the writer proposes, minus any that repeats an earlier search of the turn or an earlier proposal. Empty when the writer is unavailable. */
export async function writeQueries(writer: QueryWriter, utterance: string, progress: ResearchProgress, digest: string, count: number, anchorNote = ""): Promise<string[]> {
  return (await writeQueriesChecked(writer, utterance, progress, digest, count, anchorNote))?.queries ?? [];
}

/** The same, but with the writer's own count: `proposed` is how many searches it wrote before any were filtered out, so a caller can tell
 * "the writer sees nothing more to search" (0) from "everything it wrote was a repeat or built on a name from memory" (more than 0 but
 * `queries` empty). Null when the writer is unavailable. */
export async function writeQueriesChecked(writer: QueryWriter, utterance: string, progress: ResearchProgress, digest: string, count: number, anchorNote = ""): Promise<{ queries: string[]; proposed: number } | null> {
  let reply: string | null = null;
  try { reply = await writer(queryWriterPrompt(utterance, progress, digest, count, anchorNote)); } catch { reply = null; }
  if (reply === null) return null;
  const planned = parsePlannedQueries(reply);
  const kept: string[] = [];
  // A name or year the model supplied from memory is not filtered out here: the tool node runs the search without it (RESEARCH-QUERY-03).
  for (const query of planned) if (!isRepeatQuery([...progress.queries, ...kept], query)) kept.push(query);
  return { queries: kept.slice(0, count), proposed: planned.length };
}

/** Added to a research round's note when the query writer proposed searches. The model still chooses what to search. */
export function suggestedSearchesNote(queries: readonly string[]): string {
  if (queries.length === 0) return "";
  return ` Searches worth running, written for this question: ${queries.map((q) => `"${q.replace(/"/g, "'")}"`).join("; ")}. Run them one at a time, reword one if you have a better idea, and skip any that no longer matter.`;
}
