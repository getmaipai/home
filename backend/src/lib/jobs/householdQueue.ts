/** The shared household order for heavy jobs. This module has no database or notification dependency. */
import { DEFAULT_POLICY, scoreJobs, type JobCategory, type ScoreJob, type ScorePolicy, type ScoreReason } from "./jobScore";
import type { Category, CellState } from "./profileTable";
import { jobsAwaitingReopen, reopenForJob } from "./closeApps";
import { enterStackReducedChat, leaveStackReducedChat, setReducedChat, stackReducedChat } from "@/lib/reducedChat";
import { stackMaxWindow } from "./stackWindow";
import { fitForAdmission, resetFitHysteresisForTests, admissionFitAskLevels, admissionFitAskLine, admissionFitProfile, getProfileSource, type BudgetNow } from "./admissionFit";
import { isOwnerOrAdmin } from "@/lib/access";
export type QueueClass = "picture" | "video" | "other";
export type QueueState = "queued" | "running" | "paused" | "done" | "failed" | "cancelled";

export interface QueueJob {
  id: string;
  personId: string;
  jobClass: QueueClass;
  tier?: "standard" | "boost" | "max";
  state: QueueState;
  createdAt: string | number;
  position?: number | null;
  estimateSeconds?: number | null;
  riseReason?: "higher_class" | "other_person_first" | "requeued_memory" | "class" | "aging" | "fair_share" | "boost" | "profile_lowered" | "quiet_wait" | "cooldown_wait" | "heavy_slot" | "fairness_wait" | "max_window" | "max_chat" | "max_drain" | "tier_ask" | "tier_no_room" | null;
  category?: JobCategory;
  adminBoost?: number;
  /** The job can use otherwise idle room while the head waits. */
  backfillFits?: boolean;
  typicalSeconds?: number;
  remainingSeconds?: number;
  /** Marks a queued record whose worker is paused and is the head's blocker. */
  resourcePaused?: boolean;
  childDailyCapReached?: boolean;
  headOfClass?: boolean;
  fit?: { outcome: "run" | "ask" | "queue" | "refuse"; profile: { lowered: number; queued: number; off: number; closed_apps: number; closed_bytes: number }; askLine: string | null };
}

/** Waits a job store keeps on the card across a restart (the phase or stage reads `held:<reason>`), and the card words for them. One list for the three kinds of job. */
const HOLD_LIST = ["heavy_slot", "fairness_wait", "max_window", "max_chat", "max_drain", "tier_ask", "tier_no_room"] as const;
export type PersistedHold = typeof HOLD_LIST[number];
export const PERSISTED_HOLDS: readonly string[] = HOLD_LIST;
export interface QueuePosition { id: string; position: number }
export type AdmissionHold = "heavy_slot" | "max_drain" | "max_window" | "fairness_wait" | "max_chat";
export interface TierState {
  windowOpenFor: string | null;
  startedSinceMax: readonly string[];
  lastMaxPersonId: string | null;
  /** TIER-HOME-05: a Max chat lease is up; Boost and Max generator jobs wait with `max_chat`, Standard jobs go on. */
  chatLeaseHeld?: boolean;
}
export interface QueueStoreEntry { job: QueueJob; save: () => void; stackWaiting?: boolean; release?: () => Promise<void>; stop?: () => Promise<void>; applyFit?: (fit: NonNullable<QueueJob["fit"]>) => void }
type QueueProvider = () => QueueStoreEntry[];

/** The Max job whose plan lowered chat to Reduced (TIER-HOME-03): the chat line under the input shows while it runs. */
let reducedChatJobId: string | null = null;
const REDUCED_RENEW_MS = 5 * 60_000;
let lastReducedRenewAt = 0;
let reducedRenewal: ReturnType<typeof setTimeout> | null = null;
function scheduleReducedRenewal(): void {
  if (reducedRenewal) return;
  reducedRenewal = setTimeout(() => { reducedRenewal = null; void releaseHouseholdQueue(); }, REDUCED_RENEW_MS);
  reducedRenewal.unref?.();
}
let currentEntries: QueueStoreEntry[] = [];

/** The plan of the Boost or Max job now running (TIER-PRIO-04/05): what each category does while it runs. Kept in memory only; no person, no app name. */
interface ActivePlan { jobId: string; tier: "boost" | "max"; lead: Category; cells: Partial<Record<Category, CellState>> }
let activePlan: ActivePlan | null = null;
let pendingPlan: ActivePlan | null = null;
const PLAN_WORDS: Partial<Record<Category, string>> = { chat: "Chat", picture: "Pictures", video: "Video", music: "Music", tools: "Tools" };
const PLAN_ORDER: Category[] = ["chat", "picture", "video", "music", "tools"];
/** The admin-only status text, for example `Chat: Reduced · Pictures: Boost · Video: Max · Music: waiting`. Null when no profile is active.
 * Chat is named Reduced only when the Stack itself reports `reduced_chat` (a Boost job whose live-fit lowers chat, a refused swap, or a Max job that did not need it says nothing about chat).
 * A Max job planned to lower chat that has not started says it will simplify when the job starts. */
