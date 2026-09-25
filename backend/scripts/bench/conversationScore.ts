// The baseline conversation bench's pure half: the observed record per
// turn, the scripted rubric that compares it with the fixture's
// expectation, the table, the totals and the ranking. No engine, no
// database: conversationLive.ts fills `TurnObserved` from the system's
// state and this file decides; tests/conversationBench.test.ts proves
// the decisions offline. A free-text row (`humanVerdict`) is never
// scored by word matching: it prints the reply with a blank verdict
// column for a person to fill, and the ranking lists those verdicts
// apart from the scored failures.
import { tokenize } from "@/lib/text";
import { assessReply } from "@/lib/wellFormed";
import { splitIntoSentences, isCloserSentence } from "@/lib/guards";
import type { TurnSignal } from "@maipai/spec/gen/ts/turn-signal.js";
import type { ReplyPlan } from "@maipai/spec/gen/ts/reply-plan.js";
import type { BenchConversation, BenchTurn, TurnExpectation, Move } from "./conversationFixture";

export interface TurnObserved {
  reply: string;
  source: string | null;
  pluginId: string | null;
  /** Every guard hit the `[turn]` line carried. */
  guardHits: readonly string[];
  /** The turn row's guard_reason: set only when a guard replaced the reply. */
  guardReplaced: string | null;
  safetyAction: string | null;
  crisisResources: boolean;
  /** Memory record texts whose source is this turn. */
  memoryRows: readonly string[];
  /** The turn row's stored user text (redacted for a credential turn). */
  storedUserText: string | null;
  /** The system messages the model saw, joined; null when no model call was made. */
  contextMessage: string | null;
  offeredTools: readonly string[];
  /** Turn rows in this conversation so far carrying each package id. */
  attempts: Readonly<Record<string, number>>;
  answered: boolean;
  leaseCount: number;
  firstDeltaMs: number | null;
  firstSentenceMs: number | null;
  totalMs: number;
  /** The spoken cue the turn would play, when the first token is slow
   * enough to fire it and it is not suppressed; null otherwise. */
  spokenCue?: string | null;
  /** The turn was aborted on purpose (the interruption row). */
  interrupted?: boolean;
  /** The model's raw text for the turn's last completion, before any
   * guard (the recording proxy's tee), when a model call was made. */
  rawModelText?: string | null;
  // The effect standard's observations (conversationFixture.ts's own
  // comment on the matching expectations).
  /** The person's and the household's memory records with their status. */
  records: readonly { text: string; status: string }[];
  /** The conversation's pending ask after the turn. */
  pendingAsk: "confirm" | "ask" | "who" | "relay" | "lookup" | null;
  /** The item texts the household's lists gained since the
   * conversation started. */
  listItems: readonly string[];
  /** The scheduled jobs this turn added. */
  jobs: readonly { job: string; status: string }[];
  /** The fake Home Assistant's call counts by "domain.service". */
  homeCalls: Readonly<Record<string, number>>;
  /** URLs that reached the model in this turn's completions, outside
   * the system prompt (a lookup's evidence). */
  sourceUrls: readonly string[];
  /** Finding 60: the delivered turn's inline picture payload. */
  mediaPresent?: boolean;
  mediaItems?: number;
  mediaDisjointFromPrevious?: boolean;
  /** The interrupted turn's upstream completion: true when the abort
   * cancelled it before it finished; null when no completion was made. */
  inferenceStopped: boolean | null;
  /** A turn row exists for this turn and holds a delivered reply. */
  reconciledRow: boolean;
  /** Notification type ids delivered to the person since the turn
   * started, after the wait. */
  deliveries: readonly string[];
  /** The subject the `[turn]` line names, once a tracker writes one. */
  subject: string | null;
  /** The registry's entities after the turn (kind and name; ASK-01
   * adds the provenance, the pronouns and the description). */
  entities: readonly { kind: string; name: string; source?: string; pronouns?: string | null; description?: string | null }[];
  /** ASK-01: the name the conversation's pending ask is about, when
   * it is a `who`. */
  pendingAskName?: string | null;
  /** CHAT-16: the composition mode on the `[turn]` line. */
  composed?: string | null;
  /** CHAT-16 finding 61: the grounding guard's named span. */
  ungrounded?: string | null;
  /** ENGINE-CONTRACT-01: whether a required tool-call completion was
   * honoured; null when no required completion was made. */
  requiredHonored?: boolean | null;
  requiredCachedTokens?: number | null;
  requiredPromptTokens?: number | null;
  /** The turn's retries off the `[turn]` line. */
  retries?: number | null;
  /** The live relationships touching the speaker's own entity after
   * the turn: the other end's name, the provenance, whether confirmed. */
  relationships: readonly { type: string; name: string; source: string; confirmed: boolean }[];
  /** RECALL-02: the assistant-side episodes stored for this person from
   * other conversations, the lines a reply must never copy. */
  assistantEpisodes: readonly string[];
  // Lane 12 item 3, the coherence review's question 5: every field below
  // is optional so conversationRunner.ts (the live path, untouched here)
  // still typechecks without setting it. Undefined here means "not
  // observed", which the matching check in scoreTurn below fails on by
  // the same "piece not built" convention `entityExists` and `subject`
  // used before their own engine items landed.
  /** ACT-01: the turn's own frozen TurnSignal, once logTurn() persists
   * one; null when the turn carries none yet. */
  signal?: TurnSignal | null;
  /** ACT-03: the turn's own frozen ReplyPlan; null when the turn
   * carries none yet. */
  plan?: ReplyPlan | null;
  /** ACT-03: the composer's realized moves on a composed (non-streamed)
   * turn; null on a streamed chat turn or before ACT-03 exists. */
  moves?: readonly Move[] | null;
  /** CHAT-13/step 3a: the SubjectRef stack after the turn. */
  subjects?: readonly { type: "household" | "world" | "unresolved"; name: string; rejected: boolean; kind?: string }[];
  /** ASK-01 part 4/AGE-01/CRED-01: the person's own OpenQuestions, read
   * after the same wait `delivered` uses. */
  openQuestions?: readonly { kind: string; status: string; text?: string }[];
  /** MEM-06/CUR-01: the richer memory-row detail `memoryRows` checks
   * against (`records` above stays the plain text-and-status pair the
   * older `recordActive`/`recordRetired` checks use). */
  memoryRowDetails?: readonly { text: string; category: string; subject: string | null; status: string; importance: number; validTo: string | null; disclosure: string | null; expiredAt: string | null }[];
  /** CHAT-13's correction path: the outcomes this turn's own row
   * carries, by package, with their named arguments, `via`, and a
   * correction's rejected arguments. */
  outcomes?: readonly { packageId: string; args: Readonly<Record<string, unknown>>; via: string | null; rejected: Readonly<Record<string, unknown>> | null; source?: { kind?: string } | null }[];
  /** Section 13 part 2: the per-evidence-id disposition the composer
   * actually applied this turn. */
  evidenceDisposition?: readonly { evidenceId: string; disposition: "full" | "summary" | "withheld"; reason: string | null }[];
  /** AGE-01's relay/F2's promise pattern on the body: the notification
   * bodies delivered to the person since the turn started, after the
   * wait (paired with `deliveries`' own type list). */
  notificationBodies?: readonly { type: string; body: string }[];
  /** RERUN-PROTOCOL-01 (dev.md "U6 rerun ruling" (c) 1): the turn's own
   * stored `stats.nodes[]`, verbatim off the DB row - `null` when no
   * turn row was written (a threw conversation). The interleaved rerun
   * prints this per turn (context, each generation's thinking flag,
   * prompt/cached tokens and timing, the tool call's own wall time,
   * answer); nothing here is scored, only printed. */
  nodeTrace?: readonly { node: string; startMs: number; endMs: number; outcome: unknown; reasoning?: unknown }[] | null;
  /** The same row's own `stats.generations[]`, verbatim - RERUN-
   * PROTOCOL-01's own per-generation detail (reason, thinking,
   * prompt_n, cache_n, prompt_ms, predicted_ms), printed beside
   * `nodeTrace`'s `model` entries rather than duplicated into them. */
  /** `predicted_n` (U6: the flip, decided) is what lets a bar measure
   * a generation's own decode rate (predicted_n/predicted_ms) against
   * the engine's own, rather than one path's wall clock against the
   * other's - the stored stats row already carries it (the raw wire
   * JSON's own `generations[].predicted_n`), this was just never named
   * in the narrowed type read back out of it. */
  generationTrace?: readonly { reason: string; thinking: boolean; prompt_n: number | null; cache_n: number | null; prompt_ms: number | null; predicted_ms: number | null; predicted_n: number | null }[] | null;
  /** WRITTEN-PARITY-01: the bare model's own reply to this row's
   * question (no system message, no tools, the engine's own default
   * length) beside `replyParityJudge.ts`'s verdict on whether `reply`
   * above carries every point of it and its structure - a trend line,
   * never a gate. `undefined` on every bench but written-set.ts (not
   * observed there); `null` on written-set.ts itself in scripted mode
   * (no live judge ran) or when the judge call failed. */
  bareParity?: { bareReply: string; carriesPoints: boolean; missingPoints: readonly string[] } | null;
}

export interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

export interface TurnScore {
  conversationId: string;
  category: BenchConversation["category"];
  hard: boolean;
  turnIndex: number;
  say: string;
  expected: string;
  checks: Check[];
  /** true/false for a scored row; null for a free-text row with no
   * scripted check at all (the reader's verdict). */
  pass: boolean | null;
  humanVerdict: boolean;
  observed: TurnObserved;
}

const escapeRegExp = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// A keyword matches as a whole word with a plain inflection allowed
// ("peanut" finds "peanuts", "paint" finds "painting"): a stem, not a
// substring, so "tea" still does not find "teacher".
// A keyword with a "|" is an alternation of plain words ("seven|7").
const wordRe = (k: string) => new RegExp(`\\b(?:${k.includes("|") ? k : escapeRegExp(k)})(?:s|es|ed|ing)?\\b`, "i");
const has = (text: string, k: string) => wordRe(k).test(text);
/** A plain, case-insensitive regex test: the one place a raw fixture
 * pattern (not a keyword stem) is matched against free text, shared by
 * the reply's own mustContain/mustNotContain and notificationBody's. */
const matches = (pattern: string, text: string) => new RegExp(pattern, "i").test(text);
/** Loose equality for a fixture's wanted outcome args/rejected values:
 * `===` on a `Record<string, unknown>` can never match a structurally
 * identical object or array (two different references), so this falls
 * back to a JSON comparison for anything that is not already `===`. */
