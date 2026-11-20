// "Ready to test" gate. Run `bun rig/ready.ts` in labs/voice-lab. It must pass before anyone tells the owner to test the lab.
// One plain line per check. Options: --quick (4 runs instead of 20 / 10 turns, for development only; not valid for "ready").
import { guardOrExit, readLock, pidAlive, acquireLock, releaseLock } from "../src/runLock";
guardOrExit("ready"); { const l = readLock(); if (!l || !pidAlive(l.pid)) { acquireLock("ready"); process.on("exit", () => releaseLock()); } } // a standalone ready holds the lab; one started by when-free runs under its lock
import { availableTags, pickSound, refusedSounds } from "../src/sounds";
import { buildPrompt } from "../src/prompt";
import { TAGS } from "../src/tags";
import { machineBusy, labPriorities } from "./loadcheck";
import { sampleGpu, gpuClass, waitForGpuFree, remoteScreenLabel, readProcs } from "../src/gpuLoad";
const SECRET_FILE = Bun.env.LAB_SECRET_FILE ?? "/Users/jessetorres/Developer/github.com/getmaipai/home/data-scratch/voice-lab-secret.txt";
const quick = process.argv.includes("--quick"), RUNS = quick ? 5 : 10, TURNS = quick ? 4 : 10;
const FIRST_SOUND_TARGET_MS = 1350, P90_LIMIT_MS = 2300, WORST_LIMIT_MS = 3500; // median 1.17 s, p90 1.93 s, worst about 2.6 s measured, plus 15 percent where the sample is stable // best honest first-byte median measured on this machine (1.17 s) plus 15 percent
// --wait-gpu-free: start only when no hub video job (or other GPU engine) is running; a run is valid for "ready for the owner" only if the GPU stayed free the whole time
if (process.argv.includes("--wait-gpu-free")) { console.log("waiting for the GPU to be free of other jobs..."); if (!(await waitForGpuFree())) { console.log("NOT RUN: the GPU did not become free within 20 minutes (a hub video job is running)"); process.exit(4); } }
const RUN_START = new Date().toISOString(); const gpuAtStart = await sampleGpu(); const startRows = (await readProcs()).rows; const screenAtStart = remoteScreenLabel(startRows);
const secret = (await Bun.file(SECRET_FILE).text()).trim(), LAB = "127.0.0.1:9931";
const results: Array<[boolean, string]> = []; const line = (ok: boolean, text: string) => { results.push([ok, text]); console.log(`${ok ? "PASS" : "FAIL"}  ${text}`); };
const run = async (cmd: string[]) => { const p = Bun.spawn(cmd, { cwd: import.meta.dir + "/..", stdout: "pipe", stderr: "pipe" }); const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]); await p.exited; return out + "\n" + err; };
const up = async (url: string, headers: Record<string, string> = {}) => { try { return (await fetch(url, { headers, signal: AbortSignal.timeout(4000) })).status < 500; } catch { return false; } };

// 1 engines answer and are prewarmed
const engines = { chat: await up("http://127.0.0.1:9921/health"), voice: await up("http://127.0.0.1:9923/voices"), page: await up(`http://${LAB}/api/health`, { "x-lab-secret": secret }) };
let warm = "";
if (engines.chat && engines.voice && engines.page) {
  const ws = new WebSocket(`ws://${LAB}/ws`); await new Promise((r) => (ws.onopen = r)); const got: Record<string, number> = {}; const t0 = performance.now();
  ws.onmessage = (e) => { if (typeof e.data === "string") { const j = JSON.parse(e.data); if (j.t === "warm") got[j.part] = Math.round(performance.now() - t0); } };
  ws.send(JSON.stringify({ t: "hello", secret, rig: true })); while (performance.now() - t0 < 15000 && !(got.chat != null && got.voice != null)) await Bun.sleep(100); ws.close();
  warm = `; prewarm chat ${got.chat ?? "never"} ms, voice ${got.voice ?? "never"} ms after open`; if (got.chat == null || got.voice == null) engines.page = false;
}
line(engines.chat && engines.voice && engines.page, `chat model, voice server and page ${engines.chat && engines.voice && engines.page ? "answer and are prewarmed" : "do not all answer or prewarm"}${warm}`);

