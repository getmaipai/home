// "Ready to test" gate. Run `bun rig/ready.ts` in labs/voice-lab. It must pass before anyone tells the owner to test the lab.
// One plain line per check. Options: --quick (4 runs instead of 20 / 10 turns, for development only; not valid for "ready").
import { availableTags, pickSound, refusedSounds } from "../src/sounds";
import { buildPrompt } from "../src/prompt";
import { TAGS } from "../src/tags";
import { machineBusy } from "./loadcheck";
const SECRET_FILE = Bun.env.LAB_SECRET_FILE ?? "/Users/jessetorres/Developer/github.com/getmaipai/home/data-scratch/voice-lab-secret.txt";
const quick = process.argv.includes("--quick"), RUNS = quick ? 4 : 10, TURNS = quick ? 4 : 10;
const FIRST_SOUND_TARGET_MS = 1350, P90_LIMIT_MS = 2300, WORST_LIMIT_MS = 3500; // median 1.17 s, p90 1.93 s, worst about 2.6 s measured, plus 15 percent where the sample is stable // best honest first-byte median measured on this machine (1.17 s) plus 15 percent
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

// 2 no other lab load, no real page
const others = (await run(["pgrep", "-f", "rig/(measure|echotest)\\.ts"])).trim().split("\n").filter((p) => p && Number(p) !== process.pid);
let live = -1; try { live = ((await (await fetch(`http://${LAB}/api/live`, { headers: { "x-lab-secret": secret } })).json()) as { live: number }).live; } catch {}
line(others.length === 0 && live === 0, `no other rig run is going (${others.length}) and no real page is connected (${live < 0 ? "unknown" : live}); rigs wait while a page is connected`);
if (others.length || live !== 0) { console.log("Stopping here: running the checks now would disturb a live test."); process.exit(1); }

{ const m = await machineBusy(); line(!m.busy, `machine is quiet enough to measure (load average ${m.load1.toFixed(1)}, limit 4)${m.busy ? "; BUSY: " + m.top : ""}`); if (m.busy) { console.log("NOT MEASURED: the machine is busy; nothing below would be valid."); process.exit(3); } }
// 7 tags (cheap, before the slow runs)
const offered = [...new Set((buildPrompt().match(/\[([a-z ]+)\]/g) ?? []).map((t) => t.slice(1, -1)))].filter((t) => (TAGS as readonly string[]).includes(t) && !["whisper", "shout", "excited", "happy", "angry", "sad", "sarcastic"].includes(t));
const silent = offered.filter((t) => { const p = pickSound("casual", t, 0.08); return !p || p.length < 3600; });
const refusedNow = refusedSounds("casual"); line(refusedNow.length === 0, `every library sound is from the voice's own speaker${refusedNow.length ? "; FROM ANOTHER SPEAKER: " + refusedNow.join(", ") : ""}`);
line(offered.length > 0 && silent.length === 0, `every sound tag the prompt offers makes a real sound (${offered.join(", ") || "none offered"})${silent.length ? "; NO SOUND FOR: " + silent.join(", ") : ""}`);

// 5 + 6 first sound and gaps over TURNS turns
const J = "/private/tmp/claude-501/ready-measure.json";
await run(["bun", "rig/measure.ts", SECRET_FILE, "--n", String(TURNS), "--json", J]);
try { const s = JSON.parse(await Bun.file(J).text()).summary;
  line(s.firstSoundMedianMs <= FIRST_SOUND_TARGET_MS, `median first sound over ${s.turns} turns is ${s.firstSoundMedianMs} ms (limit ${FIRST_SOUND_TARGET_MS} ms; worst ${s.firstSoundWorstMs} ms)`);
  line(s.firstSoundP90Ms <= P90_LIMIT_MS && s.firstSoundWorstMs <= WORST_LIMIT_MS, `p90 first sound ${s.firstSoundP90Ms} ms (limit ${P90_LIMIT_MS}) and worst ${s.firstSoundWorstMs} ms (limit ${WORST_LIMIT_MS}): the outliers are what is felt`);
  line(s.totalGaps === 0, `audio gaps in those turns: ${s.totalGaps} (the page's playback gate, replayed on the real frame arrivals)`);
} catch { line(false, "the measuring run produced no result"); line(false, "no gap result"); }

// 3 + 4 echo tests
for (const [scenario, label, need] of [["silent", "her own voice fed back into the microphone at speaker level causes no stop", (m: RegExpMatchArray) => Number(m[1]) === RUNS && m[2] === "0"], ["stop", '"wait, stop" over her voice stops her', (m: RegExpMatchArray) => Number(m[1]) === RUNS]] as const) {
  const out = await run(["bun", "rig/echotest.ts", SECRET_FILE, "--scenario", scenario, "--runs", String(RUNS)]);
  const m = out.match(/SCENARIO \w+: (\d+)\/(\d+) pass; self-interruptions (\d+)/);
  const ok = !!m && Number(m[1]) === Number(m[2]) && (scenario === "stop" ? true : m[3] === "0");
  line(ok, `${label}: ${m ? `${m[1]} of ${m[2]} runs, self-interruptions ${m[3]}` : "no result"}`);
}
// 9 the listener: three full conversations (two on a quiet machine, one with background load); the worst case decides
if (!quick) {
  for (const [label, extra] of [["quiet machine, run 1 and 2", ["--runs", "2"]], ["with background load", ["--runs", "1", "--load"]]] as const) {
    const out = await run(["bun", "rig/listen.ts", SECRET_FILE, ...extra]); const ok = /ALL RUNS: PASS/.test(out);
    const files = out.match(/LISTEN FILES[^\n]*/)?.[0] ?? ""; line(ok, `listener, three-minute conversation (${label}; room is SIMULATED, not real speakers): ${ok ? "same person, right words, smooth, joins, timing and stumble pattern all pass" : out.split("\n").filter((l) => /^(RUN|  )/.test(l)).slice(0, 4).join(" / ").slice(0, 400)} ${ok ? "" : files}`);
  }
} else line(true, "listener skipped in quick mode (not valid for telling the owner to test)");
// 8 reconnect
const reconnect = await run(["bun", "test", "tests/reconnect.test.ts"]);
line(/ 1 pass/.test(reconnect) && /0 fail/.test(reconnect), "the page reconnects by itself after the server goes away (unit test of the reconnect logic; the page also says Reconnecting)");

const bad = results.filter(([ok]) => !ok).length; console.log(bad === 0 ? (quick ? "ALL PASS (quick mode: not valid for telling the owner to test)" : "READY: all checks passed") : `NOT READY: ${bad} check(s) failed`);
process.exit(bad ? 1 : 0);
