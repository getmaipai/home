// CODE-TIER-03 and CODE-AGENT-01 (first slice): a turn of a Code session is a household job (docs/design/code-session-tiers-2026-11-21.md 3.3 and 3.4).
// A turn is one run of the agent, from the person's message until it stops. Each turn enters lib/jobs/householdQueue.ts with category `coding`; the two
// session caps are admission reasons there (no second waiting list); `clampTier` runs on every turn and corrects the stored tier; a Max turn takes the
// Max lease (lib/chatLease.ts) and, when it cannot, waits with the lease's reason; the person may run that one turn at Standard instead.
// The agent and the sandbox are interfaces: the real OpenCode bridge and the Stack's /stack/v1/sandboxes come later and plug in through
// `setCodingRuntime`. Rule 6a: a queue job and every log line here carry ids, counts and reason codes only. The message text stays in this
// process for the agent and is never put in a job, a log or an error.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { randomSuffix } from "@/lib/id";
import { getHouseholdSettingValue, getPersonSettingValue } from "@/lib/settings";
import { appendLogLine } from "@/lib/log";
import { audienceBand } from "@/lib/audience";
import { jobQueueCopy, type JobQueueReason } from "@/lib/jobQueueCopy";
import { chatLeaseHeldBy, type ChatLease, type LeaseRefusal } from "@/lib/chatLease";
import { refreshHouseholdQueue, registerQueueProvider, releaseHouseholdQueue, type QueueJob } from "@/lib/jobs/householdQueue";
import type { Tier } from "@/lib/tiers";
import { revokeSessionKeys } from "@/lib/apiKeys";
import { addCheckpoint, CodingSessionError, codingSessionRefusal, correctStoredTier, getSessionRow, markSessionDeleted, requireCodingAccess, updateSession } from "@/lib/codingSessions";
import { createTurnHost, denyPendingFor, startTaint, type CodingHost } from "@/lib/codingBridge";
import { appendCodingMessage } from "@/lib/codingTranscript";
import { recordCodingEvent } from "@/lib/codingEvents";
import type { PersonRow } from "@/types";

/** What the agent bridge returns for a finished turn. `modelId` is provenance from the Stack's reply (never chosen or branched on). */
export interface CodingTurnResult { modelId?: string; usage?: { input_tokens: number; output_tokens: number } }
/** The agent bridge (CODE-AGENT-01, later: OpenCode events to message parts). It runs at the tier it is given; Home maps no tier to a model. */
export interface CodingAgent {
  /** A plain sentence when the agent cannot run now (no gateway key, no driver), else null. Checked before a turn is queued, so nothing starts that cannot finish. */
  ready?(): string | null;
  /** `host` is how the agent reports events and asks to act (lib/codingBridge.ts); an agent that needs nothing from it may ignore it. */
  runTurn(input: { sessionId: string; turnId: string; tier: Tier; message: string; signal: AbortSignal; host: CodingHost }): Promise<CodingTurnResult>;
}
/** The sandbox the agent works in (CODE-SANDBOX-01: the Stack's /stack/v1/sandboxes, pinned). Only the seam exists now. */
export interface CodingSandbox {
  start(input: { sessionId: string; environmentId: string }): Promise<void>;
  stop(sessionId: string): Promise<void>;
  destroy(sessionId: string): Promise<void>;
  /** CODE-BRAKE-01: Undo on a receipt restores the checkpoint the action started from (the checkpoint store is a later slice). */
  restoreCheckpoint?(input: { sessionId: string; checkpointId: string }): Promise<void>;
  /** CODE-AGENT-01: a snapshot of the workspace, taken before each turn so Undo has something to go back to. */
  snapshot?(input: { sessionId: string; label: string }): Promise<{ id: string; files: number }>;
}
export interface CodingRuntime { agent: CodingAgent; sandbox: CodingSandbox; lease: () => ChatLease }

let runtime: CodingRuntime | null = null;
/** Wires the agent, the sandbox and the Max lease. Until the real ones exist nothing calls this outside tests, so no turn can start in production. */
export function setCodingRuntime(next: CodingRuntime | null): void { runtime = next; }

