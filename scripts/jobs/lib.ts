// HOST-LAUNCH-01 (owner, 2026-11-12): shared pieces of the dev job launcher (job.ts) and the lease broker (lease.ts).
// Everything here runs as the user, never root. State lives in one directory (MAIPAI_JOBS_DIR, default ~/.local/state/maipai/jobs):
//   jobs/<id>.json  one record per launched job      audit.jsonl  one line per action      leases/  the broker's tickets and holders
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const stateDir = (): string => process.env.MAIPAI_JOBS_DIR ?? join(homedir(), ".local", "state", "maipai", "jobs");
export const jobsDir = (): string => join(stateDir(), "jobs");
export const ensureDirs = (...dirs: string[]): void => { for (const d of dirs) mkdirSync(d, { recursive: true, mode: 0o700 }); };

export type JobType = "test" | "build" | "server" | "other";
/** Default wall-clock limits in seconds; the tests and build limits are well above a normal run so only a hang trips them. */
export const DEFAULT_TIMEOUT_S: Record<JobType, number> = { test: 900, build: 600, server: 0, other: 1800 };
export const jobTypeOf = (v: string | undefined): JobType => (v === "test" || v === "build" || v === "server" || v === "other" ? v : "other");

export type Audit = { session: string; command: string; worktree: string; trigger: string; action: string; job?: string; detail?: string };
/** One line per action the launcher or broker takes, so "why did my job stop" always has an answer. */
export function audit(entry: Audit): void {
  ensureDirs(stateDir());
  appendFileSync(join(stateDir(), "audit.jsonl"), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
}
export function readAudit(): Array<Audit & { ts: string }> {
  try { return readFileSync(join(stateDir(), "audit.jsonl"), "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
}

export type JobRecord = {
  id: string; type: JobType; session: string; worktree: string; command: string; pid: number; pgid: number; startedAt: number;
  state: "running" | "paused" | "done" | "failed" | "unfinished" | "stopped"; exitCode?: number; endedAt?: number;
  /** A server has an explicit end time (epoch seconds); other types end when their command does. */
  until?: number; log: string;
  /** Refreshed every tick by the launcher: group memory (MB) and CPU percent, which peers read to judge progress and who is largest. */
  rssMb?: number; cpu?: number;
};
export function writeJob(rec: JobRecord): void {
  ensureDirs(jobsDir());
  const f = join(jobsDir(), `${rec.id}.json`);
  writeFileSync(`${f}.tmp`, JSON.stringify(rec));
  renameSync(`${f}.tmp`, f);
}
export function readJobs(): JobRecord[] {
  try { return readdirSync(jobsDir()).filter((n) => n.endsWith(".json")).flatMap((n) => { try { return [JSON.parse(readFileSync(join(jobsDir(), n), "utf-8")) as JobRecord]; } catch { return []; } }); } catch { return []; }
}
export const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; } };

/** The text of a duration: "90" seconds, or "30m", "8h", "2d". */
export function parseDuration(v: string): number {
  const m = /^(\d+)([smhd]?)$/.exec(v.trim());
  if (!m) throw new Error(`bad duration "${v}"; use seconds or a number with s, m, h or d`);
  return Number(m[1]) * ({ "": 1, s: 1, m: 60, h: 3600, d: 86400 } as Record<string, number>)[m[2]!]!;
}

export type Pressure = { level: number; devShed: boolean };
/** Memory pressure and the host guard's dev-shed flag come from scripts/lib/hostmem.sh, the one definition of both. */
export function readPressure(repoRoot: string): Pressure {
  const out = Bun.spawnSync(["/bin/bash", "-c", `. "${join(repoRoot, "scripts", "lib", "hostmem.sh")}"; hostmem_pressure; hostmem_dev_shed && echo shed || echo calm`], { stdout: "pipe", stderr: "ignore" }).stdout.toString().trim().split("\n");
  return { level: Number(out[0]) || 0, devShed: out[1] === "shed" };
}

export type LaunchInputs = { loadPerCore: number; running: number; progressing: number; pressure: Pressure; freeDiskGb: number; cap: number; minDiskGb: number };
export type LaunchDecision = { go: boolean; why: string; limit: number };
/**
 * Progress-aware saturation. A load average alone cannot tell a busy but healthy Mac from a hung one (2026-11-12: load 25 to 37 while
 * tests hung). So: high load with every running job still making progress lowers the concurrency limit (jobs finish, then new ones
 * start); high load with a running job that is not progressing pauses new launches outright. Memory pressure or a low disk also pause.
 */
export function decideLaunch(i: LaunchInputs): LaunchDecision {
  if (i.pressure.devShed || i.pressure.level >= 2) return { go: false, why: "memory pressure: new launches wait for it to clear", limit: 0 };
  if (i.freeDiskGb < i.minDiskGb) return { go: false, why: `disk almost full (${i.freeDiskGb.toFixed(1)} GB free): new launches wait`, limit: 0 };
  if (i.loadPerCore >= 1.5) {
    if (i.running > i.progressing) return { go: false, why: `CPU saturated (load ${i.loadPerCore.toFixed(1)} per core) and ${i.running - i.progressing} running job(s) are not progressing: new launches wait`, limit: 0 };
    const limit = Math.max(1, Math.floor(i.cap / 2));
    return i.running >= limit ? { go: false, why: `CPU saturated (load ${i.loadPerCore.toFixed(1)} per core): concurrency lowered to ${limit}`, limit } : { go: true, why: "", limit };
  }
  return i.running >= i.cap ? { go: false, why: `${i.running} jobs already running (limit ${i.cap})`, limit: i.cap } : { go: true, why: "", limit: i.cap };
}

/** Per-job memory rule: pause on pressure, then the responsible job (the largest, if it also grew) is stopped; others resume. */
export function memoryAction(job: { rssMb: number; growthMb: number }, biggestRssMb: number, pressureOn: boolean, maxRssMb: number): "none" | "pause" | "stop" {
  if (job.rssMb > maxRssMb) return "stop";
  if (!pressureOn) return "none";
  return job.rssMb >= biggestRssMb && job.growthMb > 256 ? "stop" : "pause";
}
