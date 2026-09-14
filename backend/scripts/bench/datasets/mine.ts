#!/usr/bin/env bun
// Lane 13 item 1 (docs/plans/session-b-lane-13-2026-09-14.md): EVAL-07's
// mining half's own tool. No model, no scenario writing - only a
// deterministic, seeded selection of fragments from labels the public
// datasets already carry (a real dataset field, or a narrow, documented
// lexical pattern), so a person's review time goes into judging real
// examples instead of hunting for them. `phenomena.json` beside this
// file is the one place a phenomenon's own selection rule is described
// in words; PHENOMENON_SELECTORS below is this file's matching
// implementation, and the consistency test (datasetsMine.test.ts) pins
// the two together so neither can drift without the other noticing.
//
// Usage: bun run backend/scripts/bench/datasets/mine.ts
// Writes data-scratch/eval/review-sheet.md (git-ignored) and prints
// each phenomenon's fragment count (never the fragments themselves,
// which are dataset text, to whoever ran it).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { DatasetConversation, DatasetSource, DatasetTurn, LongMemEvalQuestion, LocomoQuestion } from "./types";
import { loadDailyDialogSplit } from "./dailydialog";
import { loadTaskmaster1 } from "./taskmaster1";
import { loadCcpeM, type CcpeAnnotationMention } from "./ccpeM";
import { loadQuac, type QuacQuestion } from "./quac";
import { loadLocomo } from "./locomo";
import { loadLongMemEval } from "./longmemeval";
import { absolutePath } from "./registry";
import { seededShuffle, SAMPLE_SEED } from "./sample";

export interface Fragment {
  phenomenon: string;
  source: DatasetSource;
  conversationId: string;
  /** Parallel to `turns`; null where a turn is synthetic (a question or
   * a gold answer assembled for the sheet, not a dataset transcript
   * line with its own id). */
  turnIds: (string | null)[];
  turns: { speaker: string; text: string }[];
  labels: Readonly<Record<string, string | number | boolean | null>>;
}

export interface PhenomenonDef {
  id: string;
  sources: DatasetSource[];
  description: string;
  labelRule: string;
  targetCount: number;
}

export interface MiningInputs {
  dailydialog: DatasetConversation[];
  taskmasterSelf: ReturnType<typeof loadTaskmaster1>;
  taskmasterWoz: ReturnType<typeof loadTaskmaster1>;
  ccpeM: { conversations: DatasetConversation[]; annotations: CcpeAnnotationMention[] };
  quac: { conversations: DatasetConversation[]; questions: QuacQuestion[] };
  locomo: { conversations: DatasetConversation[]; questions: LocomoQuestion[] };
  longmemeval: { conversations: DatasetConversation[]; questions: LongMemEvalQuestion[] };
}

// ==== shared helpers ====

function allTurns(conversations: DatasetConversation[]): { conversationId: string; turns: DatasetTurn[] }[] {
  return conversations.flatMap((c) => c.sessions.map((s) => ({ conversationId: c.id, turns: s.turns })));
}

/** Up to `before` turns before index and `after` turns after, clipped
 * at the session's own bounds - "the two to four turns around the
 * phenomenon" the item's acceptance names. */
function windowAround(turns: DatasetTurn[], index: number, before: number, after: number): DatasetTurn[] {
  return turns.slice(Math.max(0, index - before), Math.min(turns.length, index + after + 1));
}

function turnFragment(phenomenon: string, source: DatasetSource, conversationId: string, turns: DatasetTurn[], labels: Fragment["labels"]): Fragment {
  return { phenomenon, source, conversationId, turnIds: turns.map((t) => t.turnId), turns: turns.map((t) => ({ speaker: t.speaker, text: t.text })), labels };
}

/** LoCoMo's and LongMemEval's own questions live apart from the
 * transcript, graded against cited evidence turns rather than sitting
 * at one place in it - so their fragment is the (at most two) evidence
 * turns plus the question and its gold answer as two synthetic lines,
 * never a literal transcript window. */
