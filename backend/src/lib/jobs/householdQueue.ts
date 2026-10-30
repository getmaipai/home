/** The shared household order for heavy jobs. This module has no database or notification dependency. */
import { DEFAULT_POLICY, scoreJobs, type JobCategory, type ScoreJob, type ScorePolicy, type ScoreReason } from "./jobScore";
import { fitForAdmission, admissionFitAskLine, admissionFitProfile, getProfileSource, type BudgetNow } from "./admissionFit";
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
  riseReason?: "higher_class" | "other_person_first" | "requeued_memory" | "class" | "aging" | "fair_share" | "boost" | null;
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

export interface QueuePosition { id: string; position: number }
export type AdmissionHold = "heavy_slot" | "max_drain" | "max_window" | "fairness_wait";
export interface TierState {
  windowOpenFor: string | null;
  startedSinceMax: readonly string[];
  lastMaxPersonId: string | null;
}
export interface QueueStoreEntry { job: QueueJob; save: () => void; stackWaiting?: boolean; release?: () => Promise<void>; applyFit?: (fit: NonNullable<QueueJob["fit"]>) => void }
type QueueProvider = () => QueueStoreEntry[];

let queuePolicy: ScorePolicy = DEFAULT_POLICY;
export function setQueuePolicy(policy: ScorePolicy): void { queuePolicy = policy; }
export function getQueuePolicy(): ScorePolicy { return queuePolicy; }

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
  const ranked = scoreJobs(scoredJobs, queuePolicy, now, usage);
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
  const ordered = positions.map(({ id }) => queued.get(id)!).filter(Boolean);

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

export function requeueAfterCritical(job: { requeues: number }): "requeue_head" | "fail_low_memory" {
  return job.requeues < 2 ? "requeue_head" : "fail_low_memory";
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
export function trackChatLease<T extends { release(): void }>(personId: string, lease: T, now = Date.now()): T {
  noteChatTurn(personId, now);
  noteChatInFlight(1);
  const release = lease.release.bind(lease);
  let counted = true;
  lease.release = () => { if (counted) { counted = false; noteChatInFlight(-1); noteChatTurn(personId, Date.now()); } release(); };
  return lease;
}

/** The window, fairness and heavy-slot memory behind `admit`. Process memory only. */
const tierState: TierState = { windowOpenFor: null, startedSinceMax: [], lastMaxPersonId: null };
export function resetTierStateForTests(): void { tierState.windowOpenFor = null; tierState.startedSinceMax = []; tierState.lastMaxPersonId = null; }

/** Updates only changed records. The caller supplies its own store writer. */
export function writePositions<T extends QueueJob>(jobs: readonly T[], now: number, write: (job: T) => void): QueuePosition[] {
  const positions = order(jobs, now, usageLastHour(now));
  const byId = new Map(positions.map((item) => [item.id, item.position]));
  const previous = new Map(jobs.map((job) => [job.id, job.position ?? null]));
  for (const job of jobs) {
    const next = byId.get(job.id) ?? null;
    const old = previous.get(job.id) ?? null;
    let riseReason: QueueJob["riseReason"] = job.riseReason === "requeued_memory" ? "requeued_memory" : null;
    if (next !== null && old !== null && next > old) {
      const overtaker = positions.filter((item) => item.position < next && item.position < (previous.get(item.id) ?? Infinity)).sort((a, b) => b.position - a.position)[0];
      if (overtaker) {
        const pair = [job, jobs.find((candidate) => candidate.id === overtaker.id)!];
        const usage = usageLastHour(now);
        const scored = scoreJobs(pair.map((candidate) => ({ id: candidate.id, personId: candidate.personId, category: category(candidate), state: candidate.state === "running" ? "running" : "queued", createdAt: createdAt(candidate), adminBoost: candidate.adminBoost, childDailyCapReached: candidate.childDailyCapReached })), queuePolicy, now, usage);
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
export function resetFitMemoryForTests(): void { lastFit.clear(); }
let budgetReader: (() => Promise<BudgetNow>) | null = null;
export function setBudgetReader(fn: (() => Promise<BudgetNow>) | null): void { budgetReader = fn; }
async function stackBudget(): Promise<BudgetNow> {
  if (budgetReader) return budgetReader();
  try {
    const client = await import("@/lib/stack/client");
    if (typeof client.createStackClient !== "function") throw new Error("budget unavailable");
    const budget = await client.createStackClient().budget();
    return { freeMemoryBytes: budget.freeMemoryBytes, loaded: budget.loaded.map((item) => ({ class: (item as typeof item & { class?: string }).class ?? item.kind, peakBytes: item.peakBytes, pinned: item.pinned })) };
  } catch { throw new Error("budget unavailable"); }
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
      const now = Date.now();
      accrueRunningUsage(jobs, now);
      const usage = usageLastHour(now);
      const positions = order(jobs, now, usage);
      const runningMax = jobs.find((job) => job.state === "running" && job.tier === "max");
      tierState.windowOpenFor = runningMax?.id ?? null;
      if (runningMax) tierState.lastMaxPersonId = runningMax.personId;
      const admitted = new Set(admit(jobs, now, tierState).start);
      const byId = new Map(entries.map((entry) => [entry.job.id, entry]));
      const blockedClasses = new Set(entries.filter((entry) => entry.stackWaiting).map((entry) => entry.job.jobClass));
      const runningPeople = new Set(entries.filter((entry) => entry.job.state === "running").map((entry) => entry.job.personId));
      for (const item of positions) {
        const entry = byId.get(item.id);
        if (!entry?.release || !admitted.has(item.id) || blockedClasses.has(entry.job.jobClass) || runningPeople.has(entry.job.personId)) continue;
        if ((entry.job.tier === "boost" || entry.job.tier === "max") && getProfileSource() !== null) {
          try {
            const fit = await fitForAdmission(entry.job as { jobClass: "picture" | "video" | "other"; category?: string; tier: "boost" | "max" }, stackBudget);
            if (fit) {
              const admission = { outcome: fit.outcome, profile: admissionFitProfile(fit), askLine: admissionFitAskLine(fit, (entry.job as QueueJob & { audience?: "adult" | "child" }).audience ?? "adult") } as NonNullable<QueueJob["fit"]>;
              entry.job.fit = admission;
              // Save only when the answer changed: a save refreshes the queue, which would run this loop again forever for a job that keeps waiting.
              const key = JSON.stringify(admission);
              if (lastFit.get(entry.job.id) !== key) { lastFit.set(entry.job.id, key); entry.applyFit?.(admission); }
              if (fit.outcome !== "run") continue;
            }
          } catch { /* Fit is advisory: admission proceeds as it did before. */ }
        }
        blockedClasses.add(entry.job.jobClass);
        if (entry.job.tier === "max") { tierState.startedSinceMax = []; tierState.lastMaxPersonId = entry.job.personId; }
        else if (!tierState.startedSinceMax.includes(entry.job.personId)) tierState.startedSinceMax = [...tierState.startedSinceMax, entry.job.personId];
        try { await entry.release(); } catch { /* The job store records a submit failure; other kinds can proceed. */ }
      }
    } while (releaseAgain);
  } finally { releasing = false; }
}
