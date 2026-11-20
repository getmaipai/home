// Replays the frame arrivals saved by measure.ts through playback-start policies, under clean and phone-like networks.
// Usage: bun rig/policy.ts <frames.json>
import { JitterGate, replay } from "../public/jitter.js";
const data = JSON.parse(await Bun.file(process.argv[2]!).text());
let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
type Fr = { at: number; sec: number };
const profile = (name: string, frames: Fr[]): Fr[] => {
  if (name === "clean") return frames;
  const delay = name === "phone" ? 80 : 120, jit = name === "phone" ? 30 : 90, stallEvery = name === "phone" ? 4000 : 2500, stall = name === "phone" ? 250 : 450;
  let prev = 0; return frames.map((f) => { let at = f.at + delay + rnd() * jit; const k = Math.floor(at / stallEvery); if (k > 0 && at < k * stallEvery + stall) at = k * stallEvery + stall; at = Math.max(prev, at); prev = at; return { at, sec: f.sec }; });
};
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)]! : NaN; };
const fixed = (ms: number) => () => new JitterGate({ startMs: ms, minMs: ms, maxMs: ms });
const policies: Record<string, () => JitterGate> = {
  "none (what the page did)": () => new JitterGate({ startMs: 1, minMs: 1, maxMs: 1, holdMs: 0 }),
  "fixed 120 ms": fixed(120), "fixed 160 ms": fixed(160), "fixed 200 ms": fixed(200), "fixed 250 ms": fixed(250),
  "adaptive 80 (grows on underrun)": () => new JitterGate(),
  "adaptive 200..700": () => new JitterGate({ startMs: 200, minMs: 160, maxMs: 700 }),
};
for (const net of ["clean", "phone", "bad"]) {
  console.log(`\nnetwork: ${net}`);
  for (const [name, make] of Object.entries(policies)) {
    const gate = make(); let gaps = 0, gapMs = 0, turnsWithGaps = 0; const adds: number[] = [];
    for (const turn of data.frames) {
      const fr = profile(net, turn.frames); const before = gate.underruns;
      const r = replay(fr, gate); if (r.startAt != null) adds.push(r.startAt - fr[0]!.at);
      gaps += r.gaps; gapMs += r.gapMs; if (r.gaps) turnsWithGaps++; if (gate.underruns === before && r.gaps === 0) gate.cleanTurn();
    }
    console.log(`  ${name.padEnd(38)} gaps=${String(gaps).padStart(3)} in ${String(turnsWithGaps).padStart(2)} turns, ${String(gapMs).padStart(6)} ms dry, start delay median ${med(adds).toFixed(0)} ms, final target ${gate.targetMs}`);
  }
}
