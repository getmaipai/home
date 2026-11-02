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
import { namesIn, nameIsGiven, squashText } from "./fabrication";
import { nodeSignal } from "./deadline";
import { isRepeatQuery, queryWriterPrompt, researchProgress, shortKeywordQuery, type AnswerStyle, type QueryWriter } from "./research";

/** One model call: a prompt in, text out, or null when the model is unavailable. */
export type StageWriter = (prompt: string) => Promise<string | null>;

let briefOverride: StageWriter | undefined;
let analysisOverride: StageWriter | undefined;
/** Tests: replace the stage 1 and stage 4 model calls; undefined restores them. */
export function __setStageWritersForTests(writers: { brief?: StageWriter | undefined; analysis?: StageWriter | undefined } | undefined): void {
  briefOverride = writers?.brief;
  analysisOverride = writers?.analysis;
}

/** Stage 1 runs on the chat model without thinking (about 2 to 3 seconds): the small model took a title for a person's life story and
 * never found a question underspecified. */
function chatBriefWriter(signal?: AbortSignal): StageWriter {
  return async (prompt) => {
    const result = await complete("chat", [{ role: "user", content: prompt }], { max_tokens: 300, temperature: 0.1, thinking: false, ...(signal ? { signal } : {}) });
    return result.ok ? result.value.text : null;
  };
}
/** The time one research-stage call (query writer, analysis) may take: 15 s plus 50 ms per token it may write (about 20 tokens a second), at most
 * 60 s. The cap keeps one lost stage from eating the whole two-minute research budget; the 30 s client default was too short for a long reply
 * from an engine under load. */
export function stageTimeoutMs(maxTokens: number): number {
  return Math.min(60_000, 15_000 + maxTokens * 50);
}

function chatAnalysisWriter(maxTokens: number, signal?: AbortSignal): StageWriter {
  return async (prompt) => {
    const result = await complete("chat", [{ role: "user", content: prompt }], { max_tokens: maxTokens, temperature: 0.2, thinking: false, timeoutMs: stageTimeoutMs(maxTokens), ...(signal ? { signal } : {}) });
    return result.ok ? result.value.text : null;
  };
}

/** A reply cut off inside its JSON object, closed up: an open string is ended, a dangling comma or key dropped, and the open brackets closed in
 * order. What was complete before the cut is kept; the one half-written item is closed where it stands. */
export function repairJson(text: string): string {
  const start = text.indexOf("{");
  if (start < 0) return "";
  const body = text.slice(start);
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of body) {
    if (inString) { if (escaped) escaped = false; else if (ch === "\\") escaped = true; else if (ch === '"') inString = false; continue; }
    if (ch === '"') inString = true;
    else if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  let out = body;
  if (inString) out += '"';
  // A key with no value, or a trailing comma or colon, cannot close; take it back to the last complete value.
  if (!inString) {
    // A bare word cut off partway ("tr" of true), or a number cut off at its point or sign, cannot be completed: its key goes with it.
    out = out.replace(/,?\s*"[^"]*"\s*:\s*([A-Za-z]+)$/, (whole, word: string) => (["true", "false", "null"].includes(word) ? whole : ""));
    out = out.replace(/([\d])[.eE+-]+$/, "$1").replace(/:\s*[-+.eE]+$/, ": 0");
  }
  out = out.replace(/,\s*$/, "").replace(/,?\s*"[^"]*"\s*:\s*$/, "").replace(/,\s*$/, "");
  return out + stack.reverse().join("");
}

const jsonOf = (text: string | null): Record<string, unknown> | null => {
  if (text === null) return null;
  const whole = text.match(/\{[\s\S]*\}/)?.[0] ?? "";
  for (const candidate of [whole, repairJson(text)]) {
    if (!candidate) continue;
    try { const parsed: unknown = JSON.parse(candidate); if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>; } catch { /* try the repaired form */ }
  }
  return null;
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
  /** Up to three titles an encyclopedia might give the subject (a bracketed qualifier when the name is shared). Only used to look the article
   * up; the pin checks each candidate against the question. */
  titles?: string[];
}