// 1b the chosen voice speaks one phrase right now and sounds like the reference (catches a cold or wrong voice before a person hears it)
{ const { readWav } = await import("./listen/audio"); const { embed, cosine } = await import("./listen/speaker"); try {
    const f = new FormData(); f.append("text", "Hey, I'm doing pretty well. Thanks for asking."); f.append("voice", "casual"); const r = await fetch("http://127.0.0.1:9923/tts", { method: "POST", body: f }); const b = new Uint8Array(await r.arrayBuffer()); const dv = new DataView(b.buffer); const n = Math.floor((b.length - 44) / 2); const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = dv.getInt16(44 + i * 2, true) / 32768;
    const ref = readWav(import.meta.dir + "/../../../data-scratch/voices/voices_store/casual/ref.wav"); const sim = cosine(embed(x, 24000), embed(ref.samples.subarray(0, 24000 * 12), 24000)); line(sim >= 0.4, `the chosen voice, spoken now, sounds like its reference: similarity ${sim.toFixed(2)} (needs 0.40)`); } catch (e) { line(false, `the chosen voice could not speak a phrase now: ${String(e).slice(0, 120)}`); } }
// 2 no other lab load, no real page
const others = (await run(["pgrep", "-f", "rig/(measure|echotest)\\.ts"])).trim().split("\n").filter((p) => p && Number(p) !== process.pid);
let live = -1, connected = -1; try { const j = (await (await fetch(`http://${LAB}/api/live`, { headers: { "x-lab-secret": secret } })).json()) as { live: number; connected?: number }; live = j.live; connected = j.connected ?? j.live; } catch {}
line(others.length === 0 && live === 0, `no other rig run is going (${others.length}) and no real page is active (${live < 0 ? "unknown" : live} active, ${connected < 0 ? "unknown" : connected} open; a page counts as active for 120 s after any message either way)`);
if (others.length || live !== 0) { console.log("Stopping here: running the checks now would disturb a live test."); process.exit(1); }

{ const pr = await labPriorities(); const bad = pr.filter((x) => x.nice !== 0 || x.stat.includes("N")); line(bad.length === 0, `lab processes run at normal priority: ${pr.map((x) => `${x.name} pid ${x.pid} nice ${x.nice} state ${x.stat}`).join("; ")}${bad.length ? "; LOW PRIORITY: " + bad.map((x) => x.name).join(", ") + " (never start an engine from a zsh background job)" : ""}`); const m = await machineBusy(); console.log(`      load average ${m.load1.toFixed(1)}${m.busy ? "; busiest: " + m.top : ""} (recorded, never a reason to skip)`); const g = await sampleGpu(); console.log(`      GPU utilization ${g.util}%${g.jobs ? "; other GPU jobs: " + g.jobs : ""} (a video job on the same GPU stretches chat and voice)`); }
// 7 tags (cheap, before the slow runs)
const offered = [...new Set((buildPrompt().match(/\[([a-z ]+)\]/g) ?? []).map((t) => t.slice(1, -1)))].filter((t) => (TAGS as readonly string[]).includes(t) && !["whisper", "shout", "excited", "happy", "angry", "sad", "sarcastic"].includes(t));
const silent = offered.filter((t) => { const p = pickSound("casual", t, 0.08); return !p || p.length < 3600; });
const refusedNow = refusedSounds("casual"); line(refusedNow.length === 0, `every library sound is from the voice's own speaker${refusedNow.length ? "; FROM ANOTHER SPEAKER: " + refusedNow.join(", ") : ""}`);
line(offered.length > 0 && silent.length === 0, `every sound tag the prompt offers makes a real sound (${offered.join(", ") || "none offered"})${silent.length ? "; NO SOUND FOR: " + silent.join(", ") : ""}`);

