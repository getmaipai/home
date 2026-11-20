// What else is using the GPU right now: the system's device utilization and the heaviest background engines (a video job on the same GPU stretches
// every chat and voice step, because Metal has no queue priority). Sampled per live turn and recorded; never blocks anything.
export async function sampleGpu(): Promise<{ util: number; jobs: string }> {
  try {
    const a = Bun.spawn(["ioreg", "-r", "-c", "IOAccelerator", "-w0"], { stdout: "pipe", stderr: "ignore" }), b = Bun.spawn(["ps", "-Ao", "pcpu,command", "-r"], { stdout: "pipe", stderr: "ignore" }), c = Bun.spawn(["ps", "-Ao", "rss,pcpu,command", "-m"], { stdout: "pipe", stderr: "ignore" });
    const [io, ps, mem] = await Promise.all([new Response(a.stdout).text(), new Response(b.stdout).text(), new Response(c.stdout).text()]);
    const util = Number(io.match(/"Device Utilization %"=(\d+)/)?.[1] ?? -1);
    const big = mem.split("\n").slice(1, 8).filter((l) => { const [rss] = l.trim().split(/\s+/); const cmd = l.trim().replace(/^\S+\s+\S+\s+/, "").slice(0, 140); return Number(rss) > 8 * 1024 * 1024 && !/labs\/voice-lab|voice_server|--port 99|Chrome|Safari|Claude|WindowServer|kernel/.test(cmd) && !/llama-server.*(9921|qwen3-8-27b-huihui)/.test(cmd); }).map((l) => `${Math.round(Number(l.trim().split(/\s+/)[0]) / 1048576)} GB ` + l.trim().replace(/^\S+\s+\S+\s+/, "").slice(0, 70));
    const hot = ps.split("\n").slice(1, 60).filter((l) => { const cmd = l.trim().replace(/^\S+\s+/, "").slice(0, 140); return /(ltx|video-bench|comfy|diffus|mlx[_-]|llama-server|seedvr|liveportrait|ace-step|sam2|generate|upscale|render|train|bench|feature-ledger|embed)/i.test(cmd) && !/bun test|hygiene|voice_server|rig\/|labs\/voice-lab|--port 99/.test(cmd) && Number(l.trim().split(/\s+/)[0]) > (/llama-server/.test(cmd) ? 40 : 10); }).slice(0, 2).map((l) => l.trim().replace(/\s+/g, " ").slice(0, 80)).join(" | ");
    const jobs = [...hot.split(" | ").filter(Boolean), ...big].slice(0, 3).join(" | ");
    return { util, jobs };
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
