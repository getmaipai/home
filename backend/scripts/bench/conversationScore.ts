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
import { splitIntoSentences } from "@/lib/guards";
import type { BenchConversation, BenchTurn, TurnExpectation } from "./conversationFixture";

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
  pendingAsk: "confirm" | "ask" | null;
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
  /** The registry's entities after the turn (kind and name). */
  entities: readonly { kind: string; name: string }[];
  /** The live relationships touching the speaker's own entity after
   * the turn: the other end's name, the provenance, whether confirmed. */
  relationships: readonly { type: string; name: string; source: string; confirmed: boolean }[];
  /** RECALL-02: the assistant-side episodes stored for this person from
   * other conversations, the lines a reply must never copy. */
  assistantEpisodes: readonly string[];
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
  if (e.inferenceStopped) parts.push("inference stopped");
  if (e.reconciled) parts.push("reconciled");
  if (e.delivered) parts.push(`${e.delivered.notification} delivered within ${e.delivered.withinMs} ms`);
  if (e.subject) parts.push(`subject ${e.subject}`);
  if (e.maxWords) parts.push(`at most ${e.maxWords} words`);
  if (e.minWords) parts.push(`at least ${e.minWords} words`);
  if (e.listLacks) parts.push(`list lacks ${e.listLacks.join(", ")}`);
  if (e.entityExists) parts.push(`entity ${e.entityExists.kind} ${e.entityExists.name}`);
  if (e.episodesInContext !== undefined) parts.push(`${e.episodesInContext} episode line${e.episodesInContext === 1 ? "" : "s"}`);
  if (e.noCopiedEpisode) parts.push("no copied episode line");
  if (e.relationshipExists) parts.push(`relationship ${e.relationshipExists.type} ${e.relationshipExists.name} ${e.relationshipExists.source}${e.relationshipExists.confirmed === undefined ? "" : e.relationshipExists.confirmed ? " confirmed" : " unconfirmed"}`);
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
    // parked ask or confirmation (source "confirm") names the package
    // it is waiting on and ran nothing (item 4a).
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
    const ok = new RegExp(e.mustContain, "i").test(reply);
    checks.push({ name: "reply has", pass: ok, detail: ok ? `/${e.mustContain}/` : `missing /${e.mustContain}/` });
  }
  if (e.mustNotContain) {
    const m = new RegExp(e.mustNotContain, "i").exec(reply);
    checks.push({ name: "reply lacks", pass: m === null, detail: m ? `found "${m[0]}"` : `/${e.mustNotContain}/ absent` });
  }
  if (e.fixedLine) checks.push({ name: "fixed line", pass: reply.trim() === e.fixedLine, detail: reply.trim() === e.fixedLine ? "exact" : `got "${reply.trim()}"` });
  if (e.storesNothing && observed.storedUserText !== null) {
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
  if (e.inferenceStopped) checks.push({ name: "inference stopped", pass: observed.inferenceStopped === true, detail: observed.inferenceStopped === null ? "no completion was made" : observed.inferenceStopped ? "the upstream completion was cancelled" : "the upstream completion ran to its end" });
  if (e.reconciled) checks.push({ name: "reconciled", pass: observed.reconciledRow, detail: observed.reconciledRow ? "a turn row holds what was delivered" : "no turn row for the interrupted turn" });
  if (e.delivered) {
    const hit = observed.deliveries.includes(e.delivered.notification);
    checks.push({ name: "delivered", pass: hit, detail: hit ? `${e.delivered.notification} delivered` : `${e.delivered.notification} not delivered within ${e.delivered.withinMs} ms (pending: ${observed.deliveries.join(", ") || "none"})` });
  }
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
    const hit = observed.entities.find((x) => x.kind === e.entityExists!.kind && x.name.toLowerCase() === e.entityExists!.name.toLowerCase());
    checks.push({ name: "entity", pass: hit !== undefined, detail: hit ? `${hit.kind} ${hit.name} exists` : `no ${e.entityExists.kind} named ${e.entityExists.name} (entities: ${observed.entities.map((x) => `${x.kind} ${x.name}`).join(", ") || "none"})` });
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
  const lines = ["| conversation | turn | said | expected | observed | pass | verdict | first delta ms | first sentence ms | total ms |", "|---|---|---|---|---|---|---|---|---|---|"];
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
    lines.push(`| ${s.conversationId} | ${s.turnIndex + 1} | ${cell(s.say)} | ${cell(s.expected)} | ${cell(observed)} | ${pass} | ${s.humanVerdict ? "" : "n/a"} | ${ms(s.observed.firstDeltaMs)} | ${ms(s.observed.firstSentenceMs)} | ${ms(s.observed.totalMs)} |`);
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
    const said = tokenize(sentence);
    if (said.size < 3) continue;
    for (const pool of earlier) {
      const overlap = [...said].filter((w) => pool.has(w)).length;
      if (overlap >= Math.max(3, Math.ceil(0.8 * said.size))) return sentence;
    }
  }
  return null;
}