type TurnState = "queued" | "running" | "done" | "failed" | "cancelled";
/** Why a queued turn waits, as the queue's own reason codes: the two caps (`coding.*`) or the lease's refusal mapped to `max_window`, `max_chat` or `tier_no_room`. */
type WaitReason = "coding.max_sessions" | "coding.person.max_sessions" | "max_window" | "max_chat" | "tier_no_room";
interface Turn {
  id: string; sessionId: string; personId: string; message: string;
  tier: Tier; state: TurnState; createdAt: number;
  capReason: WaitReason | null; leaseReason: WaitReason | null; leaseRefusal: LeaseRefusal | null;
  queueReason: QueueJob["riseReason"]; position: number | null;
  standardOnce: boolean; leaseHeld: boolean; stopReason: "user" | "wall_clock" | null; abort: AbortController; done: Promise<void>; finish: () => void;
}
const turns = new Map<string, Turn>();
const newTurnId = () => `ctrn-${randomSuffix(10)}`;

/** The wall-clock budget for one message (design 3.4): 30 minutes unless the person's own `coding.person.message_minutes` is lower or set; then the agent stops with a stopped-run. */
export const DEFAULT_MESSAGE_MINUTES = 30;
let budgetOverrideMs: number | null = null;
export function __setBudgetMsForTests(ms: number | null): void { budgetOverrideMs = ms; }
export function messageBudgetMs(person: PersonRow): number { return budgetMs(person); }
function budgetMs(person: PersonRow): number { return budgetOverrideMs ?? (positive(getPersonSettingValue(person, "coding.person.message_minutes")) ?? DEFAULT_MESSAGE_MINUTES) * 60_000; }

const log = (event: string, turn: Pick<Turn, "id" | "sessionId" | "personId">, extra = "") => appendLogLine(`coding ${event} turn=${turn.id} session=${turn.sessionId} person=${turn.personId}${extra ? ` ${extra}` : ""}`);
const ownerOf = (personId: string): PersonRow | undefined => db.select().from(people).where(eq(people.id, personId)).get() as PersonRow | undefined;
const positive = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) && value >= 1 ? Math.floor(value) : null);

/** The household cap on Code sessions working at once. `coding.max_sessions` is not in the settings registry yet (owed to the spec), so an unset value reads as 2: the conservative choice. */
export const DEFAULT_MAX_SESSIONS = 2;
let capOverride: number | null = null;
export function __setSessionCapForTests(n: number | null): void { capOverride = n; }
export function householdSessionCap(): number { return capOverride ?? positive(getHouseholdSettingValue("coding.max_sessions")) ?? DEFAULT_MAX_SESSIONS; }
/** A person's cap follows the home cap unless their own number is lower; the home cap always wins. */
export function personSessionCap(person: PersonRow): number { return Math.min(householdSessionCap(), positive(getPersonSettingValue(person, "coding.person.max_sessions")) ?? Infinity); }

function runningTurns(): Turn[] { return [...turns.values()].filter((turn) => turn.state === "running"); }
function capReasonFor(turn: Turn): WaitReason | null {
  const running = runningTurns().filter((other) => other.id !== turn.id);
  if (running.length >= householdSessionCap()) return "coding.max_sessions";
  const person = ownerOf(turn.personId);
  if (person && running.filter((other) => other.personId === turn.personId).length >= personSessionCap(person)) return "coding.person.max_sessions";
  return null;
}
const reasonForRefusal = (refusal: LeaseRefusal): WaitReason => (refusal === "max_window" ? "max_window" : refusal === "stack_busy" ? "max_chat" : "tier_no_room");

let retryMs = 5_000;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
export function __setCodingRetryMsForTests(ms: number | null): void { retryMs = ms ?? 5_000; if (retryTimer) clearTimeout(retryTimer); retryTimer = null; }
/** A turn that waits for the lease asks again in a few seconds; nothing else wakes the queue when another person's Max chat ends. */
function scheduleRetry(): void {
  if (retryTimer || ![...turns.values()].some((turn) => turn.state === "queued" && turn.leaseReason)) return;
  retryTimer = setTimeout(() => { retryTimer = null; void releaseHouseholdQueue(); }, retryMs);
  retryTimer.unref?.();
}