export function briefPrompt(utterance: string, recent: string): string {
  return `You read a question to work out exactly what is being asked, before any research starts.
The person asked: "${utterance.replace(/"/g, "'")}"
${recent.trim() ? `\nThe conversation so far, most recent last:\n${recent.trim()}\n` : ""}
Answer with one JSON object and nothing else:
{"subject": "the thing itself, named as the person named it; never the kind of answer wanted and never a year or name the person did not say", "titles": ["one per work or version the person's words could mean when the name is shared, written as an encyclopedia titles it, with a bracketed qualifier"], "answer_type": "the shape of a good answer", "must_contain": ["up to 5 things a good answer must contain for this question"], "ambiguous": false, "options": [], "question": "", "assumption": "one plain sentence: what you took the question to mean"}
Use only what the question and the conversation say; add no detail of your own to "subject", "assumption" or "must_contain": name there no person, work, place or year the question does not name; describe the part instead ("the main characters", "what it was based on"). "titles" are guesses used only to look the article up, so give them in the form an encyclopedia would use; use [] when the question has no single subject to look up.
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
    titles: strings(data.titles, 3, 100),
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

/** Stage 2's reminder that an answer depends on more than the literal ask. The model words each angle from the question's own subject; nothing here names a topic. */
export const SUB_QUESTION_ANGLES = 'A good answer depends on more than the literal ask. Also fill "angles": {"why_it_stopped_or_changed": "", "what_was_planned_or_announced": "", "what_came_after": "", "who_said_what": ""}: for each key a sub-question worded from this question\'s subject when the question\'s answer rests on it, or "" when it does not.';
/** Stage 2's rule against invented names in the plan (the code guard in `unnamedParts` backs it up). */
export const SUB_QUESTION_NAMES = "A sub-question names only what the question, the pinned subject or the person's words name; a part about people or works not named there is worded without names.";

/** The plan writer gets its own wall-clock deadline (default 10 s). When it is cut, its request is aborted and the plan falls back to the
 * brief's must-contain parts as the sub-questions with no searches (no extra model call); the caller's model round then writes the searches.
 * `cut` tells the caller to log a timeline line. */
export const PLAN_DEADLINE_MS = 10_000;
export async function planDataWithin(
  makeWriter: (signal: AbortSignal) => QueryWriter,
  parent: AbortSignal,
  brief: Brief | null,
  utterance: string,
  count: number,
  anchorNote = "",
  given = "",
  deadlineMs: number = PLAN_DEADLINE_MS,
): Promise<{ plan: DataPlan; cut: boolean }> {
  const { signal, clear } = nodeSignal(parent, deadlineMs);
  const cutPromise = new Promise<"cut">((resolve) => {
    if (signal.aborted) resolve("cut");
    else signal.addEventListener("abort", () => resolve("cut"), { once: true });
  });
  try {
    const winner = await Promise.race([planData(makeWriter(signal), brief, utterance, count, anchorNote, given), cutPromise]);
    if (winner !== "cut") return { plan: winner, cut: false };
    return { plan: { subQuestions: (brief?.mustContain ?? []).map((p) => p.trim()).filter(Boolean).slice(0, 6), queries: [] }, cut: true };
  } finally { clear(); }
}

export async function planData(writer: QueryWriter, brief: Brief | null, utterance: string, count: number, anchorNote = "", given = ""): Promise<DataPlan> {
  const base = queryWriterPrompt(utterance, researchProgress([]), "", count, anchorNote);
  const prompt = brief ? `${briefBlock(brief)}\n\n${base}\nAlso list, in "sub_questions", the 3 to 6 parts of the question that the searches must answer, so the reply is {"sub_questions": ["..."], "angles": {...}, "queries": ["..."]}.\n${SUB_QUESTION_ANGLES} ${SUB_QUESTION_NAMES}` : base;
  let reply: string | null = null;
  try { reply = await writer(prompt); } catch { reply = null; }
  const data = jsonOf(reply);
  if (!data) return { subQuestions: [], queries: [] };
  const kept: string[] = [];
  // A name or year from memory stays in the plan: the tool node runs the search without it (RESEARCH-QUERY-03).
  for (const raw of strings(data.queries, 12, 200)) {
    const query = shortKeywordQuery(raw);
    if (query.length > 3 && query.split(/\s+/).length >= 2 && !isRepeatQuery(kept, query)) kept.push(query);
  }
  const haystack = `${utterance} ${brief?.subject ?? ""} ${given}`;
  if (!brief) return { subQuestions: strings(data.sub_questions, 6, 160), queries: kept.slice(0, count) };
  const subQuestions = unnamedParts(strings(data.sub_questions, 6, 160), haystack);
  // The angles the answer may rest on: each non-empty one joins the list after the model's own, through the same name guard, without repeats.
  const angles = data.angles && typeof data.angles === "object" && !Array.isArray(data.angles) ? Object.values(data.angles as Record<string, unknown>) : [];
  for (const raw of angles) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    // An angle is optional, so one that names what was never given is dropped outright (no fallback to the bracket-stripped text).
    const part = raw.replace(EXAMPLE_LIST, "").trim().slice(0, 160);
    const given = squashText(haystack);
    if (part && namesIn(part).every((name) => nameIsGiven(name, given)) && !subQuestions.some((o) => samePart(o, part))) subQuestions.push(part);
  }
  return { subQuestions, queries: kept.slice(0, count) };
}

// ---------------------------------------------------------------- stage 3: grab and filter

export interface Findings { notes: PageNote[]; ledger: Ledger; read: number; dropped: number }

const words = (text: string): Set<string> => new Set(squash(text).split(/[^a-z0-9]+/).filter((w) => w.length > 3));
/** Two phrasings of one part of a question: half of the shorter one's words are shared. */
const samePart = (a: string, b: string): boolean => {
  const x = words(a), y = words(b);
  if (x.size === 0 || y.size === 0) return false;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared += 1;
  return shared / Math.min(x.size, y.size) >= 0.5;
};
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
export interface Analysis { claims: AnalysisClaim[]; conflicts: string[]; gaps: string[]; guesses: AnalysisGuess[]; /** Parts of the question the notes and the article did not cover (the analysis's own report). */ uncovered: string[] }

const EXAMPLE_LIST = /\s*\((?:e\.g\.|such as|like)[^)]*\)/i;
/** Parts that carry a name the question, the pinned subject or the article never gave are dropped (a name from the model's memory in a
 * part is how an invented person reaches the answer). An example list in brackets is cut first. If every part would go, the parts are
 * kept with that bracketed list removed. Parts with no name pass unchanged. */
export function unnamedParts(parts: readonly string[], given: string): string[] {
  const haystack = squashText(given);
  const stripped = parts.map((p) => p.replace(EXAMPLE_LIST, "").trim()).filter(Boolean);
  const kept = stripped.filter((p) => namesIn(p).every((name) => nameIsGiven(name, haystack)));
  return kept.length > 0 || stripped.length === 0 ? kept : stripped;
}

/** The parts a good answer must cover: what the brief says it must contain, then the plan's sub-questions, without repeats, at most eight. */
export function partsFor(brief: Brief | null, plan: DataPlan | undefined, given = ""): string[] {
  const out: string[] = [];
  const mustContain = brief ? unnamedParts(brief.mustContain, `${given} ${brief.subject}`) : [];
  for (const p of [...mustContain, ...unnamedParts(plan?.subQuestions ?? [], given)]) if (p.trim() && !out.some((o) => similar(o, p))) out.push(p.trim());
  return out.slice(0, 8);
}

/** Output room for the analysis. The reply is a JSON object (claims, conflicts, gaps, guesses and, since RESEARCH-COVERAGE-01, one entry per
 * part of the question): a live Max run returned no analysis at all once that field was added, the reply cut off inside the object. */
/** Claims the analysis may carry: eight, or four more than the parts asked for, so every part can have its own claim first. */
export const claimCap = (parts: number): number => Math.max(8, parts + 4);

export const ANALYSIS_TOKENS = { thinking: 700, max: 1400 } as const;

export function analysisPrompt(brief: Brief | null, question: string, ledger: string, backbone = "", parts: readonly string[] = []): string {
  return `You analyse research notes before an answer is written. You write no answer here.
The question: "${question.replace(/"/g, "'")}"
${brief ? `${briefBlock(brief)}\n` : ""}
${backbone ? `${backbone}\n\n` : ""}${ledger}

