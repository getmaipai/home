// RESEARCH-PIPELINE-01: the five stages of a Thinking or Max research turn, one function each with a typed hand-off to the next, so
// each can be tested and timed alone (Jesse's stage names):
//   1. understand  - what is this person asking (the Brief)
//   2. planData    - what data is needed: the sub-questions and the searches that fetch them (the DataPlan)
//   3. findings    - grab and filter: the page notes, de-duplicated and ranked, as a Ledger (the Findings); the searching and the page notes
//                    are done by the tool node and pageNotes.ts, this file filters what they produced
//   4. analyse     - an analysis before any writing: what is established, reported, contested, missing, and the labelled guesses (the Analysis)
//   5. replyBrief  - the instruction the writing round gets: the analysis and the ledger, in the order the answer should follow
// No prompt here names a subject or a kind of question.
import { complete } from "@/lib/llm";
import { notesLedger, squash, type Ledger, type PageKind, type PageNote } from "./pageNotes";
import { isRepeatQuery, queryWriterPrompt, researchProgress, type AnswerStyle, type QueryWriter } from "./research";

/** One model call: a prompt in, text out, or null when the model is unavailable. */
export type StageWriter = (prompt: string) => Promise<string | null>;

let briefOverride: StageWriter | undefined;
let analysisOverride: StageWriter | undefined;
/** Tests: replace the stage 1 and stage 4 model calls; undefined restores them. */
export function __setStageWritersForTests(writers: { brief?: StageWriter | undefined; analysis?: StageWriter | undefined } | undefined): void {
  briefOverride = writers?.brief;
  analysisOverride = writers?.analysis;
}

/** Stage 1 runs on the chat model without thinking (about 2 to 3 seconds): the small model took a TV show for a person's life story and
 * never found a question underspecified. */
function chatBriefWriter(signal?: AbortSignal): StageWriter {
  return async (prompt) => {
    const result = await complete("chat", [{ role: "user", content: prompt }], { max_tokens: 300, temperature: 0.1, thinking: false, ...(signal ? { signal } : {}) });
    return result.ok ? result.value.text : null;
  };
}
function chatAnalysisWriter(maxTokens: number, signal?: AbortSignal): StageWriter {
  return async (prompt) => {
    const result = await complete("chat", [{ role: "user", content: prompt }], { max_tokens: maxTokens, temperature: 0.2, thinking: false, ...(signal ? { signal } : {}) });
    return result.ok ? result.value.text : null;
  };
}

const jsonOf = (text: string | null): Record<string, unknown> | null => {
  if (text === null) return null;
  try { const parsed: unknown = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? ""); return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null; } catch { return null; }
};
const strings = (value: unknown, max: number, each: number): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).slice(0, max).map((v) => v.trim().slice(0, each)) : [];

// ---------------------------------------------------------------- stage 1: what is this person asking

export interface Brief {
  /** What the question is about, in a few words. */
  subject: string;
  /** The shape of a good answer (an explanation, a comparison, a list of steps, a prediction with reasons...). */
  answerType: string;
  /** What a good answer must contain for THIS question. */
  mustContain: string[];
  /** True only when the question could mean different things that would need different research AND nothing the person said settles it. */
  ambiguous: boolean;
  /** When ambiguous: up to three short labels, one per reading (empty when the question names no subject at all). */
  options: string[];
  /** When ambiguous: the one short question to ask the person. */
  question: string;
  /** One plain sentence saying what the question was taken to mean. */
  assumption: string;
}

export function briefPrompt(utterance: string, recent: string): string {
  return `You read a question to work out exactly what is being asked, before any research starts.
The person asked: "${utterance.replace(/"/g, "'")}"
${recent.trim() ? `\nThe conversation so far, most recent last:\n${recent.trim()}\n` : ""}
Answer with one JSON object and nothing else:
{"subject": "what it is about, in a few words", "answer_type": "the shape of a good answer", "must_contain": ["up to 5 things a good answer must contain for this question"], "ambiguous": false, "options": [], "question": "", "assumption": "one plain sentence: what you took the question to mean"}
Use only what the question and the conversation say; add no detail of your own to "subject" or "assumption".
"ambiguous" is true ONLY when it is unclear WHAT is meant (which version, edition, person, product, event, or what subject at all) AND neither the question's own words nor the conversation so far settle it. If the words already point to one reading, "ambiguous" is false. When true, "options" holds two or three short labels naming the readings themselves (never a description of the person, never "missing context"), or is empty when the question names no subject at all, and "question" is the one short question to ask ("Do you mean the A or the B?" or "Which one do you mean?").`;
}

