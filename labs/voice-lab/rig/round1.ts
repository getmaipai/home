// Round 1 judge run: barge-in and duplex, with the round-1 settings ON (echo-reference cut-in, device local stop, overlap messages, her rare "mm-hm").
// Each case runs RUNS times through rig/echotest.ts --round1; every run is judged from the RECORDING of her speaker output (rig/round1/judge.ts).
// THE ROOM IS SIMULATED: her voice is played into a virtual microphone with delay, reflections and an echo-canceller residue of 8 percent. A real speaker and microphone are not tested here.
// Usage: bun rig/round1.ts [--runs 5] ; exit 0 only if every case passes every run.
import "./lockguard"; // refuses while a clean run holds the lab (src/runLock.ts)
import { readWav } from "./listen/audio";
import { judgeRun, type R1Run } from "./round1/judge";
const SECRET_FILE = Bun.env.LAB_SECRET_FILE ?? "/Users/jessetorres/Developer/github.com/getmaipai/home/data-scratch/voice-lab-secret.txt";
const i = process.argv.indexOf("--runs"), RUNS = i >= 0 ? Number(process.argv[i + 1]) : 5;
const OUT = `${import.meta.dir}/../../../data-scratch/round1`;
const CASES: Array<[string, string]> = [
  ["a", "silent"], ["a", "repeat"], ["b", "mmhm"], ["b", "yeah"], ["b", "cough"], ["c", "stop"], ["c", "sentence"], ["d", "overlap"], ["e", "nodmid"]];
const WHAT: Record<string, string> = { silent: "her own voice fed back", repeat: "person repeats a word she just said", mmhm: "person says mm-hm", yeah: "person says yeah", cough: "person coughs", stop: "person says wait, stop", sentence: "person starts a new sentence", overlap: "both talk briefly (Thursday?)", nodmid: "her mm-hm while the person talks a long turn" };
console.log("ROUND 1 (barge-in and duplex). THE ROOM IS SIMULATED: virtual microphone with delay, reflections and 8% echo-canceller residue; no real speaker or microphone.");
let allPass = true;
for (const [grp, scn] of CASES) {
  const p = Bun.spawn(["bun", "rig/echotest.ts", SECRET_FILE, "--scenario", scn, "--runs", String(RUNS), "--round1", "--out", OUT], { cwd: import.meta.dir + "/..", stdout: "pipe", stderr: "ignore" });
  const text = await new Response(p.stdout).text(); await p.exited;
  const runs = text.split("\n").filter((l) => l.startsWith("{")).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((r) => r && r.round1) as Array<R1Run & { wav: string }>;
  if (runs.length < RUNS) { console.log(`(${grp}) ${scn}: ONLY ${runs.length}/${RUNS} runs came back (not a pass): ${text.split("\n").slice(-3).join(" | ").slice(0, 200)}`); allPass = false; continue; }
  const v = runs.map((r) => judgeRun(r, readWav(r.wav).samples));
  const pass = v.filter((x) => x.pass).length; if (pass < runs.length) allPass = false;
  const worst: string[] = [];
  const sil = v.map((x) => x.silentMs).filter((x): x is number => x !== null); if (scn === "stop" || scn === "sentence") worst.push(`silent after the person starts: median ${[...sil].sort((a, b) => a - b)[Math.floor(sil.length / 2)] ?? "-"} ms, worst ${sil.length ? Math.max(...sil) : "never stopped"} ms`);
  const dips = v.map((x) => x.dip).filter((x): x is number => x !== null); if (dips.length) worst.push(`worst volume dip ${Math.max(...dips)} dB`);
  const kept = v.map((x) => x.kept).filter((x): x is number => x !== null); if (kept.length) worst.push(`fewest words kept ${Math.round(Math.min(...kept) * 100)}%`);
  if (scn === "nodmid") worst.push(`her mm-hm sounded in ${runs.filter((r) => r.nods > 0).length}/${runs.length} runs`);
  console.log(`(${grp}) ${WHAT[scn]}: ${pass}/${runs.length} pass${worst.length ? "; " + worst.join("; ") : ""}`);
  for (const [k, x] of v.entries()) if (!x.pass) console.log(`     run ${k + 1}: ${x.reasons.join("; ")}`);
}
console.log(allPass ? "ROUND 1 PASS (simulated room)" : "ROUND 1 NOT PASSED (simulated room)");
process.exit(allPass ? 0 : 1);
