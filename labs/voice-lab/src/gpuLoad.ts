// What else is using the GPU right now: the system's device utilization and the heaviest background engines (a video job on the same GPU stretches
// every chat and voice step, because Metal has no queue priority). Sampled per live turn and recorded; never blocks anything.
export async function sampleGpu(): Promise<{ util: number; jobs: string }> {
  try {
    const a = Bun.spawn(["ioreg", "-r", "-c", "IOAccelerator", "-w0"], { stdout: "pipe", stderr: "ignore" }), b = Bun.spawn(["ps", "-Ao", "pcpu,command", "-r"], { stdout: "pipe", stderr: "ignore" });
    const [io, ps] = await Promise.all([new Response(a.stdout).text(), new Response(b.stdout).text()]);
    const util = Number(io.match(/"Device Utilization %"=(\d+)/)?.[1] ?? -1);
    const jobs = ps.split("\n").slice(1, 40).filter((l) => /(ltx|comfy|diffus|mlx|llama-server|whisper|sam2|seedvr|liveportrait|ace-step)/i.test(l) && !/lab|voice_server|9921/.test(l) && Number(l.trim().split(/\s+/)[0]) > 30).slice(0, 2).map((l) => l.trim().replace(/\s+/g, " ").slice(0, 70)).join(" | ");
    return { util, jobs };
  } catch { return { util: -1, jobs: "" }; }
}