export async function activeProfileLine(): Promise<string | null> {
  if (!activePlan) {
    const waiting = pendingPlan && pendingPlan.tier === "max" && pendingPlan.cells.chat === "reduced" && currentEntries.some((entry) => entry.job.id === pendingPlan!.jobId && entry.job.state === "queued");
    return waiting ? "Chat: will simplify when the job starts" : null;
  }
  const plan = activePlan;
  const stackReduced = plan.cells.chat === "reduced" ? await stackReducedChat() : false;
  const parts = PLAN_ORDER.filter((category) => plan.cells[category] !== undefined && !(category === "chat" && plan.cells.chat === "reduced" && !stackReduced)).map((category) => {
    const state = plan.cells[category]!;
    return `${PLAN_WORDS[category]}: ${state === "queued" ? "waiting" : state === "off" ? "off" : state[0]!.toUpperCase() + state.slice(1)}`;
  });
  return parts.length > 0 ? parts.join(" · ") : null;
}
export function resetActivePlanForTests(): void { activePlan = null; reducedChatJobId = null; }
function jobCategory(job: QueueJob): Category { return job.jobClass === "picture" ? "picture" : job.jobClass === "video" ? "video" : job.category === "music" ? "music" : "tools"; }
/** A category the running plan queues or turns off waits for that job; the lead's own category is never held by its own plan. */
function heldByPlan(job: QueueJob): boolean {
  if (!activePlan || job.id === activePlan.jobId) return false;
  const state = activePlan.cells[jobCategory(job)];
  return state === "queued" || state === "off";
}

/** The running Max job as the Status line shows it: counts and minutes only, never an app or a person (RULES.md S6). Null when no Max job runs. */
export function openMaxWindow(): { minutesLeft: number | null } | null {
  const job = currentEntries.find((item) => item.job.state === "running" && item.job.tier === "max")?.job;
  return job ? { minutesLeft: stillRunningMinutes(job) } : null;
}

/** The Max window as the Stack says it (TIER-STATUS-01): open only while the governor holds the computer for a Max job. `minutesLeft` still comes from Home's own running Max job, because only Home knows the estimate. A Stack that cannot answer falls back to Home's record. */
export async function currentMaxWindow(): Promise<{ minutesLeft: number | null } | null> {
  const stack = await stackMaxWindow();
  if (!stack) return openMaxWindow();
  if (stack.state !== "open") return null;
  const job = currentEntries.find((item) => item.job.state === "running" && item.job.tier === "max")?.job;
  return { minutesLeft: job ? stillRunningMinutes(job) : null };
}

/** Admin Stop for the open Max window: ends the running Max job through its own store, which frees the room and lets chat return. False when the Stack says no window is open, or no Max job runs here. */
export async function endMaxWindow(): Promise<boolean> {
  if (!(await currentMaxWindow())) return false;
  const entry = currentEntries.find((item) => item.job.state === "running" && item.job.tier === "max");
  if (!entry?.stop) return false;
  await entry.stop();
  void releaseHouseholdQueue();
  return true;
}

/** TIER-PRIO-02/06: where the queue reads its policy (class order, aging delay, strict kinds, per-person limit). Null means the shipped defaults. */
let policySource: (() => ScorePolicy) | null = null;
export function setQueuePolicySource(source: (() => ScorePolicy) | null): void { policySource = source; }
function queuePolicy(): ScorePolicy { try { return policySource?.() ?? DEFAULT_POLICY; } catch { return DEFAULT_POLICY; } }
type UsageCredit = { personId: string; seconds: number; at: number };
const usageCredits: UsageCredit[] = [];
export function recordUsage(personId: string, runningSeconds: number, now: number): void {
  if (runningSeconds > 0 && Number.isFinite(runningSeconds)) usageCredits.push({ personId, seconds: runningSeconds, at: now });
}
export function usageLastHour(now: number): Record<string, number> {
  const cutoff = now - 3600_000;
  while (usageCredits.length && usageCredits[0]!.at < cutoff) usageCredits.shift();
  const usage: Record<string, number> = {};
  for (const credit of usageCredits) if (credit.at >= cutoff && credit.at <= now) usage[credit.personId] = (usage[credit.personId] ?? 0) + credit.seconds;
  return usage;
}
const lastAccrual = new Map<string, number>();
function accrueRunningUsage(jobs: readonly QueueJob[], now: number): void {
  const running = new Set(jobs.filter((job) => job.state === "running").map((job) => job.id));
  for (const job of jobs) if (job.state === "running") {
    const previous = lastAccrual.get(job.id);
    if (previous !== undefined) recordUsage(job.personId, Math.min(120, Math.max(0, (now - previous) / 1000)), now);
    lastAccrual.set(job.id, now);
  }
  for (const id of lastAccrual.keys()) if (!running.has(id)) lastAccrual.delete(id);
}

function createdAt(job: QueueJob): number {
  return typeof job.createdAt === "number" ? job.createdAt : Date.parse(job.createdAt);
}

function category(job: QueueJob): JobCategory { return job.category ?? (job.jobClass === "picture" ? "picture" : job.jobClass === "video" ? "video" : "tools"); }