function qaFragment(phenomenon: string, source: DatasetSource, conversationId: string, evidence: DatasetTurn[], question: string, answer: string, labels: Fragment["labels"]): Fragment {
  const cited = evidence.slice(0, 2);
  return {
    phenomenon,
    source,
    conversationId,
    turnIds: [...cited.map((t) => t.turnId), null, null],
    turns: [...cited.map((t) => ({ speaker: t.speaker, text: t.text })), { speaker: "question", text: question }, { speaker: "gold_answer", text: answer }],
    labels,
  };
}

// ==== DailyDialog: question-after-inform, emotional-disclosure-and-reply, directive, commissive-promise, closing, backchannel ====

const CLOSING_RE = /\b(bye|goodbye|see you|take care|talk (later|soon)|have a good (one|day|night))\b/i;
const BACKCHANNEL_WORDS = new Set(["yeah", "yep", "sure", "ok", "okay", "right", "uh-huh", "mm-hmm", "i see", "got it", "alright"]);

/** The whole cleaned turn, not just its first word, must be one of the
 * closed backchannel phrases - a review found the first-word check
 * alone let "Right but that seems odd" and "Sure thing lets go now"
 * through as acknowledgments, when neither carries no new content. */
export function isBackchannel(text: string): boolean {
  const cleaned = text.trim().toLowerCase().replace(/[.!?]+$/, "");
  return BACKCHANNEL_WORDS.has(cleaned);
}

function mineDailyDialog(conversations: DatasetConversation[]): Fragment[] {
  const fragments: Fragment[] = [];
  for (const { conversationId, turns } of allTurns(conversations)) {
    for (let i = 0; i < turns.length; i++) {
      const t = turns[i]!;
      if (t.act === 1 && turns[i + 1]?.act === 2) fragments.push(turnFragment("question-after-inform", "dailydialog", conversationId, windowAround(turns, i, 0, 1), { actFrom: 1, actTo: 2 }));
      if (t.emotion !== null && t.emotion !== 0 && i + 1 < turns.length) fragments.push(turnFragment("emotional-disclosure-and-reply", "dailydialog", conversationId, windowAround(turns, i, 0, 1), { emotion: t.emotion }));
      if (t.act === 3) fragments.push(turnFragment("directive", "dailydialog", conversationId, windowAround(turns, i, 1, 1), { act: 3 }));
      if (t.act === 4) fragments.push(turnFragment("commissive-promise", "dailydialog", conversationId, windowAround(turns, i, 1, 1), { act: 4 }));
      if (i === turns.length - 1 && CLOSING_RE.test(t.text)) fragments.push(turnFragment("closing", "dailydialog", conversationId, windowAround(turns, i, 2, 0), {}));
      if (isBackchannel(t.text)) fragments.push(turnFragment("backchannel", "dailydialog", conversationId, windowAround(turns, i, 1, 1), {}));
    }
  }
  return fragments;
}

// ==== Taskmaster-1: correction, confirmation (self-dialogs), woz-indirect-request (woz-dialogs) ====