export function parseBrief(text: string | null): Brief | null {
  const data = jsonOf(text);
  if (!data) return null;
  const subject = typeof data.subject === "string" ? data.subject.trim().slice(0, 120) : "";
  if (!subject) return null;
  const options = strings(data.options, 3, 80);
  const question = typeof data.question === "string" ? data.question.trim().slice(0, 140) : "";
  return {
    subject,
    answerType: typeof data.answer_type === "string" ? data.answer_type.trim().slice(0, 120) : "",
    mustContain: strings(data.must_contain, 5, 160),
    ambiguous: data.ambiguous === true && (options.length >= 2 || question !== ""),
    options: data.ambiguous === true ? options : [],
    question: data.ambiguous === true ? question : "",
    assumption: typeof data.assumption === "string" ? data.assumption.trim().slice(0, 200) : "",
  };
}

export async function understand(utterance: string, recent: string, signal?: AbortSignal): Promise<Brief | null> {
  let reply: string | null = null;
  try { reply = await (briefOverride ?? chatBriefWriter(signal))(briefPrompt(utterance, recent)); } catch { reply = null; }
  return parseBrief(reply);
}

/** The marker every clarifying question of ours starts with, so a later turn can tell it was asked. */
export const CLARIFY_MARK = "Before I research this";
/** The question a Max turn asks: the readings when there are two or more, otherwise the model's own short question. */
export function clarifyingQuestion(brief: Brief): string {
  const labels = brief.options.map((o) => o.replace(/[.?!]+$/, ""));
  const ask = labels.length >= 2 ? `which one do you mean: ${labels.length === 2 ? labels.join(" or ") : `${labels.slice(0, -1).join(", ")} or ${labels.at(-1)}`}?` : brief.question || "what exactly do you want me to look into?";
  return `${CLARIFY_MARK}, ${ask.charAt(0).toLowerCase()}${ask.slice(1)} Say "pick for me" if you are not sure.`;
}
/** True once an earlier assistant message of this conversation asked this kind of question (it is not asked twice). */
export const askedBefore = (history: readonly { role: string; content?: unknown }[]): boolean =>
  history.some((m) => m.role === "assistant" && typeof m.content === "string" && m.content.includes(CLARIFY_MARK));
/** The question the stages work on. When the previous assistant message was our clarifying question, the person's reply ("the 1984 one",
 * "pick for me") is an answer to it, so the stages get the original question with the reading appended. */
export function researchQuestion(history: readonly { role: string; content?: unknown }[], utterance: string): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]!;
    if (m.role !== "assistant" || typeof m.content !== "string") continue;
    if (!m.content.includes(CLARIFY_MARK)) return utterance;
    const original = history.slice(0, i).reverse().find((h) => h.role === "user" && typeof h.content === "string");
    return original ? `${String(original.content)} (meaning: ${utterance})` : utterance;
  }
  return utterance;
}
/** Whether a Max turn should ask instead of researching: ambiguous, with a question to ask, and not asked before. */
export const shouldAsk = (brief: Brief | null, history: readonly { role: string; content?: unknown }[]): boolean =>
  brief !== null && brief.ambiguous && (brief.options.length >= 2 || brief.question !== "") && !askedBefore(history);

// ---------------------------------------------------------------- stage 2: what data do I need

export interface DataPlan { subQuestions: string[]; queries: string[] }

export function briefBlock(brief: Brief): string {
  return `What the person is asking: ${brief.subject}. A good answer is: ${brief.answerType || "a complete answer"}. It must contain: ${brief.mustContain.length > 0 ? brief.mustContain.join("; ") : "what the question asks"}.`;
}

export async function planData(writer: QueryWriter, brief: Brief | null, utterance: string, count: number, anchorNote = ""): Promise<DataPlan> {
  const base = queryWriterPrompt(utterance, researchProgress([]), "", count, anchorNote);
  const prompt = brief ? `${briefBlock(brief)}\n\n${base}\nAlso list, in "sub_questions", the 3 to 6 parts of the question that the searches must answer, so the reply is {"sub_questions": ["..."], "queries": ["..."]}.` : base;
  let reply: string | null = null;
  try { reply = await writer(prompt); } catch { reply = null; }
  const data = jsonOf(reply);
  if (!data) return { subQuestions: [], queries: [] };
  const kept: string[] = [];
  // A name or year from memory stays in the plan: the tool node runs the search without it (RESEARCH-QUERY-03).
  for (const query of strings(data.queries, 12, 140)) if (query.length > 3 && !isRepeatQuery(kept, query)) kept.push(query);
  return { subQuestions: strings(data.sub_questions, 6, 160), queries: kept.slice(0, count) };
}