/** Returns every waiting job in household start order, with one based positions. */
export function order(jobs: readonly QueueJob[], now: number, usage: Readonly<Record<string, number>> = {}): QueuePosition[] {
  const waiting = jobs.filter((job) => job.state === "queued" && !job.childDailyCapReached);
  const scoredJobs: ScoreJob[] = jobs.map((job) => ({ id: job.id, personId: job.personId, category: category(job), state: job.state === "running" ? "running" : "queued", createdAt: createdAt(job), adminBoost: job.adminBoost, childDailyCapReached: job.childDailyCapReached }));
  const ranked = scoreJobs(scoredJobs, queuePolicy(), now, usage);
  const head = waiting.filter((job) => job.headOfClass).sort((a, b) => createdAt(a) - createdAt(b));
  const headIds = new Set(head.map((job) => job.id));
  const ordered = [...head, ...ranked.filter((item) => !headIds.has(item.id)).map((item) => waiting.find((job) => job.id === item.id)!).filter(Boolean)];

  // Backfill is only allowed beside a paused blocker and when its measured
  // typical time is shorter than the blocker's remaining wait.
  const blocker = jobs.find((job) => job.resourcePaused && job.remainingSeconds !== undefined);
  if (blocker) {
    const headIndex = ordered.findIndex((job) => job.id === blocker.id);
    if (headIndex >= 0) {
      const candidateIndex = ordered.findIndex((job) => job.id !== blocker.id && job.backfillFits === true
        && job.typicalSeconds !== undefined && job.typicalSeconds < blocker.remainingSeconds!);
      if (candidateIndex > headIndex) ordered.unshift(...ordered.splice(candidateIndex, 1));
    }
  }
  return ordered.map((job, index) => ({ id: job.id, position: index + 1 }));
}

/** Applies tier admission rules without changing household order or cancelling work. */
export function admit(jobs: readonly QueueJob[], now: number, state: TierState): { start: string[]; holds: Record<string, AdmissionHold> } {
  const positions = order(jobs, now, usageLastHour(now));
  const queued = new Map(jobs.filter((job) => job.state === "queued" && !job.childDailyCapReached).map((job) => [job.id, job]));
  const running = jobs.filter((job) => job.state === "running");
  const openMax = state.windowOpenFor ? jobs.find((job) => job.id === state.windowOpenFor && job.state === "running" && job.tier === "max") : undefined;
  const holds: Record<string, AdmissionHold> = {};
  const start: string[] = [];
  let ordered = positions.map(({ id }) => queued.get(id)!).filter(Boolean);

  if (state.chatLeaseHeld) {
    for (const job of ordered) if (job.tier === "boost" || job.tier === "max") holds[job.id] = "max_chat";
    ordered = ordered.filter((job) => !holds[job.id]);
  }

  if (openMax) {
    for (const job of ordered) holds[job.id] = "max_window";
    return { start, holds };
  }

  const firstMaxIndex = ordered.findIndex((job) => job.tier === "max");
  const firstMax = firstMaxIndex < 0 ? undefined : ordered[firstMaxIndex];
  const otherWaitingPeople = new Set(ordered.filter((job) => job.tier !== "max" && job.personId !== firstMax?.personId)
    .map((job) => job.personId).filter((personId) => !state.startedSinceMax.includes(personId)));
  const fairnessApplies = !!firstMax && state.lastMaxPersonId !== null && otherWaitingPeople.size > 0;
  const draining = !!firstMax && running.length > 0;
  const heavyRunning = running.some((job) => job.tier === "boost" || job.tier === "max");

  let maxWaiting = false;
  for (let index = 0; index < ordered.length; index += 1) {
    const job = ordered[index]!;
    if (firstMax && job.id === firstMax.id) {
      if (draining) holds[job.id] = "max_drain";
      else if (fairnessApplies) holds[job.id] = "fairness_wait";
      else if (index > 0) holds[job.id] = "max_drain";
      else { start.push(job.id); break; }
      maxWaiting = true;
      continue;
    }
    if ((draining || maxWaiting) && index > firstMaxIndex) { holds[job.id] = "max_drain"; continue; }
    if (fairnessApplies && otherWaitingPeople.has(job.personId)) {
      // Only the first queued non-Max job for each waiting person is admitted.
      if (!start.some((id) => queued.get(id)?.personId === job.personId)) start.push(job.id);
      else holds[job.id] = "fairness_wait";
      continue;
    }
    if ((job.tier === "boost" || job.tier === "max") && heavyRunning) { holds[job.id] = "heavy_slot"; continue; }
    start.push(job.id);
  }
  return { start, holds };
}

export const CRITICAL_MEMORY_RETRY_LIMIT = 2;
export function requeueAfterCritical(job: { requeues: number }): "requeue_head" | "fail_low_memory" {
  return job.requeues < CRITICAL_MEMORY_RETRY_LIMIT ? "requeue_head" : "fail_low_memory";
}

export function stillRunningMinutes(job: QueueJob): number | null {
  if (job.state !== "running" || job.remainingSeconds === undefined || job.remainingSeconds <= 0) return null;
  return Math.ceil(job.remainingSeconds / 60);
}

/** Quiet window and cooldown (resource-profiles note, section 5). In memory only: only turn times are kept, never content. */
export interface ChatActivity { lastTurnAtByPerson: Record<string, number>; inFlight: number }
const chatTurns: Record<string, number> = {};
let chatInFlight = 0;
export function noteChatTurn(personId: string, now: number): void { chatTurns[personId] = now; }
export function noteChatInFlight(delta: 1 | -1): void { chatInFlight = Math.max(0, chatInFlight + delta); }
export function chatActivity(): ChatActivity { return { lastTurnAtByPerson: { ...chatTurns }, inFlight: chatInFlight }; }
export function resetChatActivityForTests(): void { for (const key of Object.keys(chatTurns)) delete chatTurns[key]; chatInFlight = 0; }

