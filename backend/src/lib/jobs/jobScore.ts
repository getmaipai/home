export type JobCategory = "picture" | "video" | "music" | "tools" | "background";
export interface ScoreJob { id: string; personId: string; category: JobCategory; state: "queued" | "running"; createdAt: number; adminBoost?: number; childDailyCapReached?: boolean }
export interface ScorePolicy {
  classWeights: Record<JobCategory, number>;
  agingPerMinute: number;
  fairShareMax: number;
  maxConcurrentPerPerson: number;
}
export const DEFAULT_POLICY: ScorePolicy = {
  classWeights: { picture: 60, video: 40, music: 30, tools: 20, background: 5 },
  agingPerMinute: 1,
  fairShareMax: 20,
  maxConcurrentPerPerson: 1,
};
export interface ScoreTerms { classWeight: number; aging: number; fairShare: number; boost: number }
export type ScoreReason = "class" | "aging" | "fair_share" | "boost" | "arrival";
export interface Scored { id: string; position: number; score: number; terms: ScoreTerms; startable: boolean; reason: ScoreReason | null }

export function scoreJobs(jobs: readonly ScoreJob[], policy: ScorePolicy, now: number, usage: Readonly<Record<string, number>>): Scored[] {
  const queued = jobs.filter((job) => job.state === "queued" && job.childDailyCapReached !== true);
  const maxUsage = Math.max(0, ...Object.values(usage));
  const oldest = new Map<string, number>();
  const running = new Map<string, number>();
  for (const job of jobs) {
    if (job.state === "running") running.set(job.personId, (running.get(job.personId) ?? 0) + 1);
    if (job.state === "queued" && !jobs.some((other) => other.personId === job.personId && other.state === "running")) oldest.set(job.personId, Math.min(oldest.get(job.personId) ?? Infinity, job.createdAt));
  }
  const weights = Object.values(policy.classWeights);
  const scored = queued.map((job) => {
    const classWeight = policy.classWeights[job.category];
    const next = Math.min(...weights.filter((weight) => weight > classWeight), Infinity);
    const aging = next === Infinity ? 0 : Math.min(Math.max(0, now - job.createdAt) / 60_000 * policy.agingPerMinute, next - classWeight);
    const fairShare = maxUsage === 0 ? 0 : policy.fairShareMax * (1 - (usage[job.personId] ?? 0) / maxUsage);
    const boost = job.adminBoost ?? 0;
    const terms = { classWeight, aging, fairShare, boost };
    return { job, score: classWeight + aging + fairShare + boost, terms, personOldest: oldest.get(job.personId) ?? Infinity };
  }).sort((a, b) => b.score - a.score || a.personOldest - b.personOldest || a.job.createdAt - b.job.createdAt || a.job.id.localeCompare(b.job.id));
  return scored.map((item, index) => {
    const next = scored[index + 1];
    let reason: ScoreReason | null = null;
    if (next) {
      const diffs: [ScoreReason, number][] = [
        ["class", item.terms.classWeight - next.terms.classWeight],
        ["aging", item.terms.aging - next.terms.aging],
        ["fair_share", item.terms.fairShare - next.terms.fairShare],
        ["boost", item.terms.boost - next.terms.boost],
      ];
      const winner = diffs.filter(([, diff]) => diff > 0).sort((a, b) => b[1] - a[1])[0];
      reason = winner?.[0] ?? "arrival";
    }
    return { id: item.job.id, position: index + 1, score: item.score, terms: item.terms,
      startable: (running.get(item.job.personId) ?? 0) < policy.maxConcurrentPerPerson, reason };
  });
}