// ---------------------------------------------------------------- stage 3: grab and filter

export interface Findings { notes: PageNote[]; ledger: Ledger; read: number; dropped: number }

const words = (text: string): Set<string> => new Set(squash(text).split(/[^a-z0-9]+/).filter((w) => w.length > 3));
const similar = (a: string, b: string): boolean => {
  const x = words(a), y = words(b);
  if (x.size === 0 || y.size === 0) return false;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared += 1;
  return shared / Math.min(x.size, y.size) >= 0.8;
};
const HIGHER: PageKind[] = ["primary", "reputable"];

/** The notes after filtering: a repeated quote or a near-identical note is kept once (the one from the better page), a note that adds
 * little (weight 1) goes when its part of the question has stronger notes, and a fan page's note goes when that part already has two
 * from a primary or reputable page. Then the ledger under its character budget. */
export function filterFindings(notes: readonly PageNote[], numberOf: ReadonlyMap<string, number>, budgetChars: number): Findings {
  const rank = (n: PageNote): number => (n.kind === "primary" ? 0 : n.kind === "reputable" ? 1 : n.kind === "fan" ? 2 : 3);
  const sorted = [...notes].sort((a, b) => rank(a) - rank(b) || b.weight - a.weight);
  const kept: PageNote[] = [];
  for (const note of sorted) {
    if (kept.some((k) => squash(k.quote) === squash(note.quote) || (squash(k.topic) === squash(note.topic) && similar(k.note, note.note)))) continue;
    kept.push(note);
  }
  const byTopic = new Map<string, PageNote[]>();
  for (const note of kept) byTopic.set(squash(note.topic), [...(byTopic.get(squash(note.topic)) ?? []), note]);
  const final = kept.filter((note) => {
    const group = byTopic.get(squash(note.topic)) ?? [];
    if (note.weight === 1 && group.filter((g) => g.weight >= 2).length >= 2) return false;
    if (note.kind === "fan" && group.filter((g) => HIGHER.includes(g.kind)).length >= 2) return false;
    return true;
  });
  const ledger = notesLedger(final, numberOf, budgetChars);
  return { notes: final, ledger, read: new Set(notes.map((n) => n.url)).size, dropped: notes.length - final.length };
}

// ---------------------------------------------------------------- stage 4: the analysis

export type ClaimStatus = "established" | "reported" | "inferred" | "contested";
export interface AnalysisClaim { claim: string; status: ClaimStatus; sources: number[] }
export interface AnalysisGuess { guess: string; because: string[]; confidence: "low" | "medium" | "high"; sources: number[] }
export interface Analysis { claims: AnalysisClaim[]; conflicts: string[]; gaps: string[]; guesses: AnalysisGuess[] }

export const ANALYSIS_TOKENS = { thinking: 350, max: 650 } as const;

export function analysisPrompt(brief: Brief | null, question: string, ledger: string, backbone = ""): string {
  return `You analyse research notes before an answer is written. You write no answer here.
The question: "${question.replace(/"/g, "'")}"
${brief ? `${briefBlock(brief)}\n` : ""}
${backbone ? `${backbone}\n\n` : ""}${ledger}

Work from these notes and the article only. Answer with one JSON object and nothing else:
{"claims": [{"claim": "one plain sentence", "status": "established", "sources": [1]}], "conflicts": ["where notes disagree, in one sentence each"], "gaps": ["what the question needs that no note covers"], "guesses": [{"guess": "a likely answer to the part nothing settles", "because": ["the notes it rests on, in your words"], "confidence": "low", "sources": [1]}]}
"status" is "established" when a primary or reputable note states it, "reported" when only a fan page or a single secondhand note does, "contested" when notes disagree, and "inferred" when it follows from notes but none says it. "sources" are the [n] numbers of the notes. Every guess must rest on at least one note and say how sure you are ("low", "medium" or "high"). Use at most 8 claims and 4 guesses.`;
}