export interface QuietConfig { quietSeconds: number; quietMaxWaitSeconds: number | "never"; cooldownSeconds: number }
export const DEFAULT_QUIET: QuietConfig = { quietSeconds: 60, quietMaxWaitSeconds: 600, cooldownSeconds: 300 };
export interface DownshiftState { requestedAt: number | null; restoredAt: number | null; reducedNow: boolean; lastJobEndedAt: number | null }
export interface DownshiftDecision { action: "go" | "wait"; reason: "quiet_wait" | "cooldown" | "turn_boundary" | null; waitedSeconds: number }

/** Chat is never paused or cancelled; the only outcomes are wait and go. */
export function decideDownshift(opts: { now: number; requesterId: string; config: QuietConfig; activity: ChatActivity; state: DownshiftState; atTurnBoundary: boolean; chainedWindow?: boolean }): DownshiftDecision {
  const { now, requesterId, config, activity, state } = opts;
  const waitedSeconds = state.requestedAt === null ? 0 : Math.max(0, (now - state.requestedAt) / 1000);
  const chained = !!opts.chainedWindow && state.reducedNow && state.lastJobEndedAt !== null && (now - state.lastJobEndedAt) / 1000 <= config.cooldownSeconds;
  if (chained) return { action: "go", reason: null, waitedSeconds };
  if (!opts.chainedWindow && state.restoredAt !== null && (now - state.restoredAt) / 1000 < config.cooldownSeconds) return { action: "wait", reason: "cooldown", waitedSeconds };
  const quiet = Math.max(20, config.quietSeconds);
  const othersRecent = Object.entries(activity.lastTurnAtByPerson).some(([person, at]) => person !== requesterId && (now - at) / 1000 < quiet);
  if (!othersRecent && activity.inFlight === 0) return { action: "go", reason: null, waitedSeconds };
  if (config.quietMaxWaitSeconds !== "never" && state.requestedAt !== null && waitedSeconds >= config.quietMaxWaitSeconds) {
    return opts.atTurnBoundary ? { action: "go", reason: null, waitedSeconds } : { action: "wait", reason: "turn_boundary", waitedSeconds };
  }
  return { action: "wait", reason: "quiet_wait", waitedSeconds };
}

/** Upshift has no delay: restore as soon as the window ended and a turn boundary is reached. */
export function mayRestoreNow(state: { reducedNow: boolean }, atTurnBoundary: boolean): boolean { return state.reducedNow && atTurnBoundary; }

export function quietSecondsFor(category: "chat" | "image" | "video" | "music", config: QuietConfig): number {
  return category === "chat" ? Math.max(20, config.quietSeconds) : 0;
}

/** Reads a tier the job's request asked for; anything else is Standard. */
export function requestTier(request: unknown): "standard" | "boost" | "max" {
  const tier = (request as { tier?: unknown } | null | undefined)?.tier;
  return tier === "boost" || tier === "max" ? tier : "standard";
}

/** Counts a chat turn for the quiet window (turn time and in-flight count only) and undoes the in-flight count once, on the lease's own release. */
let chatTurnObserver: { started: () => void; ended: () => void } | null = null;
/** TIER-HOME-05: the Max chat lease learns when a turn starts and ends, to guard a request in flight. */
export function setChatTurnObserver(observer: { started: () => void; ended: () => void } | null): void { chatTurnObserver = observer; }
export function trackChatLease<T extends { release(): void }>(personId: string, lease: T, now = Date.now()): T {
  noteChatTurn(personId, now);
  noteChatInFlight(1);
  try { chatTurnObserver?.started(); } catch { /* the observer is advisory */ }
  const release = lease.release.bind(lease);
  let counted = true;
  lease.release = () => { if (counted) { counted = false; noteChatInFlight(-1); noteChatTurn(personId, Date.now()); try { chatTurnObserver?.ended(); } catch { /* advisory */ } } release(); };
  return lease;
}