/** The household queue reads Code turns through this provider; tests that isolate the queue register it again. */
export const codingQueueProvider = () => [...turns.values()].filter((turn) => turn.state === "queued" || turn.state === "running").map((turn) => {
  const wait = turn.state === "queued" ? turn.capReason ?? capReasonFor(turn) ?? turn.leaseReason : null;
  const job: QueueJob = {
    id: turn.id, personId: turn.personId, jobClass: "other", category: "coding", tier: turn.tier, state: turn.state === "running" ? "running" : "queued",
    createdAt: turn.createdAt, position: turn.position, riseReason: wait ?? turn.queueReason, typicalSeconds: 120,
    ownsChatLease: turn.tier === "max" && chatLeaseHeldBy(turn.personId),
  };
  return {
    job,
    // A turn over a cap is not offered for release at all; `startTurn` checks again because two turns may be offered in one pass.
    release: turn.state === "queued" && !(turn.capReason ?? capReasonFor(turn)) ? () => startTurn(turn) : undefined,
    stop: turn.state === "running" ? async () => { turn.abort.abort(); } : undefined,
    save: () => { turn.position = job.position ?? null; turn.queueReason = job.riseReason && !String(job.riseReason).startsWith("coding.") && job.riseReason !== turn.leaseReason ? job.riseReason : null; },
  };
});
registerQueueProvider(codingQueueProvider);

function settle(turn: Turn, state: TurnState): void {
  turn.state = state;
  // The turn's session key ends with the turn, whatever the outcome.
  revokeSessionKeys(turn.sessionId);
  if (turn.leaseHeld) { turn.leaseHeld = false; try { runtime?.lease().requestEnded(); } catch { /* the lease's own idle timer ends it */ } }
  turn.finish();
}

async function startTurn(turn: Turn): Promise<void> {
  if (turn.state !== "queued" || !runtime) return;
  const cap = capReasonFor(turn);
  turn.capReason = cap;
  if (cap) return;
  const person = ownerOf(turn.personId);
  const session = getSessionRow(turn.personId, turn.sessionId);
  if (!person || !session) { settle(turn, "cancelled"); return; }
  // Every turn clamps again: the stored tier is a wish and the turn's tier is the truth (design 3.2). A "Use Standard for this message" pick stands for this turn only.
  const choice = correctStoredTier(session);
  turn.tier = turn.standardOnce ? "standard" : choice.tier;
  turn.leaseRefusal = null; turn.leaseReason = null;
  if (turn.tier === "max") {
    const lease = runtime.lease();
    const got = await lease.acquire(person, { category: "coding" });
    if (!got.ok) { turn.leaseRefusal = got.refusal; turn.leaseReason = reasonForRefusal(got.refusal); log("lease_refused", turn, `reason=${got.refusal}`); scheduleRetry(); return; }
    lease.requestStarted(); turn.leaseHeld = true;
  }
  if (turn.state !== "queued") { settle(turn, turn.state); return; } // stopped while the lease was loading
  turn.state = "running";
  updateSession(session.id, { state: "starting" });
  void runTurn(turn, session.environmentId);
}

