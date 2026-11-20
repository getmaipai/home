// The run lock: while a clean run (when-free / ready) is going, nothing else may start a rig, restart the page or the voice server, or the run is invalid (it happened: a page restart and echo tests during a run).
// data-scratch/run.lock holds {pid, startedAt, step}. A lock whose pid is dead is stale and ignored. The holder itself and its descendants (the rigs it starts) are allowed.
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
export type RunLock = { pid: number; startedAt: string; step: string };
export const LOCK_FILE = new URL("../../../data-scratch/run.lock", import.meta.url).pathname;
export const pidAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e: any) { return e?.code === "EPERM"; } };
export function readLock(file = LOCK_FILE): RunLock | null { try { return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as RunLock) : null; } catch { return null; } }
/** null = allowed; otherwise a plain message saying who holds the lock and what to do. `ancestors` are the pids above the caller (nearest first). */
export function lockVerdict(lock: RunLock | null, myPid: number, ancestors: number[], alive: (p: number) => boolean = pidAlive): string | null {
  if (!lock || !alive(lock.pid)) return null;                          // no lock, or a stale one (dead pid)
  if (lock.pid === myPid || ancestors.includes(lock.pid)) return null; // the holder or something it started
  return `A clean run holds the lab (pid ${lock.pid}, step "${lock.step}", started ${lock.startedAt}). Starting this now would invalidate it. Wait for it to end (data-scratch/when-free.out), or stop that pid if you own it, then run this again.`;
}
export function ancestorsOf(pid = process.pid): number[] {
  const out: number[] = []; let p = pid;
  for (let i = 0; i < 12; i++) { const r = Bun.spawnSync(["ps", "-o", "ppid=", "-p", String(p)]); const pp = Number(new TextDecoder().decode(r.stdout).trim()); if (!pp || pp === 1 || out.includes(pp)) break; out.push(pp); p = pp; }
  return out;
}
export function acquireLock(step: string, file = LOCK_FILE): { ok: boolean; message?: string } {
  const lock = readLock(file); const msg = lockVerdict(lock, process.pid, ancestorsOf());
  if (msg) return { ok: false, message: msg };
  if (lock && lock.pid !== process.pid && !pidAlive(lock.pid)) rmSync(file, { force: true });
  writeFileSync(file, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), step } satisfies RunLock)); return { ok: true };
}
export function setStep(step: string, file = LOCK_FILE) { const l = readLock(file); if (l && l.pid === process.pid) writeFileSync(file, JSON.stringify({ ...l, step })); }
export function releaseLock(file = LOCK_FILE) { const l = readLock(file); if (l && l.pid === process.pid) rmSync(file, { force: true }); }
/** For rigs and scripts: exit with a plain message when a live run holds the lab. */
export function guardOrExit(name: string) { const msg = lockVerdict(readLock(), process.pid, ancestorsOf()); if (msg) { console.error(`${name}: refusing to start. ${msg}`); process.exit(3); } }