export function parseAnalysis(text: string | null, valid: ReadonlySet<number>): Analysis | null {
  const data = jsonOf(text);
  if (!data) return null;
  const nums = (value: unknown): number[] => (Array.isArray(value) ? value.filter((v): v is number => typeof v === "number" && valid.has(v)) : []);
  const statuses: ClaimStatus[] = ["established", "reported", "inferred", "contested"];
  const claims: AnalysisClaim[] = [];
  for (const raw of Array.isArray(data.claims) ? data.claims.slice(0, 8) : []) {
    const r = (raw ?? {}) as { claim?: unknown; status?: unknown; sources?: unknown };
    const claim = typeof r.claim === "string" ? r.claim.trim().slice(0, 260) : "";
    const status = statuses.find((s) => s === r.status) ?? "reported";
    const sources = nums(r.sources);
    if (claim && (sources.length > 0 || status === "inferred")) claims.push({ claim, status: sources.length === 0 ? "inferred" : status, sources });
  }
  const guesses: AnalysisGuess[] = [];
  for (const raw of Array.isArray(data.guesses) ? data.guesses.slice(0, 4) : []) {
    const r = (raw ?? {}) as { guess?: unknown; because?: unknown; confidence?: unknown; sources?: unknown };
    const guess = typeof r.guess === "string" ? r.guess.trim().slice(0, 260) : "";
    const because = strings(r.because, 3, 200);
    const confidence = r.confidence === "high" || r.confidence === "medium" ? r.confidence : "low";
    if (guess && because.length > 0) guesses.push({ guess, because, confidence, sources: nums(r.sources) });
  }
  return { claims, conflicts: strings(data.conflicts, 4, 240), gaps: strings(data.gaps, 5, 200), guesses };
}

export async function analyse(brief: Brief | null, question: string, findings: Findings, validNumbers: ReadonlySet<number>, style: AnswerStyle, signal?: AbortSignal, backbone = ""): Promise<Analysis | null> {
  if (findings.ledger.notes === 0 && !backbone) return null;
  const tokens = style === "max" ? ANALYSIS_TOKENS.max : ANALYSIS_TOKENS.thinking;
  let reply: string | null = null;
  try { reply = await (analysisOverride ?? chatAnalysisWriter(tokens, signal))(analysisPrompt(brief, question, findings.ledger.text, backbone)); } catch { reply = null; }
  return parseAnalysis(reply, validNumbers);
}

// ---------------------------------------------------------------- stage 5: the reply

const cites = (sources: readonly number[]): string => sources.map((n) => `[${n}]`).join("");

/** What the writing round is handed: the analysis first (what to say, how sure), then the notes behind it. */
export function replyBrief(brief: Brief | null, analysis: Analysis | null, ledger: string, assumption: string | null): string {
  const lines: string[] = [];
  if (assumption) lines.push(`Begin with one plain sentence saying what you took the question to mean: "${assumption.replace(/"/g, "'")}"`);
  if (analysis && (analysis.claims.length > 0 || analysis.guesses.length > 0)) {
    lines.push("Analysis of the notes (write the answer from it):");
    for (const status of ["established", "reported", "contested", "inferred"] as const) {
      const group = analysis.claims.filter((c) => c.status === status);
      if (group.length > 0) lines.push(`${status}:\n${group.map((c) => `- ${c.claim} ${cites(c.sources)}`.trim()).join("\n")}`);
    }
    if (analysis.conflicts.length > 0) lines.push(`Where the notes disagree:\n${analysis.conflicts.map((c) => `- ${c}`).join("\n")}`);
    if (analysis.gaps.length > 0) lines.push(`Not found:\n${analysis.gaps.map((g) => `- ${g}`).join("\n")}`);
    if (analysis.guesses.length > 0) lines.push(`Guesses to present as guesses, each with its reasons:\n${analysis.guesses.map((g) => `- (${g.confidence}) ${g.guess} because ${g.because.join("; ")} ${cites(g.sources)}`.trim()).join("\n")}`);
    lines.push(`Write the answer like this: the direct answer first${brief?.mustContain.length ? `, covering ${brief.mustContain.join("; ")}` : ""}; then the established points with their [n]; then a section clearly labelled as your guesses, with the evidence behind each; then what could not be found. Add no fact the analysis and notes do not carry.`);
  }
  if (ledger) lines.push(ledger);
  return lines.join("\n\n");
}