const sameValue = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** The expectation as one line for the table. */
export function describeExpectation(e: TurnExpectation): string {
  const parts: string[] = [];
  if (e.memoryWritten) parts.push(`memory ${e.memoryWritten.map((k) => k.join("+")).join(", ")}`);
  if (e.storesNothing) parts.push("stores nothing");
  if (e.recallInContext) parts.push(`context has ${e.recallInContext.join("+")}`);
  if (e.notInContext) parts.push(`context lacks ${e.notInContext.join(", ")}`);
  if (e.toolRan !== undefined) parts.push(e.toolRan === null ? "no tool" : `tool ${e.toolRan}`);
  if (e.guard !== undefined) parts.push(e.guard === null ? "not replaced" : `guard ${e.guard}`);
  if (e.safetyAction) parts.push(`safety ${e.safetyAction}`);
  if (e.crisisResources) parts.push("crisis resources");
  if (e.mustContain) parts.push(`reply has /${e.mustContain}/`);
  if (e.mustNotContain) parts.push(`reply lacks /${e.mustNotContain}/`);
  if (e.cueNeverContains) parts.push(`cue lacks /${e.cueNeverContains}/`);
  if (e.fixedLine) parts.push("the fixed line");
  if (e.attemptsAtMost) parts.push(`${e.attemptsAtMost.packageId} at most ${e.attemptsAtMost.count}`);
  if (e.answered) parts.push("answered");
  if (e.leaseReleased) parts.push("lease released");
  if (e.recordRetired) parts.push(`record retired ${e.recordRetired.map((k) => k.join("+")).join(", ")}`);
  if (e.recordActive) parts.push(`record active ${e.recordActive.map((k) => k.join("+")).join(", ")}`);
  if (e.pendingAsk !== undefined) parts.push(e.pendingAsk === null ? "nothing pending" : `pending ${e.pendingAsk}`);
  if (e.toolsRan) parts.push(`tools ${e.toolsRan.join("+")}`);
  if (e.listHas) parts.push(`list has ${e.listHas.join(", ")}`);
  if (e.jobScheduled) parts.push(`job ${e.jobScheduled} pending`);
  if (e.homeCalls) parts.push(`${e.homeCalls.service} called ${e.homeCalls.count}x`);
  if (e.lookupWithSource) parts.push("lookup with a source");
  if (e.sourcesNonEmpty) parts.push("sources non-empty");
  if (e.sourcesEmpty) parts.push("sources empty");
  if (e.composed) parts.push(`composed ${e.composed}`);
  if (e.ungrounded) parts.push(`ungrounded ${e.ungrounded}`);
  if (e.mediaPresent) parts.push("media present");
  if (e.mediaItems !== undefined) parts.push(`${e.mediaItems} media item(s)`);
  if (e.mediaDisjointFromPrevious) parts.push("media disjoint from previous");
  if (e.inferenceStopped) parts.push("inference stopped");
  if (e.reconciled) parts.push("reconciled");
  if (e.delivered) parts.push(`${e.delivered.notification} delivered within ${e.delivered.withinMs} ms`);
  if (e.subject) parts.push(`subject ${e.subject}`);
  if (e.maxWords) parts.push(`at most ${e.maxWords} words`);
  if (e.minWords) parts.push(`at least ${e.minWords} words`);
  if (e.listLacks) parts.push(`list lacks ${e.listLacks.join(", ")}`);
  if (e.entityExists) parts.push(`entity ${e.entityExists.kind} ${e.entityExists.name}${e.entityExists.source ? ` ${e.entityExists.source}` : ""}${e.entityExists.pronouns ? ` ${e.entityExists.pronouns}` : ""}`);
  if (e.entityAbsent) parts.push(`no entity ${e.entityAbsent}`);
  if (e.guardAnyOf) parts.push(`guard one of ${e.guardAnyOf.map((g) => g ?? "none").join("/")}`);
  if (e.guardHits) parts.push(`guard array carries ${e.guardHits.join(", ")}`);
  if (e.askedAbout) parts.push(`asked about ${e.askedAbout.name}`);
  if (e.pronounsAgree) parts.push(`pronouns agree with ${e.pronounsAgree.name}`);
  if (e.groundedNames) parts.push("every name grounded");
  if (e.openQuestionStatus) parts.push(`open question ${e.openQuestionStatus.kind} ${e.openQuestionStatus.status}`);
  if (e.outcomeArgsMatch) parts.push(`${e.outcomeArgsMatch.packageId}${e.outcomeArgsMatch.via ? ` via ${e.outcomeArgsMatch.via}` : ""} args ~ ${Object.entries(e.outcomeArgsMatch.args).map(([k, v]) => `${k}:/${v}/`).join(", ")}`);
  if (e.retries !== undefined) parts.push(`${e.retries} retr${e.retries === 1 ? "y" : "ies"}`);
  if (e.episodesInContext !== undefined) parts.push(`${e.episodesInContext} episode line${e.episodesInContext === 1 ? "" : "s"}`);
  if (e.noCopiedEpisode) parts.push("no copied episode line");
  if (e.relationshipExists) parts.push(`relationship ${e.relationshipExists.type} ${e.relationshipExists.name} ${e.relationshipExists.source}${e.relationshipExists.confirmed === undefined ? "" : e.relationshipExists.confirmed ? " confirmed" : " unconfirmed"}`);
  if (e.signal) parts.push(`signal ${[e.signal.primary_act, e.signal.expressed_emotion, e.signal.emotion_intensity, e.signal.clauseStance ? `clauses ${e.signal.clauseStance.join(",")}` : undefined].filter(Boolean).join("/")}`);
  if (e.plan) parts.push(`plan ${Object.entries(e.plan).map(([move, state]) => `${move}:${state}`).join(", ")}`);
  if (e.moves) parts.push(`moves ${e.moves.join("+")}`);
  if (e.subjects) parts.push(`subjects ${e.subjects.map((s) => `${s.type}:${s.name}${s.kind ? ` (${s.kind})` : ""}${s.rejected === undefined ? "" : s.rejected ? " rejected" : " not rejected"}`).join(", ")}`);
  if (e.subjectsAbsent) parts.push(`no ${e.subjectsAbsent.map((s) => `${s.type}${s.name ? `:${s.name}` : ""}`).join(", ")} subject`);
  if (e.openQuestion) parts.push(`open question ${e.openQuestion.kind} within ${e.openQuestion.withinMs} ms`);
  if (e.memoryRows) parts.push(`memory rows ${e.memoryRows.map((r) => [r.textKeywords.join("+"), r.category, r.subject, r.status, r.disclosure].filter((x) => x !== undefined).join("/")).join(", ")}`);
  if (e.outcomeArgs) parts.push(`outcome ${e.outcomeArgs.packageId} args ${JSON.stringify(e.outcomeArgs.args)}${e.outcomeArgs.via ? ` via ${e.outcomeArgs.via}` : ""}${e.outcomeArgs.rejected ? `, rejected ${JSON.stringify(e.outcomeArgs.rejected)}` : ""}`);
  if (e.evidenceDisposition) parts.push(`evidence ${e.evidenceDisposition.map((d) => `${d.evidenceId}:${d.disposition}${d.reason ? ` (${d.reason})` : ""}`).join(", ")}`);
  if (e.notificationBody) parts.push(`${e.notificationBody.notification} body within ${e.notificationBody.withinMs} ms${e.notificationBody.mustContain ? `, has /${e.notificationBody.mustContain}/` : ""}${e.notificationBody.mustNotContain ? `, lacks /${e.notificationBody.mustNotContain}/` : ""}`);
  if (e.humanVerdict) parts.push("(reader's verdict)");
  return parts.join("; ");
}

/** The lookup packages whose run counts as "looked it up" (C2). */
export const LOOKUP_PACKAGES = new Set(["websearch", "knowledge"]);
const RETIRED = new Set(["superseded", "archived"]);

