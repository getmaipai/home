// Hub speech bursts: the live Stack's speech server (mlx-audio) is asked to warm up or speak by Home requests from other sessions and by the family, in short bursts.
// A burst shorter than BURST_MAX_MS does not reset the free window or abort a run; it is counted and labelled. A sustained load (over BURST_MAX_MS) and any other named engine (video, image, chat) still block.
export const BURST_MAX_MS = 10_000;
export const isSpeechJob = (job: string) => /mlx[-_]audio|mlx_tts_server/i.test(job);
export type BurstSample = { free: boolean; burst: boolean };
export class BurstFilter {
  bursts: Array<{ at: number; ms: number }> = []; private streakStart = -1; private lastAt = -1; private cur: { at: number; ms: number } | null = null;
  constructor(private maxMs = BURST_MAX_MS) {}
  /** `jobs` are the named engines found at this sample (empty = none). Returns whether the sample counts as free for the window. */
  push(nowMs: number, jobs: string[]): BurstSample {
    const speechOnly = jobs.length > 0 && jobs.every(isSpeechJob);
    if (jobs.length === 0) { this.close(nowMs); return { free: true, burst: false }; }
    if (!speechOnly) { this.close(nowMs); return { free: false, burst: false }; }
    if (this.streakStart < 0) { this.streakStart = nowMs; this.cur = { at: nowMs, ms: 0 }; }
    const dt = this.lastAt >= 0 && this.lastAt >= this.streakStart ? nowMs - this.lastAt : 0; this.lastAt = nowMs;
    if (this.cur) this.cur.ms += dt || 1;
    const lasted = nowMs - this.streakStart;
    if (lasted >= this.maxMs) { this.cur = null; return { free: false, burst: false }; }   // sustained: blocks as any other engine
    return { free: true, burst: true };
  }
  private close(nowMs: number) { if (this.cur) { this.bursts.push({ at: this.cur.at, ms: Math.max(this.cur.ms, 1) }); this.cur = null; } this.streakStart = -1; this.lastAt = -1; void nowMs; }
  finish(nowMs: number) { this.close(nowMs); }
  summary() { const total = this.bursts.reduce((a, b) => a + b.ms, 0); return { count: this.bursts.length, totalMs: total, intervals: this.bursts.map((b) => ({ atIso: new Date(b.at).toISOString(), ms: b.ms })) }; }
}
