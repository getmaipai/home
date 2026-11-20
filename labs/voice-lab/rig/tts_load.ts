// Does a voice keep up with real time, alone and while a heavy chat generation runs beside it?
// Usage: bun rig/tts_load.ts <port> <voice> [--load] [--n 8]    (--load keeps the lab chat model (port 9921) writing long text the whole time)
const [port, voice] = [process.argv[2]!, process.argv[3] ?? "casual"]; const load = process.argv.includes("--load"); const N = Number(process.argv[process.argv.indexOf("--n") + 1] || 8);
const TEXTS = ["Oh, I think that is a really good idea, honestly.", "Well, it depends on what you mean, but I would start by looking at the cheaper option first, you know.", "Okay, so the short version is that it takes about twenty minutes, and then you just let it rest for a bit."];
let stop = false;
async function chatLoad() { while (!stop) { try { const r = await fetch("http://127.0.0.1:9921/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stream: true, cache_prompt: false, messages: [{ role: "user", content: "Write a very long, detailed story about a dragon who learns to bake bread. Keep going for a long time." }], max_tokens: 1500, temperature: 0.8 }) }); for await (const _ of r.body as any) { if (stop) break; } } catch { await Bun.sleep(500); } } }
if (load) void chatLoad(); if (load) await Bun.sleep(3000);
const rows: Array<{ ttfa: number; rtf: number }> = [];
for (let i = 0; i < N; i++) {
  const f = new FormData(); f.set("text", TEXTS[i % TEXTS.length]!); f.set("voice", voice); const t0 = performance.now(); let first = 0, bytes = 0, firstBytes = 0, last = 0;
  const r = await fetch(`http://127.0.0.1:${port}/tts`, { method: "POST", body: f }); for await (const c of r.body as any) { const n = (c as Uint8Array).length; if (!first && bytes + n > 44) { first = performance.now(); firstBytes = bytes + n - 44; } bytes += n; last = performance.now(); }
  const audioS = Math.max(0, bytes - 44) / 2 / 24000, wall = (last - first) / 1000, after = audioS - firstBytes / 2 / 24000;
  rows.push({ ttfa: first - t0, rtf: wall > 0.05 ? after / wall : 99 }); await Bun.sleep(300);
}
stop = true;
const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]!;
console.log(`port ${port} voice ${voice} ${load ? "WITH heavy chat generation" : "idle"}: first byte median ${Math.round(med(rows.map((r) => r.ttfa)))} ms (worst ${Math.round(Math.max(...rows.map((r) => r.ttfa)))}); speed after first piece, median ${med(rows.map((r) => r.rtf)).toFixed(2)}x real time, worst ${Math.min(...rows.map((r) => r.rtf)).toFixed(2)}x; below real time in ${rows.filter((r) => r.rtf < 1).length} of ${rows.length}`);
process.exit(0);
