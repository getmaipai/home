// Runs `ready.ts` (default --quick) in the first window where no other GPU job has been running for 60 continuous seconds, and ABORTS it (kills it, does not count it) if another
// GPU job appears mid-run, then goes back to waiting. Logs every busy stretch and which jobs caused it to data-scratch/gpu-log.jsonl, so we can say how rare free windows are.
// Usage: bun rig/when-free.ts [--full] ; exits 0 when a clean run finished (its output is in data-scratch/ready-clean.txt), 1 if that run failed a check.
import { appendFileSync } from "node:fs";
import { BurstFilter } from "../src/burstFilter";
import { stopOwnMatching } from "../src/ownProcs";
import { ensureChat } from "../src/engineGuard";
import { sampleGpu, gpuClass, FreeWindow } from "../src/gpuLoad";
const W = "/Users/jessetorres/Developer/github.com/getmaipai/wt/home-brisk-panda-voice-lab/data-scratch"; const full = process.argv.includes("--full");
const log = (o: object) => appendFileSync(`${W}/gpu-log.jsonl`, JSON.stringify({ at: new Date().toISOString(), ...o }) + "\n");
const ownNice = async () => Number((await new Response(Bun.spawn(["ps", "-o", "nice=", "-p", String(process.pid)], { stdout: "pipe" }).stdout).text()).trim());
if (await ownNice() !== 0) { log({ event: "bad-priority", nice: await ownNice() }); console.error("REFUSING TO START: this process runs at nice " + await ownNice() + " (started as a zsh background job?). Start it with: bash -c 'nohup bun rig/when-free.ts &'"); process.exit(2); }
const utils: number[] = [];
const burst = new BurstFilter();
process.on("SIGTERM", () => { log({ event: "exit", why: "SIGTERM (stopped by another process)" }); console.log("when-free: stopped by SIGTERM"); process.exit(143); }); process.on("SIGINT", () => { log({ event: "exit", why: "SIGINT" }); process.exit(130); });
process.on("uncaughtException", (e) => { log({ event: "exit", why: "uncaught " + String(e).slice(0, 200) }); console.error(e); process.exit(1); });
const win = new FreeWindow(60_000); const t0 = Date.now(); let busySince: number | null = null, busyJobs = new Set<string>(); let child: ReturnType<typeof Bun.spawn> | null = null, aborted = false, attempts = 0;
const ROOT = W.replace(/\/data-scratch$/, "");
const chatDeps = { health: async () => { try { return (await fetch("http://127.0.0.1:9921/health", { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; } },
  start: async () => { Bun.spawn(["bash", "-c", `cd ${ROOT} && exec bash scripts/jobs/job.sh run --type server --lifetime 24h --session brisk-panda-voice-lab -- /usr/local/maipai-home/stack/data/engines/llama-server/b10797/llama-server -m /usr/local/maipai-home/stack/data/models/qwen3-8-27b-huihui-abliterated-iq4-xs/Huihui-Qwen3.8-27B-abliterated-UD-IQ4_XS.gguf --host 127.0.0.1 --port 9921 -c 16384 -fa on -ngl all --reasoning off -ub 1024 --jinja --no-webui --cache-reuse 256 --parallel 1 -ctk q8_0 -ctv q8_0 ${Bun.env.LAB_LLM_EXTRA ?? ""} >> ${W}/lab-logs/llm.log 2>&1`], { stdout: "ignore", stderr: "ignore" }).unref(); },
  warm: async () => { for (let i = 0; i < 2; i++) await fetch("http://127.0.0.1:9921/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: "Say hi." }], max_tokens: 8, stream: false }), signal: AbortSignal.timeout(120000) }); },
  sleep: (ms: number) => Bun.sleep(ms), nice: ownNice, log };
if (process.argv.includes("--engine-only")) { const r = await ensureChat(chatDeps); console.log("engine:", r); process.exit(r === "ready" ? 0 : 3); }
/** The "tests are stable" line must never fail a clean run for a stale stamp: when it is stale, run the flaky loop here first (CPU only, before the run starts). */
async function ensureFlaky() {
  const { flakyVerdict } = await import("../src/flakyStatus"); const { statSync, readdirSync, readFileSync } = await import("node:fs"); const T = import.meta.dir + "/../tests";
  const check = () => { const newest = Math.max(...readdirSync(T).filter((f) => f.endsWith(".ts")).map((f) => statSync(`${T}/${f}`).mtimeMs)); let st = null; try { st = JSON.parse(readFileSync(`${W}/flaky-last.json`, "utf8")); } catch {} return flakyVerdict(st, newest); };
  if (check().ok) return; log({ event: "flaky-stale", why: check().why }); const p = Bun.spawn(["bash", "rig/flaky.sh", "10"], { cwd: import.meta.dir + "/..", stdout: "ignore", stderr: "ignore" }); await p.exited; log({ event: "flaky-ran", verdict: check() });
}
async function startRun() {
  await ensureFlaky();
  attempts++; aborted = false; log({ event: "start", attempt: attempts });
  const spawnStep = (cmd: string[], file: string) => Bun.spawn(["bun", ...cmd], { cwd: import.meta.dir + "/..", stdout: Bun.file(`${W}/${file}`), stderr: "ignore" });
  const finish = (code: number, step: string) => { burst.finish(Date.now()); const bs = burst.summary(); log({ event: "finished", step, code, attempt: attempts, hubSpeechBursts: bs }); console.log(`hub speech bursts: ${bs.count}, total ${(bs.totalMs / 1000).toFixed(1)} s ${JSON.stringify(bs.intervals)}`); console.log(`CLEAN RUN FINISHED (${step}, attempt ${attempts}, exit ${code}); output ${W}/ready-clean.txt${step === "round1" ? " and round1-clean.txt" : ""}`); process.exit(code === 0 ? 0 : 1); };
  const engineDied = async (code: number) => { if (code !== 0 && !(await chatDeps.health())) { log({ event: "waiting: memory", why: "chat engine died mid-run", attempt: attempts }); console.log("chat engine died mid-run; waiting, not a failure"); child = null; win.finish(); return true; } return false; };
  try { (await import("node:fs")).rmSync(`${W}/ready-clean.txt`, { force: true }); (await import("node:fs")).rmSync(`${W}/round1-clean.txt`, { force: true }); } catch {} // Bun.file stdout does not truncate: old lines used to stay below the new ones
  child = spawnStep(["rig/ready.ts", ...(full ? [] : ["--quick"])], "ready-clean.txt");
  void child.exited.then(async (code) => {
    if (aborted) return; if (await engineDied(code)) return;
    if (code !== 0) return finish(code, "baseline"); // a baseline fail skips round 1
    log({ event: "baseline-passed", attempt: attempts }); if (aborted) return;
    child = spawnStep(["rig/round1.ts"], "round1-clean.txt");   // round 1 runs in the same free window
    void child.exited.then(async (c2) => { if (aborted) return; if (await engineDied(c2)) return; finish(c2, "round1"); });
  });
}
while (true) {
  const g = await sampleGpu(); const bf = burst.push(Date.now(), g.jobs.split(" | ").filter(Boolean)); const free = bf.free; const now = Date.now();
  if (!free) { if (busySince === null) busySince = now; for (const j of g.jobs.split(" | ").filter(Boolean)) busyJobs.add(j.slice(0, 90)); } else if (busySince !== null) { log({ event: "busy-ended", busyMinutes: +((now - busySince) / 60000).toFixed(1), jobs: [...busyJobs] }); busySince = null; busyJobs = new Set(); }
  const s = win.push(now, free);
  if (s.abort && child) { aborted = true; child.kill(); void stopOwnMatching(/rig\/(measure|echotest|listen|round1)\.ts/).then((r) => log({ event: "stopped-own", ...r })); log({ event: "aborted", why: g.jobs, attempt: attempts }); console.log(`ABORTED run ${attempts}: ${g.jobs}`); child = null; win.finish(); }
  if (s.start) { { const r = await ensureChat(chatDeps); if (r === "ready") await startRun(); else { win.finish(); if (r === "bad-priority") { console.error("bad priority: exiting"); process.exit(2); } } } }
  await Bun.sleep(5000);
  if (Math.floor((now - t0) / 60000) !== Math.floor((Date.now() - t0) / 60000)) log({ event: "tick", util: g.util, free, freeMs: s.freeMs, jobs: g.jobs });
}