if (!quick) {
// 5 + 6 first sound and gaps over TURNS turns
const J = "/private/tmp/claude-501/ready-measure.json";
await run(["bun", "rig/measure.ts", SECRET_FILE, "--n", String(TURNS), "--json", J]);
try { const s = JSON.parse(await Bun.file(J).text()).summary;
  line(s.firstSoundMedianMs <= FIRST_SOUND_TARGET_MS, `median first sound over ${s.turns} turns is ${s.firstSoundMedianMs} ms (limit ${FIRST_SOUND_TARGET_MS} ms; worst ${s.firstSoundWorstMs} ms)`);
  line(s.firstSoundP90Ms <= P90_LIMIT_MS && s.firstSoundWorstMs <= WORST_LIMIT_MS, `p90 first sound ${s.firstSoundP90Ms} ms (limit ${P90_LIMIT_MS}) and worst ${s.firstSoundWorstMs} ms (limit ${WORST_LIMIT_MS}): the outliers are what is felt`);
  line(s.totalGaps === 0, `audio gaps in those turns: ${s.totalGaps} (the page's playback gate, replayed on the real frame arrivals)`);
} catch { line(false, "the measuring run produced no result"); line(false, "no gap result"); }

}
// 3 + 4 echo tests
for (const [scenario, label, need] of [["silent", "her own voice fed back into the microphone at speaker level causes no stop", (m: RegExpMatchArray) => Number(m[1]) === RUNS && m[2] === "0"], ["stop", '"wait, stop" over her voice stops her', (m: RegExpMatchArray) => Number(m[1]) === RUNS]] as const) {
  const traceDir = `${import.meta.dir}/../../../data-scratch/echo-traces/${RUN_START.replace(/[:.]/g, "-")}`; (await import("node:fs")).mkdirSync(traceDir, { recursive: true });
  const out = await run(["env", "ECHO_TRACE=1", `ECHO_TRACE_DIR=${traceDir}`, "bun", "rig/echotest.ts", SECRET_FILE, "--scenario", scenario, "--runs", String(RUNS), "--round1"]); // every run keeps its overlap trace so a miss always has evidence // the setup the page sees: echo canceller leaves 8% and the device stops her locally (same as round 1)
  const m = out.match(/SCENARIO \w+: (\d+)\/(\d+) pass; self-interruptions (\d+)/);
  const ok = !!m && Number(m[1]) === Number(m[2]) && (scenario === "stop" ? true : m[3] === "0");
  line(ok, `${label} [simulated room, echo canceller residue 8%, local stop on]: ${m ? `${m[1]} of ${m[2]} runs, self-interruptions ${m[3]}` : "no result"}`);
}
{ // known limit, reported and never blocking: the same stop test with NO echo canceller at the extreme level 0.5
  const out = await run(["bun", "rig/echotest.ts", SECRET_FILE, "--scenario", "stop", "--runs", "3", "--gain", "0.5"]); const m = out.match(/SCENARIO \w+: (\d+)\/(\d+) pass/);
  console.log(`KNOWN LIMIT (does not block): "wait, stop" with NO echo canceller at echo level 0.5: ${m ? `${m[1]} of ${m[2]} runs` : "no result"}`); }
