// What else is using the GPU right now: the system's device utilization and the heaviest background engines (a video job on the same GPU stretches
// every chat and voice step, because Metal has no queue priority). Sampled per live turn and recorded; never blocks anything.
/** A command line that looks like a GPU engine or job. Desktop apps are never one (their "Renderer" helper once counted as a render job and made every window look busy). */
export const isHotCommand = (cmd: string) => /(ltx|video-bench|comfy|diffus|mlx[_-]|llama-server|seedvr|liveportrait|ace-step|sam2|generate|upscale|render|train|bench|feature-ledger|embed)/i.test(cmd) && !/\.app\/Contents\//.test(cmd) && !/bun test|hygiene|voice_server|rig\/|labs\/voice-lab|--port 99/.test(cmd);
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
  const big = rows.filter((r) => !own.has(r.pid) && r.rss > 8 * 1024 * 1024 && !/labs\/voice-lab|voice_server|--port 99|Chrome|Safari|Claude|WindowServer|kernel/.test(r.cmd.slice(0, 140))).sort((a, b) => b.rss - a.rss).slice(0, 3).map((r) => tag(r, `${Math.round(r.rss / 1048576)} GB`));
  return [...hot, ...big].slice(0, 3);
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
    const a = Bun.spawn(["ioreg", "-r", "-c", "IOAccelerator", "-w0"], { stdout: "pipe", stderr: "ignore" });
    const [io, { rows, listeners }] = await Promise.all([new Response(a.stdout).text(), readProcs()]);
    const util = Number(io.match(/"Device Utilization %"=(\d+)/)?.[1] ?? -1);
    return { util, jobs: otherJobs(rows, ownPids(listeners, rows), listeners).join(" | ") };
  } catch { return { util: -1, jobs: "" }; }
}

/** "free" when no other GPU engine (hub video job, other MLX or llama process) is running; the utilization is recorded next to it but is not the class, because remote-desktop streaming alone keeps the GPU busy. */
export const gpuClass = (g: { util: number; jobs: string }) => (g.jobs === "" ? "free" : "shared");
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
