import { DEFAULT_POLICY, scoreJobs, type JobCategory, type ScoreJob, type ScorePolicy } from "./jobScore";

export interface SimJob { id: string; personId: string; category: JobCategory; arriveAt: number; durationSec: number }
export interface SimResult { started: Record<string, number>; finished: Record<string, number>; waitSec: Record<string, number> }

export function simulate(jobs: readonly SimJob[], policy: ScorePolicy = DEFAULT_POLICY, opts: { usageWindowSec?: number } = {}): SimResult {
  const started: Record<string, number> = {};
  const finished: Record<string, number> = {};
  const waitSec: Record<string, number> = {};
  const startedJobs: SimJob[] = [];
  const pending = [...jobs];
  const running = new Map<string, { job: SimJob; finish: number }>();
  const history: { personId: string; at: number; duration: number }[] = [];
  const window = opts.usageWindowSec ?? 3600;
  let now = Math.min(...jobs.map((job) => job.arriveAt), 0);
  while (pending.length || running.size) {
    for (const [id, item] of running) if (item.finish <= now) { finished[id] = item.finish; running.delete(id); }
    const arrived = pending.filter((job) => job.arriveAt <= now);
    const usage: Record<string, number> = {};
    for (const entry of history) if (now - entry.at <= window) usage[entry.personId] = (usage[entry.personId] ?? 0) + entry.duration;
    if (!running.size && arrived.length) {
      const active: ScoreJob[] = [...arrived.map((job) => ({ id: job.id, personId: job.personId, category: job.category, state: "queued" as const, createdAt: job.arriveAt * 1000 }))];
      const ranked = scoreJobs(active, policy, now * 1000, usage).filter((item) => item.startable);
      const choice = ranked[0];
      if (choice) {
        const job = arrived.find((item) => item.id === choice.id)!;
        started[job.id] = now;
        startedJobs.push(job);
        waitSec[job.id] = now - job.arriveAt;
        running.set(job.id, { job, finish: now + job.durationSec });
        history.push({ personId: job.personId, at: now, duration: job.durationSec });
        pending.splice(pending.indexOf(job), 1);
        continue;
      }
    }
    const nextArrival = Math.min(...pending.map((job) => job.arriveAt).filter((at) => at > now), Infinity);
    const nextFinish = Math.min(...[...running.values()].map((item) => item.finish), Infinity);
    const next = Math.min(nextArrival, nextFinish);
    if (next === Infinity) break;
    now = next;
  }
  for (const [id, item] of running) finished[id] = item.finish;
  return { started, finished, waitSec };
}

export function checkInvariants(result: SimResult, jobs: readonly SimJob[], bounds: Partial<Record<JobCategory, number>>): string[] {
  const violations: string[] = [];
  for (const job of jobs) {
    if (result.started[job.id] === undefined) violations.push(`${job.id} never started`);
    else if (bounds[job.category] !== undefined && (result.waitSec[job.id] ?? 0) > bounds[job.category]!) violations.push(`${job.id} exceeded its ${job.category} wait bound`);
  }
  // Fair share: a job must not start ahead of a same-category job from another person who arrived earlier, is still waiting, and has used less in the window.
  const window = 3600;
  const usageAt = (person: string, at: number) => jobs
    .filter((other) => other.personId === person && result.started[other.id] !== undefined && result.started[other.id]! < at && at - result.started[other.id]! <= window)
    .reduce((sum, other) => sum + other.durationSec, 0);
  for (const job of jobs) {
    const at = result.started[job.id];
    if (at === undefined) continue;
    const passed = jobs.find((other) => other.personId !== job.personId && other.category === job.category && other.arriveAt < job.arriveAt
      && (result.started[other.id] ?? Infinity) > at && usageAt(other.personId, at) < usageAt(job.personId, at));
    if (passed) violations.push(`${job.id} started ahead of ${passed.id}, which waited longer and had used less`);
  }
  return violations;
}

export function seededJobs(seed: number, count: number, people: number): SimJob[] {
  let state = seed >>> 0;
  const random = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 0x1_0000_0000; };
  const categories: JobCategory[] = ["picture", "video", "music", "tools", "background"];
  return Array.from({ length: count }, (_, index) => ({ id: `job-${index + 1}`, personId: `person-${Math.floor(random() * people) + 1}`,
    category: categories[Math.floor(random() * categories.length)]!, arriveAt: Math.floor(random() * 14400), durationSec: 30 + Math.floor(random() * 300) }));
}