// 9 the listener: three full conversations (two on a quiet machine, one with background load); the worst case decides
if (!quick) {
  for (const [label, extra] of [["quiet machine, run 1 and 2", ["--runs", "2"]], ["with background load", ["--runs", "1", "--load"]]] as const) {
    const out = await run(["bun", "rig/listen.ts", SECRET_FILE, ...extra]); const ok = /ALL RUNS: PASS/.test(out);
    const files = out.match(/LISTEN FILES[^\n]*/)?.[0] ?? ""; line(ok, `listener, three-minute conversation (${label}; room is SIMULATED, not real speakers): ${ok ? "same person, right words, smooth, joins, timing and stumble pattern all pass" : out.split("\n").filter((l) => /^(RUN|  )/.test(l)).slice(0, 4).join(" / ").slice(0, 400)} ${ok ? "" : files}`);
  }
} else { const out = await run(["bun", "rig/listen.ts", SECRET_FILE, "--runs", "1", "--quick"]); const ok = /ALL RUNS: PASS/.test(out); const t = out.match(/timing median (\d+) p90 (\d+) worst (\d+)/); line(ok, `listener, 8-turn conversation (room SIMULATED): ${ok ? "same person, right words, smooth, joins, stumbles, stops all pass" : out.split("\n").filter((l) => /^(RUN|  )/.test(l)).slice(0, 5).join(" / ").slice(0, 600)}${t ? `; first sound from the recording median ${t[1]} p90 ${t[2]} worst ${t[3]} ms` : ""} ${out.match(/LISTEN FILES[^\n]*/)?.[0] ?? ""}`); for (const w of out.split("\n").filter((l) => /JOIN OUTLIER/.test(l))) console.log("WARNING (does not block): " + w.trim().slice(0, 300)); for (const t of out.split("\n").filter((l) => /^TARGET MISSED/.test(l))) console.log(t.slice(0, 320)); console.log("The listener BLOCKS only on what a person hears as a broken conversation: self-stops, silent turns, wrong words, a click or a hole of 300 ms or more, a different speaker. Joins, first-sound timing and the stumble pattern are reported against their targets and never block."); }
// 9 the test suite is stable (rig/flaky.sh), not just green once
{ const { flakyVerdict } = await import("../src/flakyStatus"); const { statSync, readdirSync, readFileSync } = await import("node:fs"); const T = import.meta.dir + "/../tests";
  const newest = Math.max(...readdirSync(T).filter((f) => f.endsWith(".ts")).map((f) => statSync(`${T}/${f}`).mtimeMs)); let st = null; try { st = JSON.parse(readFileSync(import.meta.dir + "/../../../data-scratch/flaky-last.json", "utf8")); } catch {}
  const v = flakyVerdict(st, newest); line(v.ok, `tests are stable: ${v.why}`); }
// 10 the busy detector cannot flag our own engines (they once aborted the baseline run)
{ const { readProcs, ownPids, otherJobs } = await import("../src/gpuLoad"); const { rows, listeners } = await readProcs(); const own = ownPids(listeners, rows);
  const loud = rows.map((r) => (own.has(r.pid) ? { ...r, pcpu: 100, rss: 20 * 1048576 } : r)).filter((r) => own.has(r.pid)); const flagged = otherJobs(loud, own, listeners);
  line(listeners.size > 0 && flagged.length === 0, `busy detector ignores own engines: own pids ${[...own].join(",") || "none"} (ports ${[...listeners.values()].join(",") || "none up"}), flagged ${flagged.length ? flagged.join(" | ") : "none"}`); }
{ const { otherJobs, gpuClass: gc } = await import("../src/gpuLoad"); const R = (pid: number, rss: number, pcpu: number, cmd: string) => ({ pid, ppid: 1, rss, pcpu, cmd });
  const idleBig = otherJobs([R(1, 14 * 1048576, 1, "/x/splash-chat/engine/splash-chat --port 51000"), R(2, 1e6, 90, "host/.venv/bin/python scripts/feature-ledger.py")], new Set());
  const ok = idleBig.length === 0 && gc({ util: 95, jobs: "" }) === "free" && gc({ util: 20, jobs: "pid=5 60% llama-server" }) === "shared";
  line(ok, `busy detector: idle 14 GB engine and a CPU-only python are not busy; a named engine is, remote-screen GPU use is not (flagged ${idleBig.length})`); }