Work from these notes and the article only. Answer with one JSON object and nothing else:
{"claims": [{"claim": "one plain sentence", "status": "established", "sources": [1]}],${parts.length > 0 ? ' "parts": [{"part": "the part, copied as written below", "covered": true}],' : ""} "conflicts": ["where notes disagree, in one sentence each"], "gaps": ["what the question needs that no note covers"], "guesses": [{"guess": "a likely answer to the part nothing settles", "because": ["the notes it rests on, in your words"], "confidence": "low", "sources": [1]}]}
"status" is "established" when a primary or reputable note states it, "reported" when only a fan page or a single secondhand note does, "contested" when notes disagree, and "inferred" when it follows from notes but none says it. "sources" are the [n] numbers of the notes. Every guess must rest on at least one note and say how sure you are ("low", "medium" or "high"). ${parts.length > 0 ? `\nThe parts a good answer must cover:\n${parts.map((p, i) => `${i + 1}. ${p}`).join("\n")}\nIn "parts" list every one; "covered" is true only when a claim above states something for that part from the notes or the article, false when nothing there speaks to it.\n` : ""}Write the claims part by part: for every part listed above that the notes or the article speak to, first one claim stating what they say for it, in the part's own words; only then add further claims. Read the article to its end, later sections included, before marking a part not covered. Use at most ${claimCap(parts.length)} claims and 4 guesses, each in one short sentence. Name no person, title, number or detail that the notes and the article do not contain.`;
}

