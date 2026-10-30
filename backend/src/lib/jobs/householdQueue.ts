/** The shared household order for heavy jobs. This module has no database or notification dependency. */
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
  riseReason?: "higher_class" | "other_person_first" | "requeued_memory" | null;
  /** The job can use otherwise idle room while the head waits. */
  backfillFits?: boolean;
  typicalSeconds?: number;
  remainingSeconds?: number;
  /** Marks a queued record whose worker is paused and is the head's blocker. */
  resourcePaused?: boolean;
  childDailyCapReached?: boolean;
  headOfClass?: boolean;
}

export interface QueuePosition { id: string; position: number }
export type AdmissionHold = "heavy_slot" | "max_drain" | "max_window" | "fairness_wait";
export interface TierState {
  windowOpenFor: string | null;
  startedSinceMax: readonly string[];
  lastMaxPersonId: string | null;
}
export interface QueueStoreEntry { job: QueueJob; save: () => void; stackWaiting?: boolean; release?: () => Promise<void> }
type QueueProvider = () => QueueStoreEntry[];

const CLASS_RANK: Record<QueueClass, number> = { picture: 0, video: 1, other: 2 };
const AGING_MS = 10 * 60_000;

function createdAt(job: QueueJob): number {
  return typeof job.createdAt === "number" ? job.createdAt : Date.parse(job.createdAt);
}

function effectiveClass(job: QueueJob, now: number): number {
  const base = CLASS_RANK[job.jobClass];
  if (now - createdAt(job) < AGING_MS) return base;
  return Math.max(0, base - 1);
}

function compare(a: QueueJob, b: QueueJob, now: number): number {
  return effectiveClass(a, now) - effectiveClass(b, now) || createdAt(a) - createdAt(b) || a.id.localeCompare(b.id);
}

/** Returns every waiting job in household start order, with one based positions. */
export function order(jobs: readonly QueueJob[], now: number): QueuePosition[] {
  const waiting = jobs.filter((job) => job.state === "queued" && !job.childDailyCapReached);
  const classes = [...new Set(waiting.map((job) => effectiveClass(job, now)))].sort((a, b) => a - b);
  const ordered: QueueJob[] = [];
  for (const rank of classes) {
    const inClass = waiting.filter((job) => effectiveClass(job, now) === rank);
    const byPerson = new Map<string, QueueJob[]>();
    for (const job of inClass.sort((a, b) => Number(!!b.headOfClass) - Number(!!a.headOfClass) || createdAt(a) - createdAt(b) || a.id.localeCompare(b.id))) {
      const personJobs = byPerson.get(job.personId) ?? [];
      personJobs.push(job);
      byPerson.set(job.personId, personJobs);
    }
    const people = [...byPerson.keys()].sort((a, b) => Number(!!byPerson.get(b)![0]!.headOfClass) - Number(!!byPerson.get(a)![0]!.headOfClass) || createdAt(byPerson.get(a)![0]!) - createdAt(byPerson.get(b)![0]!) || a.localeCompare(b));
    for (let round = 0; ; round += 1) {
      let added = false;
      for (const person of people) {
        const job = byPerson.get(person)![round];
        if (job) { ordered.push(job); added = true; }
      }
      if (!added) break;
    }
  }

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
  const positions = order(jobs, now);
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

/** Updates only changed records. The caller supplies its own store writer. */
export function writePositions<T extends QueueJob>(jobs: readonly T[], now: number, write: (job: T) => void): QueuePosition[] {
  const positions = order(jobs, now);
  const byId = new Map(positions.map((item) => [item.id, item.position]));
  const previous = new Map(jobs.map((job) => [job.id, job.position ?? null]));
  for (const job of jobs) {
    const next = byId.get(job.id) ?? null;
    const old = previous.get(job.id) ?? null;
    let riseReason: QueueJob["riseReason"] = job.riseReason === "requeued_memory" ? "requeued_memory" : null;
    if (next !== null && old !== null && next > old) {
      const preceding = positions.filter((item) => item.position < next).map((item) => jobs.find((candidate) => candidate.id === item.id)!);
      const higherClass = preceding.some((candidate) => effectiveClass(candidate, now) < effectiveClass(job, now));
      riseReason = higherClass ? "higher_class" : "other_person_first";
    }
    const estimateSeconds = next === null ? null : estimate(jobs, positions, next);
    if (job.position !== next || job.estimateSeconds !== estimateSeconds || job.riseReason !== riseReason) {
      job.position = next;
      job.estimateSeconds = estimateSeconds;
      job.riseReason = riseReason;
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

export function registerQueueProvider(provider: QueueProvider): () => void {
  providers.add(provider);
  return () => providers.delete(provider);
}

/** Recomputes the shared number after an existing job-store change. */
export function refreshHouseholdQueue(now = Date.now()): QueuePosition[] {
  const entries = [...providers].flatMap((provider) => provider());
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
      const positions = order(jobs, Date.now());
      const byId = new Map(entries.map((entry) => [entry.job.id, entry]));
      const blockedClasses = new Set(entries.filter((entry) => entry.stackWaiting).map((entry) => entry.job.jobClass));
      const runningPeople = new Set(entries.filter((entry) => entry.job.state === "running").map((entry) => entry.job.personId));
      for (const item of positions) {
        const entry = byId.get(item.id);
        if (!entry?.release || blockedClasses.has(entry.job.jobClass) || runningPeople.has(entry.job.personId)) continue;
        blockedClasses.add(entry.job.jobClass);
        try { await entry.release(); } catch { /* The job store records a submit failure; other kinds can proceed. */ }
      }
    } while (releaseAgain);
  } finally { releasing = false; }
}
