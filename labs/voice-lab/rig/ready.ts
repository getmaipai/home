// "Ready to test" gate. Run `bun rig/ready.ts` in labs/voice-lab. It must pass before anyone tells the owner to test the lab.
// One plain line per check. Options: --quick (4 runs instead of 20 / 10 turns, for development only; not valid for "ready").
import { availableTags, pickSound } from "../src/sounds";
import { buildPrompt } from "../src/prompt";
import { TAGS } from "../src/tags";
const SECRET_FILE = Bun.env.LAB_SECRET_FILE ?? "/Users/jessetorres/Developer/github.com/getmaipai/home/data-scratch/voice-lab-secret.txt";
const quick = process.argv.includes("--quick"), RUNS = quick ? 4 : 20, TURNS = quick ? 4 : 10;
const FIRST_SOUND_TARGET_MS = 1350; // best honest first-byte median measured on this machine (1.17 s) plus 15 percent
const secret = (await Bun.file(SECRET_FILE).text()).trim(), LAB = "127.0.0.1:9931";
const results: Array<[boolean, string]> = []; const line = (ok: boolean, text: string) => { results.push([ok, text]); console.log(`${ok ? "PASS" : "FAIL"}  ${text}`); };
const run = async (cmd: string[]) => { const p = Bun.spawn(cmd, { cwd: import.meta.dir + "/..", stdout: "pipe", stderr: "pipe" }); const out = await new Response(p.stdout).text(); await p.exited; return out; };
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

// 7 tags (cheap, before the slow runs)
const offered = [...new Set((buildPrompt().match(/\[([a-z ]+)\]/g) ?? []).map((t) => t.slice(1, -1)))].filter((t) => (TAGS as readonly string[]).includes(t) && !["whisper", "shout", "excited", "happy", "angry", "sad", "sarcastic"].includes(t));
const silent = offered.filter((t) => { const p = pickSound("casual", t, 0.08); return !p || p.length < 3600; });
line(offered.length > 0 && silent.length === 0, `every sound tag the prompt offers makes a real sound (${offered.join(", ") || "none offered"})${silent.length ? "; NO SOUND FOR: " + silent.join(", ") : ""}`);

// 5 + 6 first sound and gaps over TURNS turns
const J = "/private/tmp/claude-501/ready-measure.json";
await run(["bun", "rig/measure.ts", SECRET_FILE, "--n", String(TURNS), "--json", J]);
try { const s = JSON.parse(await Bun.file(J).text()).summary;
  line(s.firstSoundMedianMs <= FIRST_SOUND_TARGET_MS, `median first sound over ${s.turns} turns is ${s.firstSoundMedianMs} ms (limit ${FIRST_SOUND_TARGET_MS} ms; worst ${s.firstSoundWorstMs} ms)`);
  line(s.totalGaps === 0, `audio gaps in those turns: ${s.totalGaps} (the page's playback gate, replayed on the real frame arrivals)`);
} catch { line(false, "the measuring run produced no result"); line(false, "no gap result"); }

// 3 + 4 echo tests
for (const [scenario, label, need] of [["silent", "her own voice fed back into the microphone at speaker level causes no stop", (m: RegExpMatchArray) => Number(m[1]) === RUNS && m[2] === "0"], ["stop", '"wait, stop" over her voice stops her', (m: RegExpMatchArray) => Number(m[1]) === RUNS]] as const) {
  const out = await run(["bun", "rig/echotest.ts", SECRET_FILE, "--scenario", scenario, "--runs", String(RUNS)]);
  const m = out.match(/SCENARIO \w+: (\d+)\/(\d+) pass; self-interruptions (\d+)/);
  const ok = !!m && Number(m[1]) === Number(m[2]) && (scenario === "stop" ? true : m[3] === "0");
  line(ok, `${label}: ${m ? `${m[1]} of ${m[2]} runs, self-interruptions ${m[3]}` : "no result"}`);
}
// 8 reconnect
const reconnect = await run(["bun", "test", "tests/reconnect.test.ts"]);
line(/ 1 pass/.test(reconnect) && /0 fail/.test(reconnect), "the page reconnects by itself after the server goes away (unit test of the reconnect logic; the page also says Reconnecting)");

const bad = results.filter(([ok]) => !ok).length; console.log(bad === 0 ? (quick ? "ALL PASS (quick mode: not valid for telling the owner to test)" : "READY: all checks passed") : `NOT READY: ${bad} check(s) failed`);
process.exit(bad ? 1 : 0);