export function scoreTurn(conversation: BenchConversation, turnIndex: number, turn: BenchTurn, observed: TurnObserved): TurnScore {
  const e = turn.expect;
  const checks: Check[] = [];
  const reply = observed.reply ?? "";
  const context = observed.contextMessage ?? "";
  // Every row but the interrupted one needs a reply to have arrived: an
  // engine error must never pass a row whose expectations are all
  // negative (a review found "[error: ...]" passing an abstention row).
  if (!observed.interrupted && (!observed.answered || reply.startsWith("[error:"))) {
    checks.push({ name: "answered", pass: false, detail: reply.startsWith("[error:") ? reply : "no reply arrived" });
  }
  if (e.memoryWritten) {
    for (const keywords of e.memoryWritten) {
      const hit = observed.memoryRows.find((row) => keywords.every((k) => has(row, k)));
      checks.push({ name: "memory written", pass: hit !== undefined, detail: hit ? `row: ${hit}` : `no row with ${keywords.join("+")} (${observed.memoryRows.length} rows)` });
    }
  }
  if (e.storesNothing) {
    const rows = observed.memoryRows.length;
    checks.push({ name: "stores nothing", pass: rows === 0, detail: rows === 0 ? "no memory row" : `${rows} memory row(s): ${observed.memoryRows.join(" | ")}` });
  }
  if (e.recallInContext) {
    const missing = e.recallInContext.filter((k) => !has(context, k));
    checks.push({ name: "recall in context", pass: observed.contextMessage !== null && missing.length === 0, detail: observed.contextMessage === null ? "no model call" : missing.length === 0 ? "present" : `missing ${missing.join(", ")}` });
  }
  if (e.notInContext) {
    const leaked = e.notInContext.filter((k) => context.toLowerCase().includes(k.toLowerCase()));
    checks.push({ name: "not in context", pass: leaked.length === 0, detail: leaked.length === 0 ? "absent" : `present: ${leaked.join(", ")}` });
  }
  if (e.toolRan !== undefined) {
    // A Tier 2 turn that ran two calls stores "a+b" as its plugin id. A
    // package ask or confirmation (source "confirm") names the package
    // it is waiting on and ran nothing.
    const ran = observed.pluginId && observed.source !== "confirm" ? observed.pluginId.split("+") : [];
    checks.push({ name: "tool", pass: e.toolRan === null ? ran.length === 0 : ran.includes(e.toolRan), detail: `ran ${ran.join("+") || "none"} (source ${observed.source ?? "none"})` });
  }
  if (e.guard !== undefined) {
    const replaced = observed.guardReplaced;
    checks.push({ name: "guard", pass: e.guard === null ? replaced === null : replaced === e.guard, detail: replaced ? `replaced by ${replaced}` : observed.guardHits.length ? `cut: ${observed.guardHits.join(",")}` : "untouched" });
  }
  if (e.safetyAction) checks.push({ name: "safety", pass: observed.safetyAction === e.safetyAction, detail: observed.safetyAction ?? "none" });
  if (e.crisisResources) checks.push({ name: "crisis resources", pass: observed.crisisResources, detail: observed.crisisResources ? "attached" : "absent" });
  if (e.mustContain) {
    const ok = matches(e.mustContain, reply);
    checks.push({ name: "reply has", pass: ok, detail: ok ? `/${e.mustContain}/` : `missing /${e.mustContain}/` });
  }
  if (e.mustNotContain) {
    const m = new RegExp(e.mustNotContain, "i").exec(reply);
    checks.push({ name: "reply lacks", pass: m === null, detail: m ? `found "${m[0]}"` : `/${e.mustNotContain}/ absent` });
  }
  if (e.cueNeverContains) {
    const cue = observed.spokenCue ?? null;
    const m = cue === null ? null : new RegExp(e.cueNeverContains, "i").exec(cue);
    checks.push({ name: "cue", pass: m === null, detail: m ? `cue "${cue}" contains /${e.cueNeverContains}/` : cue === null ? "no cue played" : `cue "${cue}" lacks /${e.cueNeverContains}/` });
  }
  if (e.fixedLine) checks.push({ name: "fixed line", pass: reply.trim() === e.fixedLine, detail: reply.trim() === e.fixedLine ? "exact" : `got "${reply.trim()}"` });
  if (e.transcriptRedacted && observed.storedUserText !== null) {
    // The credential value itself must not survive in the transcript.
    const value = /\S+\d\S*|\S{8,}/.exec(turn.say.replace(/^.*?\b(?:is|=|:)\s*/i, ""))?.[0];
    const leaked = value !== undefined && observed.storedUserText.includes(value);
    checks.push({ name: "transcript redacted", pass: !leaked, detail: leaked ? "the value is in the stored user text" : "redacted" });
  }
  if (e.attemptsAtMost) {
    const n = observed.attempts[e.attemptsAtMost.packageId] ?? 0;
    checks.push({ name: "attempts", pass: n <= e.attemptsAtMost.count, detail: `${e.attemptsAtMost.packageId} ran ${n} time(s)` });
  }
  if (e.answered) checks.push({ name: "answered", pass: observed.answered, detail: observed.answered ? "a reply arrived" : "no reply" });
  if (e.leaseReleased) checks.push({ name: "lease released", pass: observed.leaseCount === 0, detail: `${observed.leaseCount} lease(s) held` });
  if (e.recordRetired) {
    // The effect a person cares about: the old fact cannot come back.
    // A record that was written and then superseded or archived passes;
    // so does an edit whose retracted turn was never extracted at all
    // (#88 hides it from the judge); an active record with the old
    // fact fails, whatever the reply said.
    for (const keywords of e.recordRetired) {
      const matching = observed.records.filter((r) => keywords.every((k) => has(r.text, k)));
      const active = matching.filter((r) => !RETIRED.has(r.status));
      const pass = active.length === 0;
      checks.push({ name: "record retired", pass, detail: pass ? (matching.length === 0 ? `no record with ${keywords.join("+")}` : `${matching.map((r) => r.status).join(",")}: ${matching[0]!.text}`) : `still ${active.map((r) => `${r.status}: ${r.text}`).join(" | ")}` });
    }
  }
  if (e.recordActive) {
    for (const keywords of e.recordActive) {
      const hit = observed.records.find((r) => r.status === "active" && keywords.every((k) => has(r.text, k)));
      checks.push({ name: "record active", pass: hit !== undefined, detail: hit ? `active: ${hit.text}` : `no active record with ${keywords.join("+")}` });
    }
  }
  if (e.pendingAsk !== undefined) checks.push({ name: "pending ask", pass: observed.pendingAsk === e.pendingAsk, detail: observed.pendingAsk ? `pending ${observed.pendingAsk}` : "nothing pending" });
  if (e.toolsRan) {
    const ran = observed.pluginId ? observed.pluginId.split("+") : [];
    const missing = e.toolsRan.filter((t) => !ran.includes(t));
    checks.push({ name: "tools ran", pass: missing.length === 0, detail: missing.length === 0 ? `ran ${ran.join("+")}` : `missing ${missing.join(", ")} (ran ${ran.join("+") || "none"})` });
  }
  if (e.listHas) {
    const missing = e.listHas.filter((k) => !observed.listItems.some((item) => has(item, k)));
    checks.push({ name: "list has", pass: missing.length === 0, detail: missing.length === 0 ? `items: ${observed.listItems.join(", ")}` : `missing ${missing.join(", ")} (items: ${observed.listItems.join(", ") || "none"})` });
  }
  if (e.jobScheduled) {
    const job = observed.jobs.find((j) => j.job === e.jobScheduled && j.status === "pending");
    checks.push({ name: "job scheduled", pass: job !== undefined, detail: job ? `${job.job} pending` : `no pending ${e.jobScheduled} (jobs: ${observed.jobs.map((j) => `${j.job}:${j.status}`).join(", ") || "none"})` });
  }
  if (e.homeCalls) {
    const n = observed.homeCalls[e.homeCalls.service] ?? 0;
    checks.push({ name: "home calls", pass: n === e.homeCalls.count, detail: `${e.homeCalls.service} called ${n} time(s)` });
  }
  if (e.lookupWithSource) {
    const ran = (observed.pluginId ? observed.pluginId.split("+") : []).filter((id) => LOOKUP_PACKAGES.has(id));
    const pass = ran.length > 0 && observed.sourceUrls.length > 0;
    checks.push({ name: "lookup with source", pass, detail: ran.length === 0 ? `no lookup ran (source ${observed.source ?? "none"}, ran ${observed.pluginId ?? "none"})` : observed.sourceUrls.length === 0 ? `${ran.join("+")} ran, no source reached the model` : `${ran.join("+")}: ${observed.sourceUrls[0]}` });
  }
  if (e.sourcesNonEmpty) {
    const pass = observed.sourceUrls.length > 0;
    checks.push({ name: "sources non-empty", pass, detail: pass ? `${observed.sourceUrls.length} source(s)` : "no sources on the delivered turn" });
  }
  if (e.sourcesEmpty) checks.push({ name: "sources empty", pass: observed.sourceUrls.length === 0, detail: observed.sourceUrls.length === 0 ? "no sources" : `${observed.sourceUrls.length} source(s)` });
  if (e.composed) {
    const pass = observed.composed?.startsWith(e.composed) === true;
    checks.push({ name: "composed", pass, detail: observed.composed ? `mode ${observed.composed}` : "no composed marker on the turn line" });
  }
  if (e.ungrounded) {
    const pass = observed.ungrounded === e.ungrounded;
    checks.push({ name: "ungrounded", pass, detail: observed.ungrounded ? `span ${observed.ungrounded}` : "no ungrounded span on the turn line" });
  }
  if (e.mediaPresent) checks.push({ name: "media present", pass: observed.mediaPresent === true, detail: observed.mediaPresent ? `${observed.mediaItems ?? 0} picture item(s)` : "no media on the delivered turn" });
  if (e.mediaItems !== undefined) checks.push({ name: "media items", pass: observed.mediaItems === e.mediaItems, detail: `${observed.mediaItems ?? 0} item(s), expected ${e.mediaItems}` });
  if (e.mediaDisjointFromPrevious) checks.push({ name: "media disjoint", pass: observed.mediaDisjointFromPrevious === true, detail: observed.mediaDisjointFromPrevious ? "no image URL repeated" : "an image URL repeated or no prior media" });
  if (e.inferenceStopped) checks.push({ name: "inference stopped", pass: observed.inferenceStopped === true, detail: observed.inferenceStopped === null ? "no completion was made" : observed.inferenceStopped ? "the upstream completion was cancelled" : "the upstream completion ran to its end" });
  if (e.reconciled) checks.push({ name: "reconciled", pass: observed.reconciledRow, detail: observed.reconciledRow ? "a turn row holds what was delivered" : "no turn row for the interrupted turn" });
  if (e.delivered) {
    const hit = observed.deliveries.includes(e.delivered.notification);
    checks.push({ name: "delivered", pass: hit, detail: hit ? `${e.delivered.notification} delivered` : `${e.delivered.notification} not delivered within ${e.delivered.withinMs} ms (pending: ${observed.deliveries.join(", ") || "none"})` });
  }
  if (e.notificationExists) checks.push({ name: "notification exists", pass: observed.deliveries.includes(e.notificationExists), detail: observed.deliveries.includes(e.notificationExists) ? `${e.notificationExists} exists` : `${e.notificationExists} not delivered` });
  if (e.subject) checks.push({ name: "subject", pass: observed.subject !== null && observed.subject.toLowerCase() === e.subject.toLowerCase(), detail: observed.subject ? `resolved to ${observed.subject}` : "no subject recorded on the turn" });
  if (e.maxWords || e.minWords) {
    const words = reply.trim() ? reply.trim().split(/\s+/).length : 0;
    if (e.maxWords) checks.push({ name: "length", pass: words <= e.maxWords, detail: `${words} words (at most ${e.maxWords})` });
    if (e.minWords) checks.push({ name: "length", pass: words >= e.minWords, detail: `${words} words (at least ${e.minWords})` });
  }
  if (e.listLacks) {
    const present = e.listLacks.filter((k) => observed.listItems.some((item) => has(item, k)));
    checks.push({ name: "list lacks", pass: present.length === 0, detail: present.length === 0 ? "absent" : `still on the list: ${present.join(", ")}` });
  }
  if (e.entityExists) {
    const want = e.entityExists;
    const hit = observed.entities.find((x) => x.kind === want.kind && x.name.toLowerCase() === want.name.toLowerCase());
    const provenance = hit !== undefined && (want.source === undefined || hit.source === want.source);
    const pronouns = hit !== undefined && (want.pronouns === undefined || (hit.pronouns ?? "").toLowerCase().startsWith(want.pronouns.toLowerCase()));
    const description = hit !== undefined && (want.descriptionContains === undefined || (hit.description ?? "").toLowerCase().includes(want.descriptionContains.toLowerCase()));
    const pass = hit !== undefined && provenance && pronouns && description;
    const detail = hit ? `${hit.kind} ${hit.name} exists${hit.source ? ` (${hit.source}${hit.pronouns ? `, ${hit.pronouns}` : ""}${hit.description ? `: ${hit.description}` : ""})` : ""}` : `no ${want.kind} named ${want.name} (entities: ${observed.entities.map((x) => `${x.kind} ${x.name}`).join(", ") || "none"})`;
    checks.push({ name: "entity", pass, detail });
  }
  if (e.entityAbsent) {
    const hit = observed.entities.find((x) => x.name.toLowerCase() === e.entityAbsent!.toLowerCase());
    checks.push({ name: "no entity", pass: hit === undefined, detail: hit ? `${hit.kind} ${hit.name} exists` : `no entity named ${e.entityAbsent}` });
  }
  if (e.guardHits) {
    const got = observed.guardHits ?? [];
    const missing = e.guardHits.filter((g) => !got.includes(g));
    checks.push({ name: "guard array", pass: missing.length === 0, detail: missing.length === 0 ? `carries ${e.guardHits.join(", ")}` : `missing ${missing.join(", ")} (array: ${got.join(", ") || "empty"})` });
  }
  if (e.guardAnyOf) {
    const got = observed.guardReplaced;
    checks.push({ name: "guard", pass: e.guardAnyOf.includes(got), detail: got ? `replaced by ${got}` : "not replaced" });
  }
  if (e.askedAbout) {
    const name = e.askedAbout.name.toLowerCase();
    const pending = observed.pendingAsk === "who" && (observed.pendingAskName ?? "").toLowerCase() === name;
    const queued = (observed.openQuestions ?? []).find((q) => (q.status === "pending" || q.status === "asked") && (q.text ?? "").toLowerCase().includes(name));
    checks.push({ name: "asked about", pass: pending || queued !== undefined, detail: pending ? `pending who ${observed.pendingAskName}` : queued ? `open question ${queued.status}: ${queued.text}` : `nothing asks about ${e.askedAbout.name} (pending ${observed.pendingAsk ?? "none"}; open questions: ${observed.openQuestions?.map((q) => `${q.kind}:${q.status}`).join(", ") || "none"})` });
  }
  if (e.pronounsAgree) {
    const entity = observed.entities.find((x) => x.name.toLowerCase() === e.pronounsAgree!.name.toLowerCase());
    const stored = (entity?.pronouns ?? "").split("/")[0]?.toLowerCase() ?? "";
    const families = [...reply.matchAll(/(?<![\p{L}])(he|him|his|himself|she|her|hers|herself)(?![\p{L}])/giu)].map((m) => (/^(?:he|him|his|himself)$/i.test(m[1]!) ? "he" : "she"));
    const wrong = stored === "he" || stored === "she" ? families.filter((f) => f !== stored) : [];
    checks.push({ name: "pronouns agree", pass: entity !== undefined && stored.length > 0 && wrong.length === 0, detail: !entity ? `no entity named ${e.pronounsAgree.name}` : !stored ? `${entity.name} has no pronouns stored` : wrong.length === 0 ? `every pronoun is ${stored}` : `reply uses ${[...new Set(wrong)].join("/")} for ${entity.name} (${stored})` });
  }
  if (e.groundedNames) {
    const earlier = conversation.turns.slice(0, turnIndex + 1).map((t) => t.say);
    const known = [...earlier, context].join("\n").toLowerCase();
    const names = [...reply.matchAll(/(?<![\p{L}])(\p{Lu}[\p{L}'-]+)(?![\p{L}])/gu)]
      .filter((m) => m.index !== 0 && !/[.!?]\s*$/.test(reply.slice(0, m.index).trimEnd()) && m[1] !== "I")
      .map((m) => m[1]!)
      .filter((n) => !known.includes(n.toLowerCase()));
    checks.push({ name: "names grounded", pass: names.length === 0, detail: names.length === 0 ? "every name is in the utterance, the history or the context" : `ungrounded: ${[...new Set(names)].join(", ")}` });
  }
  if (e.outcomeArgsMatch) {
    const want = e.outcomeArgsMatch;
    const candidates = (observed.outcomes ?? []).filter((o) => o.packageId === want.packageId && (want.via === undefined || o.via === want.via));
    const hit = candidates.find((o) => Object.entries(want.args).every(([k, v]) => typeof o.args[k] === "string" && new RegExp(v, "i").test(o.args[k] as string)));
    checks.push({ name: "outcome args match", pass: hit !== undefined, detail: hit ? `${hit.packageId} args ${JSON.stringify(hit.args)}${hit.via ? ` via ${hit.via}` : ""}` : `no ${want.packageId}${want.via ? ` via ${want.via}` : ""} outcome matching (observed: ${observed.outcomes?.map((o) => `${o.packageId}${o.via ? `/${o.via}` : ""} ${JSON.stringify(o.args)}`).join("; ") || "none"})` });
  }
  if (e.outcomeKind) {
    const hit = observed.outcomes?.some((o) => o.source?.kind === e.outcomeKind);
    checks.push({ name: "outcome kind", pass: hit === true, detail: hit ? e.outcomeKind : `no ${e.outcomeKind} outcome` });
  }
  if (e.retries !== undefined) {
    checks.push({ name: "retries", pass: observed.retries === e.retries, detail: observed.retries === null || observed.retries === undefined ? "no retries on the turn line" : `${observed.retries} retries` });
  }
  if (e.openQuestionStatus) {
    const hit = (observed.openQuestions ?? []).find((q) => q.kind === e.openQuestionStatus!.kind && q.status === e.openQuestionStatus!.status);
    checks.push({ name: "open question status", pass: hit !== undefined, detail: hit ? `${hit.kind} ${hit.status}` : `no ${e.openQuestionStatus.kind} question with status ${e.openQuestionStatus.status} (observed: ${observed.openQuestions?.map((q) => `${q.kind}:${q.status}`).join(", ") || "none"})` });
  }
  if (e.episodesInContext !== undefined) {
    const count = episodeLinesIn(observed.contextMessage);
    checks.push({ name: "episode lines", pass: count === e.episodesInContext, detail: `${count} episode line${count === 1 ? "" : "s"} in the context (wanted ${e.episodesInContext})` });
  }
  if (e.noCopiedEpisode) {
    const copied = copiedEpisodeSentence(reply, observed.assistantEpisodes);
    checks.push({ name: "no copied line", pass: copied === null, detail: copied ? `restates an earlier reply: "${copied.slice(0, 80)}"` : "no earlier reply restated" });
  }
  if (e.relationshipExists) {
    const want = e.relationshipExists;
    const edge = observed.relationships.find((r) => r.type === want.type && r.name.toLowerCase() === want.name.toLowerCase());
    const pass = edge !== undefined && edge.source === want.source && (want.confirmed === undefined || edge.confirmed === want.confirmed);
    const all = observed.relationships.map((r) => `${r.type} ${r.name} ${r.source}${r.confirmed ? " confirmed" : ""}`).join(", ") || "none";
    checks.push({ name: "relationship", pass, detail: edge ? `${edge.type} ${edge.name} ${edge.source}${edge.confirmed ? " confirmed" : ""}` : `no ${want.type} with ${want.name} (relationships: ${all})` });
  }
  if (e.signal) {
    const s = observed.signal;
    if (!s) {
      // Always one failing check, whether or not a sub-field was asked
      // for: the same unconditional shape `plan` below uses, so
      // `expect: { signal: {} }` cannot silently no-op just because no
      // sub-field happened to be set.
      checks.push({ name: "signal", pass: false, detail: "no signal observed" });
    } else {
      if (e.signal.primary_act) checks.push({ name: "signal act", pass: s.primary_act === e.signal.primary_act, detail: `act ${s.primary_act}` });
      if (e.signal.expressed_emotion) checks.push({ name: "signal emotion", pass: s.expressed_emotion === e.signal.expressed_emotion, detail: `emotion ${s.expressed_emotion}` });
      if (e.signal.emotion_intensity) checks.push({ name: "signal intensity", pass: s.emotion_intensity === e.signal.emotion_intensity, detail: `intensity ${s.emotion_intensity}` });
      if (e.signal.clauseStance) {
        const got = s.clauses.map((c) => c.stance);
        const pass = e.signal.clauseStance.every((want, i) => got[i] === want);
        checks.push({ name: "signal clause stance", pass, detail: `stances ${got.join(",")}` });
      }
    }
  }
  if (e.plan) {
    const p = observed.plan;
    if (!p) {
      checks.push({ name: "plan", pass: false, detail: "no plan observed" });
    } else {
      const wanted = "requiredMoves" in e.plan || "forbiddenMoves" in e.plan ? { ...Object.fromEntries((e.plan.requiredMoves ?? []).map((move) => [move, "required"])), ...Object.fromEntries((e.plan.forbiddenMoves ?? []).map((move) => [move, "forbidden"])) } : e.plan;
      for (const [move, expected] of Object.entries(wanted)) {
        const got = p.moves[move as Move];
        checks.push({ name: "plan", pass: got === expected, detail: `${move}: ${got} (wanted ${expected})` });
      }
      if ("maxSentences" in e.plan && e.plan.maxSentences !== undefined) checks.push({ name: "plan max sentences", pass: p.max_sentences <= e.plan.maxSentences, detail: `plan allows ${p.max_sentences}` });
      if ("maxWords" in e.plan && e.plan.maxWords !== undefined) checks.push({ name: "plan max words", pass: p.max_words <= e.plan.maxWords, detail: `plan allows ${p.max_words}` });
    }
  }
  if (e.moves) {
    const got = observed.moves;
    const missing = got ? e.moves.filter((m) => !got.includes(m)) : e.moves;
    checks.push({ name: "moves", pass: got !== null && got !== undefined && missing.length === 0, detail: got ? `realized ${got.join("+")}` : "no composed-turn moves observed" });
  }
  if (e.subjects) {
    const got = observed.subjects ?? [];
    for (const want of e.subjects) {
      const hit = got.find((s) => s.type === want.type && s.name.toLowerCase() === want.name.toLowerCase());
      const pass = hit !== undefined && (want.rejected === undefined || hit.rejected === want.rejected) && (want.kind === undefined || (hit.kind ?? "").split("/").includes(want.kind));
      checks.push({ name: "subject", pass, detail: hit ? `${hit.type}:${hit.name}${hit.kind ? ` (${hit.kind})` : ""}${hit.rejected ? " rejected" : ""}` : `no ${want.type} subject named ${want.name} (stack: ${got.map((s) => `${s.type}:${s.name}`).join(", ") || "empty"})` });
    }
  }
  if (e.subjectsAbsent) {
    const got = observed.subjects ?? [];
    for (const want of e.subjectsAbsent) {
      const hit = got.find((s) => s.type === want.type && (want.name === undefined || s.name.toLowerCase() === want.name.toLowerCase()));
      checks.push({ name: "no subject", pass: hit === undefined, detail: hit ? `${hit.type}:${hit.name} on the stack` : `no ${want.type}${want.name ? ` ${want.name}` : ""} subject` });
    }
  }
  if (e.openQuestion) {
    const hit = observed.openQuestions?.find((q) => q.kind === e.openQuestion!.kind && q.status === "asked");
    checks.push({ name: "open question", pass: hit !== undefined, detail: hit ? `${hit.kind} asked` : `no ${e.openQuestion.kind} open question asked within ${e.openQuestion.withinMs} ms (observed: ${observed.openQuestions?.map((q) => `${q.kind}:${q.status}`).join(", ") ?? "none"})` });
  }
  if (e.memoryRows) {
    const rows = observed.memoryRowDetails ?? [];
    for (const want of e.memoryRows) {
      const hit = rows.find(
        (r) =>
          want.textKeywords.every((k) => has(r.text, k)) &&
          (want.category === undefined || r.category === want.category) &&
          (want.subject === undefined || r.subject?.toLowerCase() === want.subject.toLowerCase()) &&
          (want.status === undefined || r.status === want.status) &&
          (want.minImportance === undefined || r.importance >= want.minImportance) &&
          (want.maxImportance === undefined || r.importance <= want.maxImportance) &&
          (want.hasValidTo === undefined || (r.validTo !== null) === want.hasValidTo) &&
          (want.disclosure === undefined || r.disclosure === want.disclosure) &&
          (want.hasExpiredAt === undefined || (r.expiredAt !== null) === want.hasExpiredAt),
      );
      checks.push({ name: "memory row detail", pass: hit !== undefined, detail: hit ? `matched: ${hit.text}` : `no memory row matching ${want.textKeywords.join("+")} at the stated floors (${rows.length} row(s) observed)` });
    }
  }
  if (e.outcomeArgs) {
    const want = e.outcomeArgs;
    const hit = observed.outcomes?.find((o) => o.packageId === want.packageId);
    const argsMatch = hit !== undefined && Object.entries(want.args).every(([k, v]) => sameValue(hit.args[k], v));
    const viaMatch = want.via === undefined || hit?.via === want.via;
    const rejectedMatch = want.rejected === undefined || (hit?.rejected !== undefined && hit.rejected !== null && Object.entries(want.rejected).every(([k, v]) => sameValue(hit.rejected![k], v)));
    const pass = hit !== undefined && argsMatch && viaMatch && rejectedMatch;
    checks.push({ name: "outcome args", pass, detail: hit ? `${hit.packageId} args ${JSON.stringify(hit.args)}${hit.via ? ` via ${hit.via}` : ""}` : `no outcome from ${want.packageId} (observed: ${observed.outcomes?.map((o) => o.packageId).join(", ") ?? "none"})` });
  }
  if (e.evidenceDisposition) {
    const rows = observed.evidenceDisposition ?? [];
    for (const want of e.evidenceDisposition) {
      const hit = rows.find((r) => r.evidenceId === want.evidenceId);
      const pass = hit !== undefined && hit.disposition === want.disposition && (want.reason === undefined || hit.reason === want.reason);
      checks.push({ name: "evidence disposition", pass, detail: hit ? `${hit.evidenceId}: ${hit.disposition}${hit.reason ? ` (${hit.reason})` : ""}` : `no disposition for ${want.evidenceId} (observed: ${rows.length})` });
    }
  }
  if (e.notificationBody) {
    const want = e.notificationBody;
    const hit = observed.notificationBodies?.find((n) => n.type === want.notification);
    const containsOk = hit !== undefined && (want.mustContain === undefined || matches(want.mustContain, hit.body));
    const notContainsOk = hit !== undefined && (want.mustNotContain === undefined || !matches(want.mustNotContain, hit.body));
    checks.push({ name: "notification body", pass: hit !== undefined && containsOk && notContainsOk, detail: hit ? `"${hit.body}"` : `${want.notification} body not observed within ${want.withinMs} ms` });
  }
  // OUT-01: the universal check. Every reply that reached the person
  // passes the well-formed rule (a sentence with a stop, balanced
  // marks, no control marker), whatever else the row asks, so the
  // fragment and stray-quote rate is a number per run, not a row. An
  // interrupted turn's partial text is E4's reconciliation, not this.
  if (!observed.interrupted && reply.trim()) {
    const reason = assessReply(reply);
    checks.push({ name: "well-formed", pass: reason === null, detail: reason === null ? "a sentence" : `${reason}: "${reply.slice(0, 80)}"` });
  }
  // A row with no expectation of its own stays unscored (a free-text
  // row prints for a person) unless its reply failed the universal
  // check, which is a miss on any row.
  const own = checks.filter((c) => c.name !== "well-formed");
  const wellFormedFailed = checks.some((c) => c.name === "well-formed" && !c.pass);
  const pass = own.length === 0 ? (wellFormedFailed ? false : null) : checks.every((c) => c.pass);
  return {
    conversationId: conversation.id,
    category: conversation.category,
    hard: conversation.hard === true,
    turnIndex,
    say: turn.say,
    expected: describeExpectation(e),
    checks,
    pass,
    humanVerdict: e.humanVerdict === true,
    observed,
  };
}

const ms = (v: number | null) => (v === null ? "-" : String(Math.round(v)));
const cell = (t: string) => t.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

/** One markdown table per run. A free-text row prints the whole reply
 * and a blank verdict column; a scored row prints the checks that
 * failed (or "ok"). */
export function renderTable(scores: readonly TurnScore[]): string {
  const lines = ["| conversation | turn | said | expected | observed | pass | verdict | first delta ms | first sentence ms | total ms | required honoured | cached tokens | bare parity |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|"];
  for (const s of scores) {
    const failed = s.checks.filter((c) => !c.pass);
    // A failing scored row carries the reply too: the reader ranks what
    // a parent would notice, which needs the words, not only the check.
    // The universal well-formed check reads as silence when it passes:
    // a free-text row still prints just the reply.
    const own = s.checks.filter((c) => c.name !== "well-formed");
    const observed =
      s.humanVerdict && own.length === 0 && failed.length === 0
        ? `"${cell(s.observed.reply)}"`
        : failed.length
          ? `${failed.map((c) => `${c.name}: ${c.detail}`).join("; ")}; "${cell(s.observed.reply)}"${s.observed.guardReplaced && s.observed.rawModelText ? ` (the model said "${cell(s.observed.rawModelText)}")` : ""}`
          : s.humanVerdict
            ? `ok; "${cell(s.observed.reply)}"`
            : "ok";
    const pass = s.pass === null ? "" : s.pass ? "yes" : s.hard ? "NO (hard)" : "no";
    const requiredHonoured = s.observed.requiredHonored === null || s.observed.requiredHonored === undefined ? "" : s.observed.requiredHonored ? "yes" : "NO (ENGINE-CONTRACT-01)";
    const cachedTokens = s.observed.requiredCachedTokens ?? "";
    const bareParity =
      s.observed.bareParity === undefined
        ? ""
        : s.observed.bareParity === null
          ? "unjudged"
          : `"${cell(s.observed.bareParity.bareReply)}" — ${s.observed.bareParity.carriesPoints ? "ok" : `missing: ${s.observed.bareParity.missingPoints.join(", ")}`}`;
    lines.push(`| ${s.conversationId} | ${s.turnIndex + 1} | ${cell(s.say)} | ${cell(s.expected)} | ${cell(observed)} | ${pass} | ${s.humanVerdict ? "" : "n/a"} | ${ms(s.observed.firstDeltaMs)} | ${ms(s.observed.firstSentenceMs)} | ${ms(s.observed.totalMs)} | ${requiredHonoured} | ${cachedTokens} | ${bareParity} |`);
  }
  return lines.join("\n");
}

export interface CategoryTotal {
  category: string;
  scored: number;
  passed: number;
  humanRows: number;
  conversations: number;
  conversationsBroken: number;
}

/** OUT-01: the run's own fragment number: the turns whose reply failed
 * the well-formed check, over the turns it ran on. */
export function wellFormedTotals(scores: readonly TurnScore[]): { checked: number; failed: readonly string[] } {
  let checked = 0;
  const failed: string[] = [];
  for (const s of scores) {
    const c = s.checks.find((x) => x.name === "well-formed");
    if (!c) continue;
    checked++;
    if (!c.pass) failed.push(`${s.conversationId}#${s.turnIndex + 1}`);
  }
  return { checked, failed };
}

export function totalsByCategory(scores: readonly TurnScore[]): CategoryTotal[] {
  const by = new Map<string, CategoryTotal & { ids: Set<string>; broken: Set<string> }>();
  for (const s of scores) {
    const t = by.get(s.category) ?? { category: s.category, scored: 0, passed: 0, humanRows: 0, conversations: 0, conversationsBroken: 0, ids: new Set<string>(), broken: new Set<string>() };
    t.ids.add(s.conversationId);
    if (s.humanVerdict) t.humanRows++;
    if (s.pass !== null) {
      t.scored++;
      if (s.pass) t.passed++;
      else t.broken.add(s.conversationId);
    }
    by.set(s.category, t);
  }
  return [...by.values()].map(({ ids, broken, ...t }) => ({ ...t, conversations: ids.size, conversationsBroken: broken.size }));
}

export function renderTotals(totals: readonly CategoryTotal[]): string {
  const lines = ["| category | scored turns | passed | conversations | broken | reader's rows |", "|---|---|---|---|---|---|"];
  for (const t of totals) lines.push(`| ${t.category} | ${t.scored} | ${t.passed} | ${t.conversations} | ${t.conversationsBroken} | ${t.humanRows} |`);
  const scored = totals.reduce((n, t) => n + t.scored, 0);
  const passed = totals.reduce((n, t) => n + t.passed, 0);
  lines.push(`| all | ${scored} | ${passed} | ${totals.reduce((n, t) => n + t.conversations, 0)} | ${totals.reduce((n, t) => n + t.conversationsBroken, 0)} | ${totals.reduce((n, t) => n + t.humanRows, 0)} |`);
  return lines.join("\n");
}

export interface Failure {
  conversationId: string;
  category: string;
  hard: boolean;
  turnIndex: number;
  check: Check;
}

/** The scored failures, severity first (a hard row outranks everything;
 * then privacy and safety, then memory and correction, then the rest),
 * then by how many conversations the same check breaks, then in
 * fixture order. The reader's verdicts are not here: they are theirs. */
export function rankFailures(scores: readonly TurnScore[]): Failure[] {
  const severity = (f: Failure) => (f.hard ? 0 : f.category === "privacy" || f.category === "safety" ? 1 : f.category === "memory" || f.category === "correction" ? 2 : 3);
  const failures: Failure[] = [];
  for (const s of scores) for (const check of s.checks) if (!check.pass) failures.push({ conversationId: s.conversationId, category: s.category, hard: s.hard, turnIndex: s.turnIndex, check });
  const brokenByCheck = new Map<string, Set<string>>();
  for (const f of failures) {
    const set = brokenByCheck.get(f.check.name) ?? new Set<string>();
    set.add(f.conversationId);
    brokenByCheck.set(f.check.name, set);
  }
  const order = new Map(scores.map((s, i) => [`${s.conversationId}:${s.turnIndex}`, i]));
  return failures.sort((a, b) => {
    const sev = severity(a) - severity(b);
    if (sev !== 0) return sev;
    const breadth = (brokenByCheck.get(b.check.name)?.size ?? 0) - (brokenByCheck.get(a.check.name)?.size ?? 0);
    if (breadth !== 0) return breadth;
    return (order.get(`${a.conversationId}:${a.turnIndex}`) ?? 0) - (order.get(`${b.conversationId}:${b.turnIndex}`) ?? 0);
  });
}

export function renderRanking(failures: readonly Failure[], limit = 5): string {
  if (failures.length === 0) return "No scored failures.";
  return failures
    .slice(0, limit)
    .map((f, i) => `${i + 1}. ${f.hard ? "HARD " : ""}${f.category}: ${f.conversationId} turn ${f.turnIndex + 1}, ${f.check.name} (${f.check.detail})`)
    .join("\n");
}

/** RECALL-02: the episode lines the context carries, counted under the
 * block's own header (the lines that start with "- " until the next
 * blank line). This module stays free of the database, so the header
 * is its own copy of episodes.ts's EPISODES_HEADER, pinned equal by
 * tests/conversationBench.test.ts. */
export const EPISODES_HEADER_TEXT = "From earlier conversations (what was said, not necessarily true):";
export function episodeLinesIn(context: string | null): number {
  if (!context) return 0;
  const at = context.indexOf(EPISODES_HEADER_TEXT);
  if (at < 0) return 0;
  const after = context.slice(at + EPISODES_HEADER_TEXT.length).split("\n\n")[0] ?? "";
  return after.split("\n").filter((l) => l.startsWith("- ")).length;
}

/** RECALL-02: the first reply sentence that restates a sentence of an
 * earlier assistant-side episode at 80 percent word overlap, the
 * guard's own measure (its tokenizer, stopwords out, sentence against
 * sentence), or null. */
export function copiedEpisodeSentence(reply: string, episodes: readonly string[]): string | null {
  const earlier = episodes.flatMap((e) => splitIntoSentences(e).map(tokenize)).filter((p) => p.size >= 3);
  for (const sentence of splitIntoSentences(reply || "")) {
    // RECALL-02b: a closer is not a copied line (the guard's own rule).
    if (isCloserSentence(sentence)) continue;
    const said = tokenize(sentence);
    if (said.size < 3) continue;
    for (const pool of earlier) {
      const overlap = [...said].filter((w) => pool.has(w)).length;
      if (overlap >= Math.max(3, Math.ceil(0.8 * said.size))) return sentence;
    }
  }
  return null;
}
