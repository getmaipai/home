// Runs `ready.ts` (default --quick) in the first window where no other GPU job has been running for 60 continuous seconds, and ABORTS it (kills it, does not count it) if another
// GPU job appears mid-run, then goes back to waiting. Logs every busy stretch and which jobs caused it to data-scratch/gpu-log.jsonl, so we can say how rare free windows are.
// Usage: bun rig/when-free.ts [--full] ; exits 0 when a clean run finished (its output is in data-scratch/ready-clean.txt), 1 if that run failed a check.
import { appendFileSync } from "node:fs";
import { sampleGpu, gpuClass, FreeWindow } from "../src/gpuLoad";
const W = "/Users/jessetorres/Developer/github.com/getmaipai/wt/home-brisk-panda-voice-lab/data-scratch"; const full = process.argv.includes("--full");
const log = (o: object) => appendFileSync(`${W}/gpu-log.jsonl`, JSON.stringify({ at: new Date().toISOString(), ...o }) + "\n");
const win = new FreeWindow(60_000); const t0 = Date.now(); let busySince: number | null = null, busyJobs = new Set<string>(); let child: ReturnType<typeof Bun.spawn> | null = null, aborted = false, attempts = 0;
async function startRun() { attempts++; aborted = false; log({ event: "start", attempt: attempts }); child = Bun.spawn(["bun", "rig/ready.ts", ...(full ? [] : ["--quick"])], { cwd: import.meta.dir + "/..", stdout: Bun.file(`${W}/ready-clean.txt`), stderr: "ignore" }); void child.exited.then((code) => { if (!aborted) { log({ event: "finished", code, attempt: attempts }); console.log(`CLEAN RUN FINISHED (attempt ${attempts}, exit ${code}); output ${W}/ready-clean.txt`); process.exit(code === 0 ? 0 : 1); } }); }
while (true) {
  const g = await sampleGpu(); const free = gpuClass(g) === "free"; const now = Date.now();
  if (!free) { if (busySince === null) busySince = now; for (const j of g.jobs.split(" | ").filter(Boolean)) busyJobs.add(j.slice(0, 90)); } else if (busySince !== null) { log({ event: "busy-ended", busyMinutes: +((now - busySince) / 60000).toFixed(1), jobs: [...busyJobs] }); busySince = null; busyJobs = new Set(); }
  const s = win.push(now, free);
  if (s.abort && child) { aborted = true; child.kill(); try { Bun.spawnSync(["pkill", "-f", "rig/(measure|echotest|listen)\\.ts"]); } catch {} log({ event: "aborted", why: g.jobs, attempt: attempts }); console.log(`ABORTED run ${attempts}: ${g.jobs}`); child = null; win.finish(); }
  if (s.start) await startRun();
  await Bun.sleep(5000);
  if (Math.floor((now - t0) / 60000) !== Math.floor((Date.now() - t0) / 60000)) log({ event: "tick", util: g.util, free, freeMs: s.freeMs, jobs: g.jobs });
}
