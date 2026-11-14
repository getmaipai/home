// HOST-LAUNCH-01 (owner, 2026-11-12): shared pieces of the dev job launcher (job.ts) and the lease broker (lease.ts).
// Everything here runs as the user, never root. State lives in one directory (MAIPAI_JOBS_DIR, default ~/.local/state/maipai/jobs):
//   jobs/<id>.json  one record per launched job      audit.jsonl  one line per action      leases/  the broker's tickets and holders
import { appendFileSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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

export type LaunchInputs = { loadPerCore: number; running: number; progressing: number; pressure: Pressure; freeDiskGb: number; cap: number; minDiskGb: number; type?: JobType; devUsedGb?: number; devBudgetGb?: number };
export type LaunchDecision = { go: boolean; why: string; limit: number };
/**
 * Progress-aware saturation. A load average alone cannot tell a busy but healthy Mac from a hung one (2026-11-12: load 25 to 37 while
 * tests hung). So: high load with every running job still making progress lowers the concurrency limit (jobs finish, then new ones
 * start); high load with a running job that is not progressing pauses new launches outright. Memory pressure or a low disk also pause.
 */
export function decideLaunch(i: LaunchInputs): LaunchDecision {
  if (i.pressure.devShed || i.pressure.level >= 2) return { go: false, why: "memory pressure: new launches wait for it to clear", limit: 0 };
  if (i.freeDiskGb < i.minDiskGb) return { go: false, why: `disk almost full (${i.freeDiskGb.toFixed(1)} GB free): new launches wait`, limit: 0 };
  if (i.type === "server") return { go: true, why: "", limit: i.cap };
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

export type OrphanInput = {
  pid: number; ppid: number;
  /** pids written in the worktree's dev pid files (backend, vite, watch); null when a file is empty or missing. */
  pidFiles: { backend: number | null; vite: number | null; watch: number | null };
  isAlive: (pid: number) => boolean;
  /** epoch seconds this process was first seen with nobody owning it; null when it was owned at the last look. */
  orphanSince: number | null; now: number; graceS: number;
};
export type OrphanVerdict = { state: "owned" | "orphan-waiting" | "orphan-stop"; since: number | null };
/**
 * DEV-REAPER-01: a `bun run --hot` is provably dead only when its worktree's pid files do not name it (or the launcher that started it),
 * the hub's watcher is gone, and it has been so for the whole grace period (60 minutes). Any owner at all means it is left alone.
 */
export function orphanVerdict(i: OrphanInput): OrphanVerdict {
  const named = [i.pidFiles.backend, i.pidFiles.vite].some((p) => p !== null && (p === i.pid || p === i.ppid) && i.isAlive(p));
  const watcherUp = i.pidFiles.watch !== null && i.isAlive(i.pidFiles.watch);
  if (named || watcherUp) return { state: "owned", since: null };
  const since = i.orphanSince ?? i.now;
  return { state: i.now - since >= i.graceS ? "orphan-stop" : "orphan-waiting", since };
}

/** DEV-BUDGET-02: true when the process or any descendant of it uses at least `minCpu` percent of a core right now (ps, no root). */
export function treeActive(rootPid: number, minCpu = 1): boolean {
  const out = Bun.spawnSync(["/bin/ps", "-axo", "pid=,ppid=,pcpu="], { stdout: "pipe", stderr: "ignore" }).stdout.toString();
  const rows = out.split("\n").flatMap((l) => { const m = /^\s*(\d+)\s+(\d+)\s+([\d.]+)/.exec(l); return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), cpu: Number(m[3]) }] : []; });
  const tree = new Set([rootPid]);
  for (let grew = true; grew;) { grew = false; for (const r of rows) if (!tree.has(r.pid) && tree.has(r.ppid)) { tree.add(r.pid); grew = true; } }
  return rows.some((r) => tree.has(r.pid) && r.cpu >= minCpu);
}
/** Seconds a development lease may show no activity before the broker releases it (MAIPAI_LEASE_IDLE_S, else MAIPAI_LEASE_IDLE_MIN minutes, default 10). */
export const leaseIdleS = (): number => { const s = Number(process.env.MAIPAI_LEASE_IDLE_S); if (Number.isFinite(s) && s > 0) return s; const m = Number(process.env.MAIPAI_LEASE_IDLE_MIN); return Number.isFinite(m) && m > 0 ? m * 60 : 600; };
export const devLeaseFile = (): string => join(stateDir(), "dev-lease.json");

// GUARD-STRAY-01 (2026-11-13): test runs that bypassed job.sh (raw `bun test` in a wt/ worktree) ran for hours and starved the lander's gate.
/** ps etime ([[dd-]hh:]mm:ss) in seconds, or null when it does not parse. */
export function etimeSeconds(v: string): number | null {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(v.trim());
  return m ? Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3]) * 60 + Number(m[4]) : null;
}
export type PsRow = { pid: number; ppid: number; pgid: number; ageS: number; command: string };
export function parsePs(out: string): PsRow[] {
  return out.split("\n").flatMap((l) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(l); const age = m ? etimeSeconds(m[4]!) : null;
    return m && age !== null ? [{ pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), ageS: age, command: m[5]! }] : [];
  });
}
export const isTestCommand = (c: string): boolean => /(^|\/)bun\s+(test\b|run\s+test)/.test(c);
/** Worktrees (wt/, .claude/worktrees) and the lander/watcher warm checkouts. */
export const strayDir = (cwd: string): boolean => /\/(wt|\.claude\/worktrees)\/|\/home-(lander|watcher)(\/|$)/.test(cwd + "/") || /\/wt$/.test(cwd);
export type Stray = { pid: number; ageS: number; cwd: string; command: string };
/**
 * Unmanaged test runs: a `bun test` or `bun run test*` process older than limitS whose cwd is under a worktree or warm checkout, that is
 * not in a recorded job.sh process group, and has no lander.sh or watcher.sh ancestor (their own bounded runs are never strays).
 */
export function findStrays(rows: PsRow[], managedPgids: Set<number>, cwdOf: (pid: number) => string | undefined, limitS: number, selfPid = process.pid): Stray[] {
  const byPid = new Map(rows.map((r) => [r.pid, r]));
  const pipelineOwned = (r: PsRow): boolean => { for (let p: PsRow | undefined = r, n = 0; p && n < 40; p = byPid.get(p.ppid), n++) if (/(lander|watcher)\.sh/.test(p.command)) return true; return false; };
  // Never the scanner itself or anything that launched it (a `bun test` run that calls the scan must not stop itself).
  const lineage = new Set<number>(); for (let p = byPid.get(selfPid), n = 0; p && n < 40; p = byPid.get(p.ppid), n++) lineage.add(p.pid); lineage.add(selfPid);
  const out: Stray[] = [];
  for (const r of rows) {
    if (lineage.has(r.pid) || !isTestCommand(r.command) || r.ageS < limitS || managedPgids.has(r.pgid) || pipelineOwned(r)) continue;
    const cwd = cwdOf(r.pid);
    if (cwd && strayDir(cwd)) out.push({ pid: r.pid, ageS: r.ageS, cwd, command: r.command });
  }
  return out;
}