export function parseAnalysis(text: string | null, valid: ReadonlySet<number>, asked: readonly string[] = []): Analysis | null {
  const data = jsonOf(text);
  if (!data) return null;
  const nums = (value: unknown): number[] => (Array.isArray(value) ? value.filter((v): v is number => typeof v === "number" && valid.has(v)) : []);
  const statuses: ClaimStatus[] = ["established", "reported", "inferred", "contested"];
  const claims: AnalysisClaim[] = [];
  for (const raw of Array.isArray(data.claims) ? data.claims.slice(0, claimCap(asked.length)) : []) {
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
  const uncovered: string[] = [];
  for (const raw of Array.isArray(data.parts) ? data.parts.slice(0, 8) : []) {
    const r = (raw ?? {}) as { part?: unknown; covered?: unknown };
    const part = typeof r.part === "string" ? r.part.trim() : "";
    // The part is matched back to the ones asked for, so the report names the question's own wording.
    const own = asked.find((a) => samePart(a, part)) ?? (asked.length === 0 ? part : "");
    if (own && r.covered === false && !uncovered.includes(own)) uncovered.push(own);
  }
  return { claims, conflicts: strings(data.conflicts, 4, 240), gaps: strings(data.gaps, 5, 200), guesses, uncovered };
}

export async function analyse(brief: Brief | null, question: string, findings: Findings, validNumbers: ReadonlySet<number>, style: AnswerStyle, signal?: AbortSignal, backbone = "", parts: readonly string[] = [], trace?: (what: string) => void): Promise<Analysis | null> {
  if (findings.ledger.notes === 0 && !backbone) return null;
  const tokens = style === "max" ? ANALYSIS_TOKENS.max : ANALYSIS_TOKENS.thinking;
  let reply: string | null = null;
  try { reply = await (analysisOverride ?? chatAnalysisWriter(tokens, signal))(analysisPrompt(brief, question, findings.ledger.text, backbone, parts)); } catch { reply = null; }
  const parsed = parseAnalysis(reply, validNumbers, parts);
  if (!parsed && trace) trace(reply === null ? "analysis: the model gave no reply" : `analysis: reply of ${reply.length} chars could not be read (ends "${reply.slice(-50).replace(/\s+/g, " ")}")`);
  return parsed;
}

// ---------------------------------------------------------------- stage 5: the reply

const cites = (sources: readonly number[]): string => sources.map((n) => `[${n}]`).join("");

/** Words in the answer the writing round aims for, by style (a target in the prompt, never a cap: an adult's written answer has none). */
export const ANSWER_WORDS = { thinking: 300, max: 450 } as const;

export interface ReplyCoverage {
  /** Text of the article's sections read for parts the notes did not cover. */
  read?: string;
  /** Parts no note and no section covers: the answer says they were not found in the sources. */
  missing?: readonly string[];
  /** The style's word target. */
  words?: number;
  /** The parts a good answer must cover (`partsFor`); the writing round is told to cover all of them. Absent: the brief's must-contain items. */
  parts?: readonly string[];
  /** The pinned article's title and the other articles of the same name that were passed over. */
  pinned?: { title: string; alternatives: readonly string[]; /** The runner-up and its opening when the question's details did not decide between two. */ unsettled?: { title: string; lead: string } };
}

/** What the writing round is handed: the analysis first (what to say, how sure), then the notes behind it. */
export function replyBrief(brief: Brief | null, analysis: Analysis | null, ledger: string, assumption: string | null, coverage: ReplyCoverage = {}): string {
  const lines: string[] = [];
  if (assumption) lines.push(`Begin with one plain sentence saying what you took the question to mean: "${assumption.replace(/"/g, "'")}"`);
  const analysed = !!analysis && (analysis.claims.length > 0 || analysis.guesses.length > 0);
  if (analysis && analysed) {
    lines.push("Analysis of the notes (write the answer from it):");
    for (const status of ["established", "reported", "contested", "inferred"] as const) {
      const group = analysis.claims.filter((c) => c.status === status);
      if (group.length > 0) lines.push(`${status}:\n${group.map((c) => `- ${c.claim} ${cites(c.sources)}`.trim()).join("\n")}`);
    }
    if (analysis.conflicts.length > 0) lines.push(`Where the notes disagree:\n${analysis.conflicts.map((c) => `- ${c}`).join("\n")}`);
    if (analysis.gaps.length > 0) lines.push(`Not found:\n${analysis.gaps.map((g) => `- ${g}`).join("\n")}`);
    if (analysis.guesses.length > 0) lines.push(`Guesses to present as guesses, each with its reasons:\n${analysis.guesses.map((g) => `- (${g.confidence}) ${g.guess} because ${g.because.join("; ")} ${cites(g.sources)}`.trim()).join("\n")}`);
    if (coverage.read) lines.push(`More of the article, read for the parts the notes did not cover (use it for those parts and cite the article. A part that the analysis, the notes, the article or this text speaks to is answered from them and is never listed as not found; only a part none of them speaks to is written as not found in the sources):\n${coverage.read}`);
    if (coverage.missing && coverage.missing.length > 0) lines.push(`Nothing in the notes or the article speaks to: ${coverage.missing.map((m) => `"${m.replace(/"/g, "'")}"`).join("; ")}. For each of these write that it was not found in the sources; state no fact for it, and name no example, title or person it might have been (a name you cannot find in the sources is never written, not even as a thing that is missing).`);
  }
  // The answer's shape (what the first sentence names, the shared-name line, the parts to cover, no invented fact, the word target) holds with or
  // without an analysis: a missing analysis (the stage failed or timed out) must not leave the writer without it.
  const shapeParts = coverage.parts?.length ? coverage.parts : brief?.mustContain ?? [];
  if (analysed || shapeParts.length > 0 || coverage.pinned || brief) {
    if (coverage.pinned?.unsettled) lines.push(`The question's details do not tell "${coverage.pinned.title.replace(/"/g, "'")}" from "${coverage.pinned.unsettled.title.replace(/"/g, "'")}". The notes and the article are about the first. The second opens: ${coverage.pinned.unsettled.lead.replace(/"/g, "'")} In the first sentence say which one you read and that the question fits both, then cover the other one briefly from that opening (marked as read from its opening only), or say which one you chose and why.`);
    else if (coverage.pinned && coverage.pinned.alternatives.length > 0) lines.push(`The subject's name is shared: besides "${coverage.pinned.title.replace(/"/g, "'")}" there are ${coverage.pinned.alternatives.map((t) => `"${t.replace(/"/g, "'")}"`).join("; ")}. The notes and the article are about "${coverage.pinned.title.replace(/"/g, "'")}". Say in the first sentence which one you took the question to mean (its name and year), and when the question's own details did not settle it, say so there and name the other.`);
    const covering = shapeParts.length ? `, covering ${shapeParts.join("; ")}` : "";
    const words = coverage.words ? ` Aim for about ${coverage.words} words, and use more only if the question truly needs it.` : "";
    if (analysed) lines.push(`Write the answer like this: the direct answer first, in a first sentence that names what the question is about in full (the subject by its proper name, with what identifies it, such as its year, place or version)${covering}; then the established points with their [n]; then a section clearly labelled as your guesses, with the evidence behind each (only the guesses listed above, phrased freely: add no guess of your own, and name no person, company, place or title in it that the analysis or notes do not name); then what could not be found (only parts no source speaks to; a fact you stated above is never listed there). Add no fact the analysis and notes do not carry.${words}`);
    else lines.push(`Write the answer like this: the direct answer first, in a first sentence that names what the question is about in full (the subject by its proper name, with what identifies it, such as its year, place or version)${covering}; then the points the notes and the article support, each with its [n]; then what could not be found (only parts no source speaks to; a fact you stated above is never listed there). Add no fact the notes and the article do not carry.${words}`);
  }
  if (ledger) lines.push(ledger);
  return lines.join("\n\n");
}

/** The notes the analysis relied on, as a ledger: only the notes whose source number it cites (all of them when it cites none), inside `budgetChars`.
 * The writing round is handed this instead of every note, so it reads only what the answer needs. */
export function ledgerForAnalysis(notes: readonly PageNote[], analysis: Analysis | null, numberOf: ReadonlyMap<string, number>, budgetChars: number): Ledger {
  if (!analysis) return notesLedger(notes, numberOf, budgetChars);
  const cited = new Set<number>([...analysis.claims.flatMap((c) => c.sources), ...analysis.guesses.flatMap((g) => g.sources)]);
  if (cited.size === 0) return notesLedger(notes, numberOf, budgetChars);
  const subset = notes.filter((n) => cited.has(numberOf.get(n.url) ?? -1));
  const ledger = notesLedger(subset, numberOf, budgetChars);
  return ledger.notes > 0 ? ledger : notesLedger(notes, numberOf, budgetChars);
}
