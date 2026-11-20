// Round 2 trial: does the conversation hold up while a heavy GPU job (a stand-in for a video render) runs, and what does yielding cost that job?
// Three conversations of ~15 turns (rig/listen.ts, simulated room), each beside the SAME stand-in load of our own (rig/gpuload.py: an MLX loop of big matrix products in steps):
//   1. no load (the reference), 2. load that never yields, 3. load that calls rig/yield/wait_if_talking.py between steps (turn-in-flight lease).
// Reports per conversation: first-sound median / p90 / worst, gaps and problems; and for the loads, steps per second and how long they paused (the slowdown yielding costs the job).
// RUN ONLY IN A FREE-GPU WINDOW (it is its own GPU load): `bun rig/when-free.ts`-style waiting is not built in here; call after the GPU is free, never with another job running. THE ROOM IS SIMULATED.
// Usage: bun rig/round2.ts [--secs 200] ; exits 0 when all three conversations pass the listener, 1 otherwise.
import { readFileSync, mkdirSync } from "node:fs";
import { sampleGpu, gpuClass } from "../src/gpuLoad";
const SECRET_FILE = Bun.env.LAB_SECRET_FILE ?? "/Users/jessetorres/Developer/github.com/getmaipai/home/data-scratch/voice-lab-secret.txt";
const VOICE_PY = Bun.env.LAB_VOICE_PY ?? `${import.meta.dir}/../../../data-scratch/voices/venv/bin/python`;
const si = process.argv.indexOf("--secs"), SECS = si >= 0 ? Number(process.argv[si + 1]) : 200;
const ROOT = `${import.meta.dir}/..`, OUT = `${import.meta.dir}/../../../data-scratch/round2`; mkdirSync(OUT, { recursive: true });
const g0 = await sampleGpu(); if (gpuClass(g0) !== "free") { console.log(`NOT RUN: another GPU job is running (${g0.jobs.slice(0, 120)}); round 2 is its own GPU load and needs a free chip`); process.exit(3); }
async function listen(tag: string) {
  const p = Bun.spawn(["bun", "rig/listen.ts", SECRET_FILE, "--runs", "1", "--out", `${OUT}/${tag}`], { cwd: ROOT, stdout: "pipe", stderr: "ignore" }); const text = await new Response(p.stdout).text(); const code = await p.exited;
  let summary: any = null; try { summary = JSON.parse(readFileSync(`${OUT}/${tag}/run1.json`, "utf8")).summary; } catch {}
  return { code, summary, tail: text.split("\n").filter(Boolean).slice(-3).join(" | ").slice(0, 240) };
}
async function withLoad(yld: 0 | 1) {
  const load = Bun.spawn([VOICE_PY, "rig/gpuload.py", String(SECS), String(yld)], { cwd: ROOT, stdout: "pipe", stderr: "ignore" }); await Bun.sleep(4000); // let the load reach full speed before the conversation starts
  const conv = await listen(yld ? "yield" : "noyield"); const out = (await new Response(load.stdout).text()).trim().split("\n").pop() ?? ""; await load.exited; let stats: any = null; try { stats = JSON.parse(out); } catch {}
  return { conv, stats };
}
console.log("ROUND 2 (conversation while a heavy job runs). THE ROOM IS SIMULATED; the heavy job is our own stand-in (MLX matrix loop), not a real video render.");
const alone = await (async () => { const l = await Bun.spawn([VOICE_PY, "rig/gpuload.py", "30", "0"], { cwd: ROOT, stdout: "pipe", stderr: "ignore" }); return JSON.parse(((await new Response(l.stdout).text()).trim().split("\n").pop()) ?? "{}"); })(); // the load's speed with nobody talking
const ref = await listen("reference"), loaded = await withLoad(0), yielded = await withLoad(1);
const row = (name: string, r: { conv: any; stats?: any }) => { const s = r.conv.summary; return s ? `${name}: first sound median ${s.timingMs.median} ms, p90 ${s.timingMs.p90}, worst ${s.timingMs.worst}; problems ${s.problems.length} (${s.problems.filter((p: string) => /gap|hole/i.test(p)).length} gaps); self-stops ${s.selfStops}; ${s.failed ? "FAIL" : "PASS"}${r.stats ? `; heavy job ${r.stats.steps_per_s} steps/s (alone ${alone.steps_per_s}), paused ${r.stats.paused_s} s, longest pause ${r.stats.longest_pause_s} s` : ""}` : `${name}: NO RESULT (${r.conv.tail})`; };
console.log(row("no load        ", { conv: ref })); console.log(row("load, no yield ", loaded)); console.log(row("load, yielding ", yielded));
if (alone.steps_per_s && yielded.stats && loaded.stats) console.log(`COST OF YIELDING to the heavy job: ${Math.round((1 - yielded.stats.steps_per_s / loaded.stats.steps_per_s) * 100)}% fewer steps than the load that never yields (it was paused ${yielded.stats.paused_s} s of ${SECS} s while people talked).`);
const ok = [ref, loaded, yielded].every((x: any) => x.summary ? x.summary.failed === 0 : x.conv?.summary?.failed === 0);
console.log(ok ? "ROUND 2: all three conversations passed the listener (simulated room)" : "ROUND 2: at least one conversation failed or had no result; read the rows above");
process.exit(ok ? 0 : 1);