/** TIER-PRIO-07: a Boost or Max job that would only fit below the tier its person picked asks first (`ask`). In memory only: the question's words and the answer, never an app or a name. */
export const FIT_ASK_TIMEOUT_MS = 10 * 60_000;
interface FitAsk { personId: string; askedAt: number; line: string | null; levels?: { picked: string; actual: string }; answer: "allow" | "wait" | null }
const fitAsks = new Map<string, FitAsk>();
let fitAskTimeoutMs = FIT_ASK_TIMEOUT_MS;
export function setFitAskTimeoutForTests(ms: number | null): void { fitAskTimeoutMs = ms ?? FIT_ASK_TIMEOUT_MS; }
export function resetFitAsksForTests(): void { fitAsks.clear(); fitAskTimeoutMs = FIT_ASK_TIMEOUT_MS; }
/** The open question for a job, or null when none is waiting for an answer (never asked, answered, or timed out into Wait). */
export function pendingFitAsk(jobId: string, now = Date.now()): { personId: string; line: string | null; secondsLeft: number } | null {
  const ask = fitAsks.get(jobId);
  if (!ask || ask.answer !== null) return null;
  const left = fitAskTimeoutMs - (now - ask.askedAt);
  return left > 0 ? { personId: ask.personId, line: ask.line, secondsLeft: Math.ceil(left / 1000) } : null;
}
/** The card field for an open question: `{ job_id }` when the job is asking and this person may answer (the job's owner or an admin), else null. */
export function answerableFitAsk(person: { id: string; role: string }, jobId: string): { job_id: string; picked: string | null; actual: string | null } | null {
  const ask = pendingFitAsk(jobId);
  if (!ask) return null;
  return ask.personId === person.id || isOwnerOrAdmin(person) ? { job_id: jobId, picked: fitAsks.get(jobId)?.levels?.picked ?? null, actual: fitAsks.get(jobId)?.levels?.actual ?? null } : null;
}
/** The person's answer: Allow runs the job at the lower tier now, Wait keeps it queued for the tier they picked. False when no question is open. */
export function answerFitAsk(jobId: string, answer: "allow" | "wait"): boolean {
  const ask = fitAsks.get(jobId);
  if (!ask || ask.answer !== null || pendingFitAsk(jobId) === null) return false;
  ask.answer = answer;
  void releaseHouseholdQueue();
  return true;
}
/** MAX-LIVE-02: a job held as `tier_no_room` waits for memory the Stack reads live; nothing else wakes the queue when that memory frees (2026-11-01: a Max video sat held for two minutes at 83 GB free), so it looks again on its own. */
const NO_ROOM_RECHECK_MS = 5_000;
let noRoomRecheckMs = NO_ROOM_RECHECK_MS;
let noRoomRecheck: ReturnType<typeof setTimeout> | null = null;
export function setNoRoomRecheckForTests(ms: number | null): void { noRoomRecheckMs = ms ?? NO_ROOM_RECHECK_MS; if (noRoomRecheck) clearTimeout(noRoomRecheck); noRoomRecheck = null; }
export function scheduleNoRoomRecheck(): void {
  if (noRoomRecheck) return;
  noRoomRecheck = setTimeout(() => { noRoomRecheck = null; void releaseHouseholdQueue(); }, noRoomRecheckMs);
  noRoomRecheck.unref?.();
}
/** MAX-LIVE-02 and MEM-RETRY-01: the Stack refused a Max job, or a job it stopped for memory that Home started again, at submit with `no_memory` (its watchdog is not at normal). Home keeps the job queued and looks again in a few seconds instead of failing it, for about five minutes; a Standard or Boost job keeps the stored refusal (rule 6) unless Home restarted it after the watchdog stopped it. Returns false when the job is not Max or the time is used up. */
export const MAX_SUBMIT_MEMORY_HOLDS = 60;
export function holdMaxAfterMemoryRefusal(request: object | null | undefined): boolean {
  // A job the Stack's watchdog stopped is started again by Home, and the Stack refuses new work until it has recovered (about a minute after the pressure ends): that refusal is part of the same wait, for any level, never a failure.
  const restarted = ((request as { memoryRequeues?: number } | null | undefined)?.memoryRequeues ?? 0) > 0;
  if (requestTier(request) !== "max" && !restarted) return false;
  const state = request as { submitMemoryHolds?: number };
  state.submitMemoryHolds = (state.submitMemoryHolds ?? 0) + 1;
  if (state.submitMemoryHolds > MAX_SUBMIT_MEMORY_HOLDS) return false;
  scheduleNoRoomRecheck();
  return true;
}
let askRecheck: ReturnType<typeof setTimeout> | null = null;
function scheduleAskRecheck(ms: number): void {
  if (askRecheck) clearTimeout(askRecheck);
  askRecheck = setTimeout(() => { askRecheck = null; void releaseHouseholdQueue(); }, Math.max(1000, Math.min(ms, 60_000)) + 50);
  askRecheck.unref?.();
}

/** The window, fairness and heavy-slot memory behind `admit`. Process memory only. */
const tierState: TierState = { windowOpenFor: null, startedSinceMax: [], lastMaxPersonId: null };
/** PRIO-03: the quiet-window settings, read at every Max admission. Null means the defaults. */
let quietConfigSource: (() => QuietConfig) | null = null;
export function setQuietConfigSource(source: (() => QuietConfig) | null): void { quietConfigSource = source; }
const downshiftRequestedAt = new Map<string, number>();
const downshiftMemory = { restoredAt: null as number | null, lastJobEndedAt: null as number | null };
let downshiftRecheck: ReturnType<typeof setTimeout> | null = null;
export function resetDownshiftForTests(): void { downshiftRequestedAt.clear(); downshiftMemory.restoredAt = null; downshiftMemory.lastJobEndedAt = null; if (downshiftRecheck) clearTimeout(downshiftRecheck); downshiftRecheck = null; }
/** A held job has no event to wake it when chat goes quiet, so look again in a few seconds. */
function scheduleDownshiftRecheck(): void {
  if (downshiftRecheck) return;
  downshiftRecheck = setTimeout(() => { downshiftRecheck = null; void releaseHouseholdQueue(); }, 5000);
  downshiftRecheck.unref?.();
}
let chatLeaseSource: (() => boolean) | null = null;
/** TIER-HOME-05: where the queue reads whether the Max chat lease is up (`chatLease.holdsGenerators`). Null clears it. */
export function setChatLeaseSource(source: (() => boolean) | null): void { chatLeaseSource = source; }
export function resetTierStateForTests(): void { tierState.windowOpenFor = null; tierState.startedSinceMax = []; tierState.lastMaxPersonId = null; }

