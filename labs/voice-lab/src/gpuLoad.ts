// What else is using the GPU right now: the system's device utilization and the heaviest background engines (a video job on the same GPU stretches
// every chat and voice step, because Metal has no queue priority). Sampled per live turn and recorded; never blocks anything.
export async function sampleGpu(): Promise<{ util: number; jobs: string }> {
  try {
    const a = Bun.spawn(["ioreg", "-r", "-c", "IOAccelerator", "-w0"], { stdout: "pipe", stderr: "ignore" }), b = Bun.spawn(["ps", "-Ao", "pcpu,command", "-r"], { stdout: "pipe", stderr: "ignore" });
    const [io, ps] = await Promise.all([new Response(a.stdout).text(), new Response(b.stdout).text()]);
    const util = Number(io.match(/"Device Utilization %"=(\d+)/)?.[1] ?? -1);
    const jobs = ps.split("\n").slice(1, 60).filter((l) => { const cmd = l.trim().replace(/^\S+\s+/, "").slice(0, 140); return /(ltx|video-bench|comfy|diffus|mlx[_-]|llama-server|seedvr|liveportrait|ace-step|sam2)/i.test(cmd) && !/bun test|hygiene|feature-ledger|voice_server|rig\/|labs\/voice-lab|--port 99/.test(cmd) && Number(l.trim().split(/\s+/)[0]) > 30; }).slice(0, 2).map((l) => l.trim().replace(/\s+/g, " ").slice(0, 80)).join(" | ");
    return { util, jobs };
  } catch { return { util: -1, jobs: "" }; }
}

/** "free" when no other GPU job is running and the GPU is quiet; "shared" otherwise. */
export const gpuClass = (g: { util: number; jobs: string }) => (g.jobs === "" && g.util < 30 ? "free" : "shared");
export async function waitForGpuFree(maxMs = 20 * 60_000, quietSamples = 3): Promise<boolean> { const t0 = performance.now(); let ok = 0; while (performance.now() - t0 < maxMs) { ok = gpuClass(await sampleGpu()) === "free" ? ok + 1 : 0; if (ok >= quietSamples) return true; await Bun.sleep(5000); } return false; }