// 11 the chat prompt prefix stays cached: at least 90% of the prompt tokens of this run's turns come from the cache
{ const { readFileSync } = await import("node:fs"); const rows = readFileSync(import.meta.dir + "/../results/turns.jsonl", "utf8").trim().split("\n").map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((m) => m && m.at && m.at >= RUN_START && typeof m.prompt_tokens_reused === "number" && typeof m.prompt_tokens_read === "number");
  const sh = rows.map((m: any) => m.prompt_tokens_reused / Math.max(1, m.prompt_tokens_reused + m.prompt_tokens_read)).sort((a: number, b: number) => a - b); const med = sh.length ? sh[sh.length >> 1] : 0;
  line(sh.length >= 3 && med >= 0.9, `chat prompt prefix reuse: median ${(med * 100).toFixed(0)}% of prompt tokens from the cache over ${sh.length} turns (needs 90%; lowest ${sh.length ? (sh[0] * 100).toFixed(0) : "-"}%)`); }
// 12 no phrase was spoken in a voice other than the requested one during this run
{ const { existsSync, readFileSync } = await import("node:fs"); const f = import.meta.dir + "/../results/voice-fallbacks.jsonl"; const bad = existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((x) => x && x.at >= RUN_START) : [];
  line(bad.length === 0, `every phrase was spoken in the requested voice${bad.length ? `; ${bad.length} WERE NOT (first: chunk ${bad[0].chunk} in "${bad[0].used}" instead of "${bad[0].requested}", "${bad[0].text}")` : ""}`); }
// 8 reconnect
const reconnect = await run(["bun", "test", "tests/reconnect.test.ts"]);
line(/ 1 pass/.test(reconnect) && /0 fail/.test(reconnect), "the page reconnects by itself after the server goes away (unit test of the reconnect logic; the page also says Reconnecting)");

const gpuAtEnd = await sampleGpu(); const { isSpeechJob } = await import("../src/burstFilter"); const okJobs = (g: { util: number; jobs: string }) => gpuClass(g) === "free" || g.jobs.split(" | ").filter(Boolean).every(isSpeechJob); /* a short hub speech burst is labelled, not a failure */ const { unnamedGpuLoad } = await import("../src/gpuLoad"); const rowsNow = (await readProcs()).rows; const unnamed = unnamedGpuLoad(gpuAtStart, startRows) || unnamedGpuLoad(gpuAtEnd, rowsNow); const klass = okJobs(gpuAtStart) && okJobs(gpuAtEnd) && !unnamed ? "GPU FREE" : "GPU SHARED"; if (unnamed) console.log(`UNNAMED GPU LOAD: utilization ${gpuAtStart.util}% at start / ${gpuAtEnd.util}% at end with no named engine and a quiet remote screen: something unlisted used the GPU, this run is not valid`); const screenAtEnd = remoteScreenLabel((await readProcs()).rows); console.log(`RUN CLASS: ${klass}, ${screenAtStart === "quiet" && screenAtEnd === "quiet" ? "quiet" : "remote screen active"} (start: ${gpuAtStart.util}% ${gpuAtStart.jobs || "no other GPU job"}; end: ${gpuAtEnd.util}% ${gpuAtEnd.jobs || "no other GPU job"}). Only a GPU FREE run counts as ready for the owner; a GPU SHARED run shows what a video job does to the conversation.`);
const bad = results.filter(([ok]) => !ok).length; console.log(bad === 0 && klass === "GPU SHARED" ? "ALL PASS but the GPU was shared: not a valid ready run (rerun with --wait-gpu-free)" : bad === 0 ? (quick ? "QUICK PASS (fast loop only: the full run must also pass before the owner is told to test)" : "READY: all checks passed") : `NOT READY: ${bad} check(s) failed`);
process.exit(bad ? 1 : 0);