// A review found the original pattern's bare "actually,? i" and "i
// mean" alternatives matching ordinary filler/preference openers
// ("Actually I would like a window seat", "I mean, could you check
// Friday") that correct nothing. Every alternative now requires an
// explicit retraction word ("meant", "not what i said") so the match
// stays tied to an actual correction.
export const CORRECTION_RE = /\b(no,? i meant|sorry,? i meant|wait,? actually,? i meant|actually,? i meant|i meant to say|that'?s not what i (meant|said))\b/i;
const CONFIRMATION_RE = /\b(so that'?s|just to confirm|to confirm|you said|let me confirm|is that (right|correct))\b/i;
const INDIRECT_REQUEST_RE = /\b(could you|would you|do you think you could|is there any way|i was wondering|i'?d like to|can you help)\b/i;

function mineTaskmasterSelf(loaded: ReturnType<typeof loadTaskmaster1>): Fragment[] {
  const fragments: Fragment[] = [];
  const seenSlotsByConversation = new Map<string, Set<string>>();
  for (const { conversationId, turns } of allTurns(loaded.conversations)) {
    const seenSlots = seenSlotsByConversation.get(conversationId) ?? new Set<string>();
    seenSlotsByConversation.set(conversationId, seenSlots);
    for (let i = 0; i < turns.length; i++) {
      const t = turns[i]!;
      if (CORRECTION_RE.test(t.text)) fragments.push(turnFragment("correction", "taskmaster1", conversationId, windowAround(turns, i, 1, 1), {}));
      const slots = loaded.slotNamesByTurn.get(t.turnId ?? "") ?? [];
      const repeated = slots.some((s) => seenSlots.has(s));
      if (CONFIRMATION_RE.test(t.text) || repeated) fragments.push(turnFragment("confirmation", "taskmaster1", conversationId, windowAround(turns, i, 1, 1), { repeatedSlot: repeated }));
      for (const s of slots) seenSlots.add(s);
    }
  }
  return fragments;
}

function mineTaskmasterWoz(loaded: ReturnType<typeof loadTaskmaster1>): Fragment[] {
  const fragments: Fragment[] = [];
  for (const { conversationId, turns } of allTurns(loaded.conversations)) {
    for (let i = 0; i < turns.length; i++) {
      const t = turns[i]!;
      if (t.speaker === "USER" && INDIRECT_REQUEST_RE.test(t.text)) fragments.push(turnFragment("woz-indirect-request", "taskmaster1", conversationId, windowAround(turns, i, 1, 1), {}));
    }
  }
  return fragments;
}

// ==== CCPE-M: preference-statement, preference-change, entity-description ====

const PREFERENCE_CONTRAST_RE = /\b(actually|but now|used to|instead|rather than|on second thought|changed my mind)\b/i;

function mineCcpeM(loaded: { conversations: DatasetConversation[]; annotations: CcpeAnnotationMention[] }): Fragment[] {
  const fragments: Fragment[] = [];
  const turnById = new Map<string, { conversationId: string; turns: DatasetTurn[]; index: number }>();
  for (const { conversationId, turns } of allTurns(loaded.conversations)) {
    turns.forEach((t, index) => { if (t.turnId) turnById.set(t.turnId, { conversationId, turns, index }); });
  }
  const firstPreferenceByConversation = new Map<string, string>();
  for (const a of loaded.annotations) {
    if (a.annotationType !== "ENTITY_PREFERENCE") continue;
    const loc = turnById.get(a.turnId);
    if (!loc) continue;
    if (!firstPreferenceByConversation.has(loc.conversationId)) firstPreferenceByConversation.set(loc.conversationId, a.turnId);
  }
  for (const a of loaded.annotations) {
    const loc = turnById.get(a.turnId);
    if (!loc) continue;
    const window = windowAround(loc.turns, loc.index, 1, 1);
    if (a.annotationType === "ENTITY_PREFERENCE") {
      fragments.push(turnFragment("preference-statement", "ccpe-m", loc.conversationId, window, {}));
      const text = loc.turns[loc.index]!.text;
      const isFirst = firstPreferenceByConversation.get(loc.conversationId) === a.turnId;
      if (!isFirst && PREFERENCE_CONTRAST_RE.test(text)) fragments.push(turnFragment("preference-change", "ccpe-m", loc.conversationId, window, {}));
    }
    if (a.annotationType === "ENTITY_DESCRIPTION") fragments.push(turnFragment("entity-description", "ccpe-m", loc.conversationId, window, {}));
  }
  return fragments;
}

// ==== QuAC: elliptical-followup, unanswerable-question, yesno-question ====

function mineQuac(loaded: { conversations: DatasetConversation[]; questions: QuacQuestion[] }): Fragment[] {
  const fragments: Fragment[] = [];
  const byConversation = new Map(loaded.conversations.map((c) => [c.id, c.sessions[0]!.turns]));
  for (const q of loaded.questions) {
    const turns = byConversation.get(q.conversationId);
    if (!turns) continue;
    const qIndex = turns.findIndex((t) => t.turnId === `${q.qaId}-q`);
    if (qIndex < 0) continue;
    const window = windowAround(turns, qIndex, 1, 1);
    if (q.followup === "y") fragments.push(turnFragment("elliptical-followup", "quac", q.conversationId, window, { followup: q.followup }));
    if (q.isUnanswerable) fragments.push(turnFragment("unanswerable-question", "quac", q.conversationId, window, {}));
    if (q.yesno !== "x") fragments.push(turnFragment("yesno-question", "quac", q.conversationId, window, { yesno: q.yesno }));
  }
  return fragments;
}

// ==== LoCoMo: temporal-question, multi-session-question, open-domain-question, adversarial-premise-question ====

const LOCOMO_PHENOMENON_BY_CATEGORY: Record<number, string> = { 2: "multi-session-question", 3: "temporal-question", 4: "open-domain-question", 5: "adversarial-premise-question" };

function mineLocomo(loaded: { conversations: DatasetConversation[]; questions: LocomoQuestion[] }): Fragment[] {
  const fragments: Fragment[] = [];
  const turnsByConversation = new Map(loaded.conversations.map((c) => [c.id, allTurns([c]).flatMap((x) => x.turns)]));
  for (const q of loaded.questions) {
    const phenomenon = LOCOMO_PHENOMENON_BY_CATEGORY[q.category];
    if (!phenomenon) continue;
    const turns = turnsByConversation.get(q.conversationId) ?? [];
    const evidence = q.evidenceTurnIds.map((id) => turns.find((t) => t.turnId === id)).filter((t): t is DatasetTurn => t !== undefined);
    // types.ts's own LocomoQuestion doc: category 5's correct reply is
    // that nothing supports the premise, never the adversarialAnswer
    // text itself - LoCoMo's own eval treats a model repeating it back
    // as the failure case. A review found the original fallback chain
    // (q.answer ?? q.adversarialAnswer ?? ...) surfacing exactly that
    // wrong text as the sheet's "gold_answer" for every category-5
    // question, since q.answer is always null there.
    const answer = q.answer ?? (q.category === 5 ? "(adversarial premise: no real answer exists; the correct reply refuses the premise, never repeats the adversarial answer back)" : "(no answer provided)");
    fragments.push(qaFragment(phenomenon, "locomo", q.conversationId, evidence, q.question, answer, { category: q.category, adversarialAnswer: q.adversarialAnswer }));
  }
  return fragments;
}

// ==== LongMemEval: knowledge-update, abstention, single-session-preference, temporal-reasoning ====

const LONGMEMEVAL_PHENOMENON_BY_TYPE: Record<string, string> = {
  "knowledge-update": "knowledge-update",
  "single-session-preference": "single-session-preference",
  "temporal-reasoning": "temporal-reasoning",
};

function mineLongMemEval(loaded: { conversations: DatasetConversation[]; questions: LongMemEvalQuestion[] }): Fragment[] {
  const fragments: Fragment[] = [];
  const turnsByConversation = new Map(loaded.conversations.map((c) => [c.id, allTurns([c]).flatMap((x) => x.turns)]));
  for (const q of loaded.questions) {
    const turns = turnsByConversation.get(q.conversationId) ?? [];
    const evidence = turns.filter((t) => t.isEvidence);
    if (q.isAbstention) {
      fragments.push(qaFragment("abstention", "longmemeval", q.conversationId, evidence, q.question, q.answer, {}));
      continue;
    }
    const phenomenon = LONGMEMEVAL_PHENOMENON_BY_TYPE[q.questionType];
    if (!phenomenon) continue;
    fragments.push(qaFragment(phenomenon, "longmemeval", q.conversationId, evidence, q.question, q.answer, { questionType: q.questionType }));
  }
  return fragments;
}

// ==== orchestration ====

/** Wraps a per-source miner so the same `inputs` object (one call to
 * selectFragments passes the same reference to every phenomenon that
 * shares a source) only mines that source once. Without this, a
 * review found selectFragments() running mineDailyDialog six times,
 * mineQuac three times and so on for one run - full O(n) scans over
 * corpora as large as DailyDialog's train split and QuAC's
 * train_v0.2.json, repeated for no behavioral difference. */
function memoized<T extends object, R>(fn: (arg: T) => R): (arg: T) => R {
  const cache = new WeakMap<T, R>();
  return (arg: T) => {
    let result = cache.get(arg);
    if (result === undefined) {
      result = fn(arg);
      cache.set(arg, result);
    }
    return result;
  };
}

const mineDailyDialogCached = memoized(mineDailyDialog);
const mineTaskmasterSelfCached = memoized(mineTaskmasterSelf);
const mineTaskmasterWozCached = memoized(mineTaskmasterWoz);
const mineCcpeMCached = memoized(mineCcpeM);
const mineQuacCached = memoized(mineQuac);
const mineLocomoCached = memoized(mineLocomo);
const mineLongMemEvalCached = memoized(mineLongMemEval);

/** One selector per phenomenon id in phenomena.json; the consistency
 * test asserts the two lists name exactly the same set. */
export const PHENOMENON_SELECTORS: Record<string, (inputs: MiningInputs) => Fragment[]> = {
  "question-after-inform": (i) => mineDailyDialogCached(i.dailydialog).filter((f) => f.phenomenon === "question-after-inform"),
  "emotional-disclosure-and-reply": (i) => mineDailyDialogCached(i.dailydialog).filter((f) => f.phenomenon === "emotional-disclosure-and-reply"),
  directive: (i) => mineDailyDialogCached(i.dailydialog).filter((f) => f.phenomenon === "directive"),
  "commissive-promise": (i) => mineDailyDialogCached(i.dailydialog).filter((f) => f.phenomenon === "commissive-promise"),
  closing: (i) => mineDailyDialogCached(i.dailydialog).filter((f) => f.phenomenon === "closing"),
  backchannel: (i) => mineDailyDialogCached(i.dailydialog).filter((f) => f.phenomenon === "backchannel"),
  correction: (i) => mineTaskmasterSelfCached(i.taskmasterSelf).filter((f) => f.phenomenon === "correction"),
  confirmation: (i) => mineTaskmasterSelfCached(i.taskmasterSelf).filter((f) => f.phenomenon === "confirmation"),
  "woz-indirect-request": (i) => mineTaskmasterWozCached(i.taskmasterWoz),
  "preference-statement": (i) => mineCcpeMCached(i.ccpeM).filter((f) => f.phenomenon === "preference-statement"),
  "preference-change": (i) => mineCcpeMCached(i.ccpeM).filter((f) => f.phenomenon === "preference-change"),
  "entity-description": (i) => mineCcpeMCached(i.ccpeM).filter((f) => f.phenomenon === "entity-description"),
  "elliptical-followup": (i) => mineQuacCached(i.quac).filter((f) => f.phenomenon === "elliptical-followup"),
  "unanswerable-question": (i) => mineQuacCached(i.quac).filter((f) => f.phenomenon === "unanswerable-question"),
  "yesno-question": (i) => mineQuacCached(i.quac).filter((f) => f.phenomenon === "yesno-question"),
  "temporal-question": (i) => mineLocomoCached(i.locomo).filter((f) => f.phenomenon === "temporal-question"),
  "multi-session-question": (i) => mineLocomoCached(i.locomo).filter((f) => f.phenomenon === "multi-session-question"),
  "open-domain-question": (i) => mineLocomoCached(i.locomo).filter((f) => f.phenomenon === "open-domain-question"),
  "adversarial-premise-question": (i) => mineLocomoCached(i.locomo).filter((f) => f.phenomenon === "adversarial-premise-question"),
  "knowledge-update": (i) => mineLongMemEvalCached(i.longmemeval).filter((f) => f.phenomenon === "knowledge-update"),
  abstention: (i) => mineLongMemEvalCached(i.longmemeval).filter((f) => f.phenomenon === "abstention"),
  "single-session-preference": (i) => mineLongMemEvalCached(i.longmemeval).filter((f) => f.phenomenon === "single-session-preference"),
  "temporal-reasoning": (i) => mineLongMemEvalCached(i.longmemeval).filter((f) => f.phenomenon === "temporal-reasoning"),
};

export function loadPhenomena(): PhenomenonDef[] {
  const raw = JSON.parse(readFileSync(join(import.meta.dir, "phenomena.json"), "utf-8")) as { phenomena: PhenomenonDef[] };
  return raw.phenomena;
}

/** Deterministic: every phenomenon's candidate pool is seeded-shuffled
 * (mulberry32 via sample.ts, the same PRNG the LongMemEval sample
 * uses) and sliced to its own targetCount, so which fragments land on
 * the sheet depends only on the seed and the downloaded files, never
 * on run order or object insertion order. */
export function selectFragments(inputs: MiningInputs, phenomena: PhenomenonDef[] = loadPhenomena(), seed: number = SAMPLE_SEED): Map<string, Fragment[]> {
  const result = new Map<string, Fragment[]>();
  phenomena.forEach((p, index) => {
    const selector = PHENOMENON_SELECTORS[p.id];
    if (!selector) throw new Error(`phenomena.json names "${p.id}" but mine.ts has no selector for it`);
    const candidates = selector(inputs);
    const shuffled = seededShuffle(candidates, seed + index);
    result.set(p.id, shuffled.slice(0, p.targetCount));
  });
  return result;
}

function checkbox(): string {
  return "- [ ] keep   - [ ] skip   - [ ] note: ___________________________";
}

export function renderReviewSheet(selected: Map<string, Fragment[]>, phenomena: PhenomenonDef[]): string {
  const lines: string[] = [
    "# Phenomenon review sheet (lane 13 item 1)",
    "",
    "Generated by `bun run backend/scripts/bench/datasets/mine.ts`. Mark each",
    "fragment keep/skip, add a note, and (for a keep) a one-line \"rewrite as\"",
    "sketch of the household-bench scenario it should become. This file is",
    "git-ignored: never commit dataset text.",
    "",
  ];
  for (const p of phenomena) {
    const fragments = selected.get(p.id) ?? [];
    lines.push(`## ${p.id} (${fragments.length} fragment${fragments.length === 1 ? "" : "s"})`, "", p.description, "", `Label rule: ${p.labelRule}`, "");
    fragments.forEach((f, i) => {
      lines.push(`### ${p.id} #${i + 1} - ${f.source} / ${f.conversationId}`, "");
      for (const t of f.turns) lines.push(`> **${t.speaker}:** ${t.text}`);
      lines.push("", checkbox(), "Rewrite as: ___________________________________________", "");
    });
  }
  return lines.join("\n");
}

async function loadAll(): Promise<MiningInputs> {
  const dailydialog = await loadDailyDialogSplit(absolutePath("dailydialog/train.zip"), "train");
  const taskmasterSelf = loadTaskmaster1(JSON.parse(readFileSync(absolutePath("taskmaster1/self-dialogs.json"), "utf-8")) as unknown[], "self");
  const taskmasterWoz = loadTaskmaster1(JSON.parse(readFileSync(absolutePath("taskmaster1/woz-dialogs.json"), "utf-8")) as unknown[], "woz");
  const ccpeM = loadCcpeM(JSON.parse(readFileSync(absolutePath("ccpe/data.json"), "utf-8")) as unknown[]);
  const quac = loadQuac(JSON.parse(readFileSync(absolutePath("quac/train_v0.2.json"), "utf-8")));
  const locomo = loadLocomo(JSON.parse(readFileSync(absolutePath("locomo10.json"), "utf-8")) as unknown[]);
  const longmemeval = loadLongMemEval(JSON.parse(readFileSync(absolutePath("longmemeval_s_cleaned.json"), "utf-8")) as unknown[]);
  return { dailydialog, taskmasterSelf, taskmasterWoz, ccpeM, quac, locomo, longmemeval };
}

async function main() {
  const phenomena = loadPhenomena();
  const inputs = await loadAll();
  const selected = selectFragments(inputs, phenomena);
  const sheet = renderReviewSheet(selected, phenomena);

  const outDir = join(import.meta.dir, "..", "..", "..", "..", "data-scratch", "eval");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "review-sheet.md");
  writeFileSync(outPath, sheet);

  let total = 0;
  console.log(`Wrote ${outPath}`);
  for (const p of phenomena) {
    const n = selected.get(p.id)?.length ?? 0;
    total += n;
    console.log(`  ${p.id}: ${n} (target ${p.targetCount})`);
  }
  console.log(`Total: ${total} fragments across ${phenomena.length} phenomena`);
}

if (import.meta.main) main();