/** Updates only changed records. The caller supplies its own store writer. */
export function writePositions<T extends QueueJob>(jobs: readonly T[], now: number, write: (job: T) => void): QueuePosition[] {
  const positions = order(jobs, now, usageLastHour(now));
  const byId = new Map(positions.map((item) => [item.id, item.position]));
  const previous = new Map(jobs.map((job) => [job.id, job.position ?? null]));
  for (const job of jobs) {
    const next = byId.get(job.id) ?? null;
    const old = previous.get(job.id) ?? null;
    let riseReason: QueueJob["riseReason"] = job.riseReason === "requeued_memory" || job.riseReason === "tier_ask" || job.riseReason === "tier_no_room" || job.riseReason === "profile_lowered" || job.riseReason === "quiet_wait" || job.riseReason === "cooldown_wait" || job.riseReason === "heavy_slot" || job.riseReason === "fairness_wait" || job.riseReason === "max_window" || job.riseReason === "max_chat" || job.riseReason === "max_drain" ? job.riseReason : null;
    if (next !== null && old !== null && next > old) {
      const overtaker = positions.filter((item) => item.position < next && item.position < (previous.get(item.id) ?? Infinity)).sort((a, b) => b.position - a.position)[0];
      if (overtaker) {
        const pair = [job, jobs.find((candidate) => candidate.id === overtaker.id)!];
        const usage = usageLastHour(now);
        const scored = scoreJobs(pair.map((candidate) => ({ id: candidate.id, personId: candidate.personId, category: category(candidate), state: candidate.state === "running" ? "running" : "queued", createdAt: createdAt(candidate), adminBoost: candidate.adminBoost, childDailyCapReached: candidate.childDailyCapReached })), queuePolicy(), now, usage);
        const difference = (a: typeof scored[number], b: typeof scored[number]): ScoreReason | null => {
          const diffs: [ScoreReason, number][] = [["class", a.terms.classWeight - b.terms.classWeight], ["aging", a.terms.aging - b.terms.aging], ["fair_share", a.terms.fairShare - b.terms.fairShare], ["boost", a.terms.boost - b.terms.boost]];
          return diffs.filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "arrival";
        };
        const overtaking = scored.find((item) => item.id === overtaker.id)!;
        const displaced = scored.find((item) => item.id === job.id)!;
        const reason = difference(overtaking, displaced);
        riseReason = reason === "arrival" ? "other_person_first" : reason;
      }
    }
    const estimateSeconds = next === null ? null : estimate(jobs, positions, next);
    if (job.position !== next || job.estimateSeconds !== estimateSeconds || job.riseReason !== riseReason) {
      job.position = next;
      job.estimateSeconds = estimateSeconds;
      job.riseReason = riseReason as T["riseReason"];
      write(job);
    }
  }
  return positions;
}

function estimate(jobs: readonly QueueJob[], positions: readonly QueuePosition[], position: number): number | null {
  const before = positions.filter((item) => item.position < position);
  let seconds = 0;
  for (const item of before) {
    const job = jobs.find((candidate) => candidate.id === item.id)!;
    const duration = job.state === "running" || job.resourcePaused ? job.remainingSeconds : job.typicalSeconds;
    if (duration === undefined) return null;
    seconds += duration;
  }
  return seconds;
}

const providers = new Set<QueueProvider>();
let releasing = false;
let releaseAgain = false;
const lastFit = new Map<string, string>();
const LAST_FIT_LIMIT = 200;
function forgetFinishedFits(jobs: readonly QueueJob[]): void {
  const active = new Set(jobs.filter((job) => job.state === "queued" || job.state === "running").map((job) => job.id));
  for (const id of lastFit.keys()) if (!active.has(id)) lastFit.delete(id);
  for (const id of fitAsks.keys()) if (!active.has(id)) fitAsks.delete(id);
}
function rememberFit(id: string, key: string): void {
  lastFit.delete(id);
  lastFit.set(id, key);
  while (lastFit.size > LAST_FIT_LIMIT) lastFit.delete(lastFit.keys().next().value!);
}
export function rememberFitForTests(id: string, key: string): void { rememberFit(id, key); }
export function fitMemorySizeForTests(): number { return lastFit.size; }
export function resetFitMemoryForTests(): void { lastFit.clear(); resetFitHysteresisForTests(); }
let budgetReader: (() => Promise<BudgetNow>) | null = null;
export function setBudgetReader(fn: (() => Promise<BudgetNow>) | null): void { budgetReader = fn; }
async function stackBudget(): Promise<BudgetNow> {
  if (budgetReader) return budgetReader();
  try {
    const client = await import("@/lib/stack/client");
    if (typeof client.createStackClient !== "function") throw new Error("budget unavailable");
    const budget = await client.createStackClient().budget();
    return { freeMemoryBytes: budget.freeMemoryBytes, loaded: budget.loaded.map((item) => ({ class: (item as typeof item & { class?: string }).class ?? item.kind, peakBytes: item.peakBytes, pinned: item.pinned, measured: item.measured })), ...(budget.margin_bytes !== undefined ? { marginBytes: budget.margin_bytes } : {}), readingDegraded: budget.memoryReadingDegraded === true };
  } catch { throw new Error("budget unavailable"); }
}

/** Tests that drive the queue with their own jobs: take the registered providers (video, picture, music... from other test files in the same process) out of the way and put them back with the returned function. Also clears the release lock and the Reduced renewal clock. */
export function isolateQueueProvidersForTests(): () => void {
  const saved = [...providers];
  providers.clear();
  releasing = false; releaseAgain = false; lastReducedRenewAt = 0;
  if (reducedRenewal) clearTimeout(reducedRenewal);
  reducedRenewal = null; pendingPlan = null; currentEntries = [];
  return () => { providers.clear(); for (const p of saved) providers.add(p); };
}

export function registerQueueProvider(provider: QueueProvider): () => void {
  providers.add(provider);
  return () => providers.delete(provider);
}

