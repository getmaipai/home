// The "tests are stable" gate: rig/flaky.sh runs the whole suite N times and writes data-scratch/flaky-last.json; ready.ts refuses to call the lab ready when that run is missing, found a failure even once, or is older than the newest test file.
export interface FlakyStatus { at_ms: number; runs: number; failures: Array<{ name: string; count: number }> }
export function flakyVerdict(s: FlakyStatus | null, newestTestMtimeMs: number, minRuns = 5): { ok: boolean; why: string } {
  if (!s) return { ok: false, why: "no flaky run recorded: run `bash rig/flaky.sh 10` in labs/voice-lab" };
  if (s.failures.length) return { ok: false, why: `the last flaky run (${s.runs} runs) saw ${s.failures.map((f) => `"${f.name}" fail ${f.count}x`).join(", ")}: fix the cause, then rerun rig/flaky.sh` };
  if (s.runs < minRuns) return { ok: false, why: `the last flaky run had only ${s.runs} runs (need at least ${minRuns})` };
  if (s.at_ms < newestTestMtimeMs) return { ok: false, why: "a test file changed after the last flaky run: rerun `bash rig/flaky.sh 10`" };
  return { ok: true, why: `suite passed ${s.runs}/${s.runs} runs, none flaky, newer than every test file` };
}