async function runTurn(turn: Turn, environmentId: string): Promise<void> {
  const rt = runtime!;
  log("turn_started", turn, `tier=${turn.tier}`);
  const owner = ownerOf(turn.personId);
  const timer = owner ? setTimeout(() => { turn.stopReason ??= "wall_clock"; turn.abort.abort(); }, budgetMs(owner)) : null;
  timer?.unref?.();
  const stopped = (): void => {
    const reason = turn.stopReason ?? "user";
    appendCodingMessage({ sessionId: turn.sessionId, personId: turn.personId, role: "agent", parts: [{ type: "stopped", reason }] });
    recordCodingEvent({ sessionId: turn.sessionId, personId: turn.personId, kind: "stopped", detail: { reason } });
    log("turn_stopped", turn, `reason=${reason}`);
  };
  try {
    await rt.sandbox.start({ sessionId: turn.sessionId, environmentId });
    if (rt.sandbox.snapshot && !turn.abort.signal.aborted) {
      // The checkpoint Undo goes back to. A failed snapshot never fails the turn; the person just has no checkpoint for this message (reason code in the log).
      try { const snap = await rt.sandbox.snapshot({ sessionId: turn.sessionId, label: "Before your message" }); addCheckpoint(turn.sessionId, { id: snap.id, label: "Before your message", files: snap.files }); log("checkpoint_taken", turn); }
      catch (e) { log("checkpoint_failed", turn, `reason=${(e as { reason?: string }).reason ?? "error"}`); }
    }
    if (turn.abort.signal.aborted) { updateSession(turn.sessionId, { state: "idle" }); stopped(); settle(turn, "cancelled"); clearQueue(turn.sessionId); refreshHouseholdQueue(); return; }
    updateSession(turn.sessionId, { state: "working" });
    const host = createTurnHost({ sessionId: turn.sessionId, personId: turn.personId, signal: turn.abort.signal });
    const result = await rt.agent.runTurn({ sessionId: turn.sessionId, turnId: turn.id, tier: turn.tier, message: turn.message, signal: turn.abort.signal, host });
    if (turn.abort.signal.aborted) { updateSession(turn.sessionId, { state: "idle", lastActivityAt: new Date().toISOString() }); stopped(); settle(turn, "cancelled"); return; }
    const row = getSessionRow(turn.personId, turn.sessionId);
    if (row) {
      const modelId = result.modelId && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(result.modelId) ? result.modelId : null;
      updateSession(row.id, { state: "idle", lastActivityAt: new Date().toISOString(), ...(modelId ? { modelId } : {}),
        usage: { input_tokens: row.usage.input_tokens + (result.usage?.input_tokens ?? 0), output_tokens: row.usage.output_tokens + (result.usage?.output_tokens ?? 0) } });
    }
    log("turn_done", turn, `in=${result.usage?.input_tokens ?? 0} out=${result.usage?.output_tokens ?? 0}`);
    settle(turn, "done");
  } catch {
    // Reason code only: the error text can hold a path or a repository name (rule 6a).
    updateSession(turn.sessionId, { state: turn.abort.signal.aborted ? "idle" : "failed", lastActivityAt: new Date().toISOString() });
    if (turn.abort.signal.aborted) stopped(); else { log("turn_failed", turn); appendCodingMessage({ sessionId: turn.sessionId, personId: turn.personId, role: "agent", parts: [{ type: "stopped", reason: "error" }] }); }
    settle(turn, turn.abort.signal.aborted ? "cancelled" : "failed");
  } finally { if (timer) clearTimeout(timer); }
  if (turn.state === "done") advanceQueue(turn.sessionId, turn.personId); else clearQueue(turn.sessionId);
  refreshHouseholdQueue();
}

/** The person sends a message: it becomes one turn in the household queue. One turn per session at a time; messages typed meanwhile belong to the message queue (UI slice). */
export function submitTurn(person: PersonRow, sessionId: string, message: string): { turn_id: string; tier: Tier } {
  const refusal = codingSessionRefusal(person);
  if (refusal) throw new CodingSessionError("not_allowed", refusal);
  if (!runtime) throw new CodingSessionError("not_allowed", "Code sessions are not available on this home yet. Try again after the next update.");
  const notReady = runtime.agent.ready?.();
  if (notReady) throw new CodingSessionError("not_allowed", notReady);
  const session = getSessionRow(person.id, sessionId);
  if (!session) throw new CodingSessionError("not_found", "That session was not found. It may have been deleted.");
  if (!message.trim() || message.length > 200_000) throw new CodingSessionError("bad_input", "Write a message first, and keep it under 200,000 characters.");
  if ([...turns.values()].some((turn) => turn.sessionId === sessionId && (turn.state === "queued" || turn.state === "running"))) {
    throw new CodingSessionError("busy", "This session is still working on your last message. Wait for it, or stop it first.");
  }
  const choice = correctStoredTier(session);
  let finish = () => undefined as void;
  const done = new Promise<void>((resolve) => { finish = resolve; });
  const turn: Turn = { id: newTurnId(), sessionId, personId: person.id, message, tier: choice.tier, state: "queued", createdAt: Date.now(), capReason: null, leaseReason: null, leaseRefusal: null,
    queueReason: null, position: null, standardOnce: false, leaseHeld: false, stopReason: null, abort: new AbortController(), done, finish };
  turns.set(turn.id, turn);
  startTaint(sessionId, (session.repo as { kind?: string }).kind ?? "none");
  appendCodingMessage({ sessionId, personId: person.id, role: "user", parts: [{ type: "text", text: message }] });
  updateSession(sessionId, { state: "queued", lastActivityAt: new Date().toISOString() });
  log("turn_queued", turn, `tier=${turn.tier}`);
  refreshHouseholdQueue();
  return { turn_id: turn.id, tier: turn.tier };
}

