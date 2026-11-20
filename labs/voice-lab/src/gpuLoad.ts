// What else is using the GPU right now: the system's device utilization and the heaviest background engines (a video job on the same GPU stretches
// every chat and voice step, because Metal has no queue priority). Sampled per live turn and recorded; never blocks anything.
/** A command line that looks like a GPU engine or job. Desktop apps are never one (their "Renderer" helper once counted as a render job and made every window look busy). */
export const isHotCommand = (cmd: string) => /(ltx|video-bench|comfy|diffus|mlx[_-]|llama-server|seedvr|liveportrait|ace-step|sam2)/i.test(cmd) && !/\.app\/Contents\//.test(cmd) && !/bun test|hygiene|voice_server|rig\/|labs\/voice-lab|--port 99/.test(cmd);
export type ProcRow = { pid: number; ppid: number; rss: number; pcpu: number; cmd: string };
export const OWN_PORTS = [9921, 9923];
/** Own engines: the pids listening on our ports plus every descendant. Jobs are told apart by PID, never by command text (the lab's own llama-server once aborted the baseline run). */
export function ownPids(listeners: Map<number, number>, rows: ProcRow[]): Set<number> {
  const own = new Set<number>(listeners.keys()); let grew = true;
  while (grew) { grew = false; for (const r of rows) if (!own.has(r.pid) && own.has(r.ppid)) { own.add(r.pid); grew = true; } }
  return own;
}
/** Other GPU jobs: hot or very large processes that are not ours. Each line carries pid, and port when it listens on one, so every abort can be traced. */
export function otherJobs(rows: ProcRow[], own: Set<number>, ports: Map<number, number> = new Map()): string[] {
  const tag = (r: ProcRow, head: string) => `pid=${r.pid}${ports.has(r.pid) ? ` port=${ports.get(r.pid)}` : ""} ${head} ` + r.cmd.slice(0, 70);
  const hot = rows.filter((r) => !own.has(r.pid) && isHotCommand(r.cmd.slice(0, 140)) && r.pcpu > (/llama-server/.test(r.cmd) ? 40 : 10)).sort((a, b) => b.pcpu - a.pcpu).slice(0, 2).map((r) => tag(r, `${Math.round(r.pcpu)}%`));
  return hot; // a big resident engine or a CPU-only script is never a GPU job; the chip's own utilization decides "free" at rest (gpuClass)
}
export async function readProcs(): Promise<{ rows: ProcRow[]; listeners: Map<number, number> }> {
  const ps = Bun.spawn(["ps", "-Ao", "pid=,ppid=,rss=,pcpu=,command="], { stdout: "pipe", stderr: "ignore" });
  const rows = (await new Response(ps.stdout).text()).split("\n").map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(.*)$/)).filter(Boolean).map((m) => ({ pid: +m![1], ppid: +m![2], rss: +m![3], pcpu: +m![4], cmd: m![5] }));
  const listeners = new Map<number, number>();
  for (const port of OWN_PORTS) { try { const o = Bun.spawn(["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { stdout: "pipe", stderr: "ignore" }); for (const x of (await new Response(o.stdout).text()).split("\n").filter(Boolean)) listeners.set(+x, port); } catch {} }
  return { rows, listeners };
}
export async function sampleGpu(): Promise<{ util: number; jobs: string }> {
  try {
    const read = async () => { const a = Bun.spawn(["ioreg", "-r", "-c", "IOAccelerator", "-w0"], { stdout: "pipe", stderr: "ignore" }); return Number((await new Response(a.stdout).text()).match(/"Device Utilization %"=(\d+)/)?.[1] ?? -1); };
    const procs = readProcs(); const us = [await read()]; for (let i = 0; i < 2; i++) { await Bun.sleep(400); us.push(await read()); }
    const util = us.sort((x, y) => x - y)[1]; const { rows, listeners } = await procs;
    return { util, jobs: otherJobs(rows, ownPids(listeners, rows), listeners).join(" | ") };
  } catch { return { util: -1, jobs: "" }; }
}

/** "free" when no other GPU engine (hub video job, other MLX or llama process) is running; the utilization is recorded next to it but is not the class, because remote-desktop streaming alone keeps the GPU busy. */
/** Resting level of the machine (remote-desktop streaming alone holds about 30%, and it is not ours to stop): the low quartile of the last minute of samples, never above 40. Busy means clearly above that level. */
export const BUSY_MARGIN = 40;
export function restingBaseline(samples: number[]): number { const v = samples.filter((x) => x >= 0).sort((a, b) => a - b); return v.length === 0 ? 0 : Math.min(40, v[Math.floor((v.length - 1) / 4)]); }
/** A run is valid when no other NAMED GPU engine (video, image, hub speech or chat; found by pid, ours excluded) is active. The owner's remote screen (screensharingd, Sunshine) is part of the machine, never a reason to wait: its use is recorded as a label by remoteScreenLabel. */
export const gpuClass = (g: { util: number; jobs: string }, _running = false, _baseline = 30) => (g.jobs === "" ? "free" : "shared");
export function remoteScreenLabel(rows: ProcRow[]): "remote screen active" | "quiet" { return rows.some((r) => /screensharingd|Sunshine|ScreenSharing/i.test(r.cmd) && r.pcpu > 15) ? "remote screen active" : "quiet"; }
export async function waitForGpuFree(maxMs = 20 * 60_000, quietSamples = 3): Promise<boolean> { const t0 = performance.now(); let ok = 0; while (performance.now() - t0 < maxMs) { ok = gpuClass(await sampleGpu()) === "free" ? ok + 1 : 0; if (ok >= quietSamples) return true; await Bun.sleep(5000); } return false; }

/** Tracks how long the GPU has been continuously free. A run may START only after `needMs` of continuous freedom, and is ABORTED (not failed) the moment another GPU job shows up. */
export class FreeWindow {
  private freeSince: number | null = null; running = false;
  constructor(private needMs = 60_000) {}
  push(nowMs: number, free: boolean): { freeMs: number; start: boolean; abort: boolean } {
    if (free) this.freeSince ??= nowMs; else this.freeSince = null;
    const freeMs = this.freeSince === null ? 0 : nowMs - this.freeSince;
    if (this.running) { if (!free) { this.running = false; return { freeMs, start: false, abort: true }; } return { freeMs, start: false, abort: false }; }
    if (freeMs >= this.needMs) { this.running = true; return { freeMs, start: true, abort: false }; }
    return { freeMs, start: false, abort: false };
  }
  finish() { this.running = false; }
}

/** A heavy GPU load that no named engine explains while the owner's remote screen is quiet (a foreign python job, a build): the run is not valid. At rest only (our own engines raise utilization during a run). */
export const UNNAMED_UTIL = 70;
export const unnamedGpuLoad = (g: { util: number; jobs: string }, rows: ProcRow[]) => g.util > UNNAMED_UTIL && g.jobs === "" && remoteScreenLabel(rows) === "quiet";
