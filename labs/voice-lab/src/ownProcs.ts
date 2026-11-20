// The only way rigs stop a process: a pid must belong to the lab (descendant of the calling process, or listening on 9921/9923/9931, or a descendant of those). Anything else is refused and reported, never killed.
import { ownPids, readProcs, type ProcRow } from "./gpuLoad";
export const LAB_PORTS = [9921, 9923, 9931];
export function labOwn(rows: ProcRow[], listeners: Map<number, number>, selfPid = process.pid): Set<number> {
  const roots = new Map(listeners); roots.set(selfPid, 0);
  const own = ownPids(roots, rows); own.delete(selfPid); return own;
}
/** Stops the given pids only if they are in `own`; returns what was stopped and what was refused (with the reason to log). */
export function stopOwn(pids: number[], own: Set<number>, kill: (pid: number) => void = (p) => process.kill(p, "SIGTERM")): { stopped: number[]; refused: number[] } {
  const stopped: number[] = [], refused: number[] = [];
  for (const p of pids) { if (!own.has(p)) { refused.push(p); continue; } try { kill(p); stopped.push(p); } catch {} }
  return { stopped, refused };
}
/** Own processes whose command matches the pattern (a pattern can never reach a process outside the lab). */
export async function stopOwnMatching(re: RegExp): Promise<{ stopped: number[]; refused: number[] }> {
  const { rows, listeners } = await readProcs(); const own = labOwn(rows, listeners);
  const hits = rows.filter((r) => re.test(r.cmd)).map((r) => r.pid);
  return stopOwn(hits, own);
}