/** What the person sees under the composer for a queued turn: the queue's own words for what it waits for (design 3.3). Null when the turn is not waiting. */
export function turnQueueLine(person: PersonRow, turnId: string): string | null {
  const turn = turns.get(turnId);
  if (!turn || turn.personId !== person.id || turn.state !== "queued") return null;
  const reason = (turn.capReason ?? capReasonFor(turn) ?? turn.leaseReason ?? turn.queueReason ?? "queue") as JobQueueReason;
  return jobQueueCopy("queued", reason, turn.position, null, audienceBand(person) === "adult" ? "adult" : "child");
}

/** Design 3.4: a Max turn that cannot get the lease offers one action. It runs this one turn at Standard and leaves the stored tier on Max. */
export function useStandardForThisMessage(person: PersonRow, turnId: string): boolean {
  requireCodingAccess(person);
  const turn = turns.get(turnId);
  if (!turn || turn.personId !== person.id || turn.state !== "queued" || turn.tier !== "max" || !turn.leaseReason) return false;
  turn.standardOnce = true; turn.tier = "standard"; turn.leaseReason = null; turn.leaseRefusal = null;
  log("use_standard_once", turn);
  refreshHouseholdQueue();
  return true;
}

/** True when the queued turn waits for the Max lease, so the page offers "Use Standard for this message". */
export function offersUseStandard(turnId: string): boolean {
  const turn = turns.get(turnId);
  return !!turn && turn.state === "queued" && turn.tier === "max" && !!turn.leaseReason;
}

// The message queue (design 3.3, the kit's `message-queue`): a message typed while the agent works waits here, in order, and a person can take one back.
// It is per session, in memory, at most MAX_QUEUED long. The next one becomes a turn when the current turn finishes well; Stop or a failure clears the rest.
export const MAX_QUEUED_MESSAGES = 10;
interface QueuedMessage { id: string; text: string }
const messageQueues = new Map<string, QueuedMessage[]>();
function clearQueue(sessionId: string): void { messageQueues.delete(sessionId); }
function advanceQueue(sessionId: string, personId: string): void {
  const next = messageQueues.get(sessionId)?.shift();
  const person = ownerOf(personId);
  if (!next || !person) return;
  try { submitTurn(person, sessionId, next.text); } catch { clearQueue(sessionId); log("queue_dropped", { id: "none", sessionId, personId }); }
}
/** The person's message: it starts a turn now, or joins the session's message queue when the agent is still working. */
export function sendMessage(person: PersonRow, sessionId: string, message: string): { turn_id: string; tier: Tier } | { queued_message_id: string; position: number } {
  const busy = [...turns.values()].some((turn) => turn.sessionId === sessionId && (turn.state === "queued" || turn.state === "running"));
  if (!busy) return submitTurn(person, sessionId, message);
  const refusal = codingSessionRefusal(person);
  if (refusal) throw new CodingSessionError("not_allowed", refusal);
  if (!getSessionRow(person.id, sessionId)) throw new CodingSessionError("not_found", "That session was not found. It may have been deleted.");
  if (!message.trim() || message.length > 200_000) throw new CodingSessionError("bad_input", "Write a message first, and keep it under 200,000 characters.");
  const queue = messageQueues.get(sessionId) ?? [];
  if (queue.length >= MAX_QUEUED_MESSAGES) throw new CodingSessionError("busy", "Too many messages are waiting in this session. Wait for the agent to catch up, or take one back.");
  const id = `cqm-${randomSuffix(8)}`;
  queue.push({ id, text: message }); messageQueues.set(sessionId, queue);
  appendLogLine(`coding message_queued session=${sessionId} person=${person.id} waiting=${queue.length}`);
  return { queued_message_id: id, position: queue.length };
}
/** The ✕ on a queued message. */
export function cancelQueuedMessage(person: Pick<PersonRow, "id">, sessionId: string, messageId: string): boolean {
  if (!getSessionRow(person.id, sessionId)) return false;
  const queue = messageQueues.get(sessionId); const at = queue?.findIndex((m) => m.id === messageId) ?? -1;
  if (!queue || at < 0) return false;
  queue.splice(at, 1); return true;
}
/** Messages waiting in a session, as ids and a count (the text is the person's; the page already holds it). */
export function queuedMessageIds(person: Pick<PersonRow, "id">, sessionId: string): string[] { return getSessionRow(person.id, sessionId) ? (messageQueues.get(sessionId) ?? []).map((m) => m.id) : []; }