/** Recomputes the shared number after an existing job-store change. */
export function refreshHouseholdQueue(now = Date.now()): QueuePosition[] {
  const entries = [...providers].flatMap((provider) => provider());
  accrueRunningUsage(entries.map((entry) => entry.job), now);
  const positions = writePositions(entries.map((entry) => entry.job), now, (job) => entries.find((entry) => entry.job === job)?.save());
  void releaseHouseholdQueue();
  return positions;
}

/** Submit held Home jobs in household order, keeping at most one not-yet-started job of each kind in Stack. */
export async function releaseHouseholdQueue(): Promise<void> {
  if (releasing) { releaseAgain = true; return; }
  releasing = true;
  try {
    do {
      releaseAgain = false;
      const entries = [...providers].flatMap((provider) => provider());
      const jobs = entries.map((entry) => entry.job);
      forgetFinishedFits(jobs);
      const now = Date.now();
      accrueRunningUsage(jobs, now);
      const usage = usageLastHour(now);
      const positions = order(jobs, now, usage);
      const runningMax = jobs.find((job) => job.state === "running" && job.tier === "max");
      tierState.windowOpenFor = runningMax?.id ?? null;
      tierState.chatLeaseHeld = chatLeaseSource?.() ?? false;
      currentEntries = entries;
      for (const id of jobsAwaitingReopen()) {
        if (jobs.some((item) => item.id === id)) continue;
        const close = getProfileSource()?.close;
        await reopenForJob(id, close ?? { mode: "off", always: [], never: [], reopen: true, noReopen: [] });
      }
      if (activePlan && !jobs.some((item) => item.id === activePlan!.jobId)) activePlan = null;
      for (const entry of entries) {
        if (entry.job.state !== "queued") continue;
        const held = heldByPlan(entry.job);
        if (held && entry.job.riseReason !== "profile_lowered") { entry.job.riseReason = "profile_lowered"; entry.save(); }
        else if (!held && entry.job.riseReason === "profile_lowered") { entry.job.riseReason = null; entry.save(); }
      }
      if (runningMax && runningMax.id === reducedChatJobId) {
        setReducedChat({ minutesLeft: stillRunningMinutes(runningMax) });
        // TIER-WIRE-02: the Stack leaves Reduced by itself after 30 minutes without a renewing `{on:true}`, so a long Max job renews it.
        if (now - lastReducedRenewAt >= REDUCED_RENEW_MS) { lastReducedRenewAt = now; await enterStackReducedChat(); }
        scheduleReducedRenewal();
      } else if (reducedChatJobId !== null) {
        // The Max window ended: upshift has no delay but waits for a turn boundary (`mayRestoreNow`); the Stack answers 202 while a turn is in flight.
        if (mayRestoreNow({ reducedNow: true }, chatActivity().inFlight === 0)) {
          const left = await leaveStackReducedChat();
          if (left === "waiting") { setReducedChat({ minutesLeft: null }); scheduleDownshiftRecheck(); }
          else { downshiftMemory.restoredAt = now; downshiftMemory.lastJobEndedAt = now; reducedChatJobId = null; setReducedChat(null); }
          // A failed leave is not retried forever: renewals stop, so the Stack leaves Reduced by itself, and the composer line follows the Stack.
        } else { setReducedChat({ minutesLeft: null }); scheduleDownshiftRecheck(); }
      } else setReducedChat(null);
      if (runningMax) tierState.lastMaxPersonId = runningMax.personId;
      const admission = admit(jobs, now, tierState);
      const admitted = new Set(admission.start);
      for (const entry of entries) {
        if (entry.job.state !== "queued") continue;
        const hold = admission.holds[entry.job.id] ?? null;
        const specific = entry.job.riseReason === "tier_ask" || entry.job.riseReason === "tier_no_room" || entry.job.riseReason === "profile_lowered" || entry.job.riseReason === "quiet_wait" || entry.job.riseReason === "cooldown_wait" || entry.job.riseReason === "requeued_memory";
        if (hold && !specific && entry.job.riseReason !== hold) { entry.job.riseReason = hold; entry.save(); }
        else if (!hold && ["heavy_slot", "fairness_wait", "max_window", "max_chat", "max_drain"].includes(entry.job.riseReason ?? "")) { entry.job.riseReason = null; entry.save(); }
      }
      const byId = new Map(entries.map((entry) => [entry.job.id, entry]));
      const blockedClasses = new Set(entries.filter((entry) => entry.stackWaiting).map((entry) => entry.job.jobClass));
      const policy = queuePolicy();
      const runningByPerson = new Map<string, number>();
      for (const entry of entries) if (entry.job.state === "running") runningByPerson.set(entry.job.personId, (runningByPerson.get(entry.job.personId) ?? 0) + 1);
      for (const item of positions) {
        const entry = byId.get(item.id);
        if (!entry?.release || !admitted.has(item.id) || blockedClasses.has(entry.job.jobClass) || (runningByPerson.get(entry.job.personId) ?? 0) >= policy.maxConcurrentPerPerson || heldByPlan(entry.job)) continue;
        if ((entry.job.tier === "boost" || entry.job.tier === "max") && getProfileSource() !== null) {
          try {
            const fit = await fitForAdmission(entry.job as { id: string; jobClass: "picture" | "video" | "other"; category?: string; tier: "boost" | "max" }, stackBudget);
            if (fit) {
              const admission = { outcome: fit.outcome, profile: admissionFitProfile(fit), askLine: admissionFitAskLine(fit, (entry.job as QueueJob & { audience?: "adult" | "child" }).audience ?? "adult") } as NonNullable<QueueJob["fit"]>;
              entry.job.fit = admission;
              // Save only when the answer changed: a save refreshes the queue, which would run this loop again forever for a job that keeps waiting.
              const key = JSON.stringify(admission);
              if (lastFit.get(entry.job.id) !== key) { rememberFit(entry.job.id, key); entry.applyFit?.(admission); }
              if (fit.outcome === "ask") {
                // TIER-PRIO-07: the person decides whether to run lower now (Allow) or wait for the tier they picked (Wait). No answer in ten minutes counts as Wait, so nothing stays stuck on a question.
                const ask = fitAsks.get(entry.job.id) ?? { personId: entry.job.personId, askedAt: now, line: null, answer: null as FitAsk["answer"] };
                ask.line = admission.askLine;
                ask.levels = admissionFitAskLevels(fit);
                fitAsks.set(entry.job.id, ask);
                if (ask.answer === null && now - ask.askedAt >= fitAskTimeoutMs) ask.answer = "wait";
                if (ask.answer !== "allow") {
                  const reason = ask.answer === null ? "tier_ask" : "tier_no_room";
                  if (entry.job.riseReason !== reason) { entry.job.riseReason = reason; entry.save(); }
                  if (ask.answer === null) scheduleAskRecheck(fitAskTimeoutMs - (now - ask.askedAt)); else scheduleNoRoomRecheck();
                  continue;
                }
                if (entry.job.riseReason === "tier_ask" || entry.job.riseReason === "tier_no_room") { entry.job.riseReason = null; entry.save(); }
              } else if (fit.outcome !== "run") {
                if (entry.job.riseReason !== "tier_no_room") { entry.job.riseReason = "tier_no_room"; entry.save(); }
                scheduleNoRoomRecheck();
                continue;
              }
              if (fit.applied?.cells.chat?.state === "reduced") {
                // PRIO-03 (S1 to S4): chat is lowered only after a quiet moment, outside the cooldown; chat is never paused, so the wait is bounded.
                const requestedAt = downshiftRequestedAt.get(entry.job.id) ?? now;
                downshiftRequestedAt.set(entry.job.id, requestedAt);
                const activity = chatActivity();
                const decision = decideDownshift({ now, requesterId: entry.job.personId, config: quietConfigSource?.() ?? DEFAULT_QUIET, activity,
                  state: { requestedAt, restoredAt: downshiftMemory.restoredAt, reducedNow: reducedChatJobId !== null, lastJobEndedAt: downshiftMemory.lastJobEndedAt }, atTurnBoundary: activity.inFlight === 0 });
                if (decision.action === "wait") {
                  const reason = decision.reason === "cooldown" ? "cooldown_wait" : "quiet_wait";
                  if (entry.job.riseReason !== reason) { entry.job.riseReason = reason; entry.save(); }
                  scheduleDownshiftRecheck();
                  continue;
                }
                downshiftRequestedAt.delete(entry.job.id);
                if (entry.job.riseReason === "quiet_wait" || entry.job.riseReason === "cooldown_wait") { entry.job.riseReason = null; entry.save(); }
                // Recorded before the Max swap so a job still waiting for its turn boundary can say it will simplify chat when it starts.
                if (fit.applied) pendingPlan = { jobId: entry.job.id, tier: entry.job.tier as "boost" | "max", lead: fit.applied.lead, cells: Object.fromEntries(Object.entries(fit.applied.cells).map(([category, cell]) => [category, cell.state])) };
                if (entry.job.tier === "max") {
                  // TIER-WIRE-02: ask the Stack to swap chat to its Reduced model before the Max job starts.
                  const entered = await enterStackReducedChat();
                  if (entered === "waiting") {
                    // A chat turn is in flight: the swap waits for the turn boundary, like the quiet wait.
                    if ((entry.job.riseReason as string | null | undefined) !== "quiet_wait") { entry.job.riseReason = "quiet_wait"; entry.save(); }
                    scheduleDownshiftRecheck();
                    continue;
                  }
                  if (entered === "ok") { reducedChatJobId = entry.job.id; lastReducedRenewAt = now; }
                  // An older Stack (404) or a refused swap leaves chat normal with no line; the plan then does not claim Reduced chat.
                  else if (fit.applied.cells.chat) { delete (fit.applied.cells as Record<string, unknown>).chat; if (pendingPlan) delete pendingPlan.cells.chat; }
                }
              }
              if (fit.applied) pendingPlan = { jobId: entry.job.id, tier: entry.job.tier as "boost" | "max", lead: fit.applied.lead, cells: Object.fromEntries(Object.entries(fit.applied.cells).map(([category, cell]) => [category, cell.state])) };
            }
          } catch { /* Fit is advisory: admission proceeds as it did before. */ }
        }
        blockedClasses.add(entry.job.jobClass);
        if (pendingPlan && pendingPlan.jobId !== entry.job.id) pendingPlan = null;
        if (entry.job.tier === "max") { tierState.startedSinceMax = []; tierState.lastMaxPersonId = entry.job.personId; }
        else if (!tierState.startedSinceMax.includes(entry.job.personId)) tierState.startedSinceMax = [...tierState.startedSinceMax, entry.job.personId];
        runningByPerson.set(entry.job.personId, (runningByPerson.get(entry.job.personId) ?? 0) + 1);
        try { await entry.release(); if (pendingPlan?.jobId === entry.job.id) activePlan = pendingPlan; } catch { /* The job store records a submit failure; other kinds can proceed. */ }
      }
    } while (releaseAgain);
  } finally { releasing = false; }
}