/** The id of the session's queued or running turn, if any. */
export function activeTurnOf(sessionId: string): string | null { return [...turns.values()].find((t) => t.sessionId === sessionId && (t.state === "queued" || t.state === "running"))?.id ?? null; }

/** Resolves when the turn has finished, failed or been cancelled. */
export function turnFinished(turnId: string): Promise<void> { return turns.get(turnId)?.done ?? Promise.resolve(); }
export function turnState(turnId: string): TurnState | null { return turns.get(turnId)?.state ?? null; }

/** Stop cancels a queued turn and aborts a running one. The session returns to idle and keeps its tier. */
export function stopCodingSession(person: Pick<PersonRow, "id">, sessionId: string): boolean {
  if (!getSessionRow(person.id, sessionId)) return false;
  for (const turn of turns.values()) {
    if (turn.sessionId !== sessionId) continue;
    if (turn.state === "queued") { turn.stopReason ??= "user"; turn.abort.abort(); settle(turn, "cancelled"); log("turn_cancelled", turn); }
    else if (turn.state === "running") { turn.stopReason ??= "user"; turn.abort.abort(); }
  }
  clearQueue(sessionId);
  denyPendingFor(sessionId);
  revokeSessionKeys(sessionId);
  updateSession(sessionId, { state: "idle" });
  refreshHouseholdQueue();
  return true;
}

/** Undo on a receipt: restores the checkpoint through the sandbox and records it in the person's trail. The person's own click; the brake lets undo through always. */
export async function undoToCheckpoint(person: PersonRow, sessionId: string, checkpointId: string): Promise<void> {
  requireCodingAccess(person);
  if (!getSessionRow(person.id, sessionId)) throw new CodingSessionError("not_found", "That session was not found. It may have been deleted.");
  if (!runtime?.sandbox.restoreCheckpoint) throw new CodingSessionError("not_allowed", "Undo is not available for this session yet.");
  const known = (getSessionRow(person.id, sessionId)?.checkpoints ?? []).some((c) => c.id === checkpointId);
  if (!/^[A-Za-z0-9_.-]{1,80}$/.test(checkpointId) || !known) throw new CodingSessionError("bad_input", "That checkpoint is not valid. Pick one from the session's history.");
  await runtime.sandbox.restoreCheckpoint({ sessionId, checkpointId });
  recordCodingEvent({ sessionId, personId: person.id, kind: "checkpoint_restored", detail: { checkpoint_id: checkpointId } });
  appendLogLine(`coding checkpoint_restored session=${sessionId} person=${person.id}`);
}

/** Delete stops anything running, destroys the sandbox and moves the record to the trash. */
export async function deleteCodingSession(person: Pick<PersonRow, "id">, sessionId: string): Promise<boolean> {
  if (!getSessionRow(person.id, sessionId)) return false;
  stopCodingSession(person, sessionId);
  try { await runtime?.sandbox.destroy(sessionId); } catch { /* the sandbox reaper removes what is left */ }
  return markSessionDeleted(person, sessionId);
}

/** Tests only: forget every turn and the retry timer. */
export function __resetCodingTurnsForTests(): void { turns.clear(); messageQueues.clear(); budgetOverrideMs = null; runtime = null; capOverride = null; if (retryTimer) clearTimeout(retryTimer); retryTimer = null; }
