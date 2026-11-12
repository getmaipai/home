// CONVO-PREWARM-03 (2026-11-12): which earlier requests the chat engine resumes from. Each case uses its own unique system
// filler, so cases never share cache, and reads only prompt_n and cache_n back. Measured against Splash 1.6.1 (the Huihui
// Qwen3.8-27B hybrid): a request resumes only from the END of an earlier request (its prompt rounded down to a 32-token
// block, minus the template's generation tail) or from a 4096-token checkpoint; a shared prefix that ends before an earlier
// request's end resumes nothing (cases S1 to S3: cache_n 0; S4 and S6: the end state; S5: 4096). Idle time, other requests
// and concurrent requests do not evict (P1 to P4, Q1 to Q7). The results are in docs/design/speculative-start-2026-11-11.md.
//   cd backend && MAIPAI_DATA_DIR=<a dev hub's data dir> MAIPAI_KEYSTORE_BACKEND=file bun run scripts/bench/engine-resume-probe.ts [C|P|Q|S]
// The live engine is shared with the hub: one run is about 40 requests of 2.4k tokens; keep it to a quiet moment.
import { complete, startCompleteStreamPieces, type LlmMessage } from "@/lib/llm";

const WORDS = "orchard lantern meadow copper violin harbor thistle quartz ember willow saddle marble pepper falcon tundra cedar".split(" ");
function filler(tag: string, words = 1500): string {
  const out: string[] = [`Case ${tag}.`];
  for (let i = 0; i < words; i++) out.push(WORDS[(i * 7 + tag.length + i * i) % WORDS.length]! + (i % 11 === 10 ? "." : ""));
  return out.join(" ");
}
const sys = (tag: string): LlmMessage => ({ role: "system", content: `You are a terse assistant. Answer in five words. ${filler(tag)}` });
const u1: LlmMessage = { role: "user", content: "Name one colour of the sea." };
const a1: LlmMessage = { role: "assistant", content: "The sea is often deep blue." };
const u2: LlmMessage = { role: "user", content: "And one colour of the sky at night?" };

async function nonStream(messages: LlmMessage[], max: number) {
  const r = await complete("chat", messages, { max_tokens: max, exactCeiling: true, thinking: false, dropReasoning: true });
  return r.ok ? { prompt_n: r.value.prompt_n, cache_n: r.value.cache_n, finish: r.value.finish_reason } : { error: r.error };
}
async function stream(messages: LlmMessage[], max: number) {
  const s = await startCompleteStreamPieces("chat", messages, { max_tokens: max, dropReasoning: true });
  if (!s.ok) return { error: s.error };
  for await (const _ of s.pieces) { /* drain */ }
  const t = s.stats.timings as { prompt_n?: number; cache_n?: number } | null;
  const u = s.stats.usage as { prompt_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } | null;
  return { prompt_n: u?.prompt_tokens ?? t?.prompt_n, cache_n: u?.prompt_tokens_details?.cached_tokens ?? t?.cache_n, finish: s.stats.stopReason };
}
const only = process.argv[2];
const cases: Array<[string, () => Promise<unknown>]> = [
  ["C1 prewarm shape non-stream max1, then real turn stream", async () => { const S = sys("c1"); return { A: await nonStream([S, u1, a1], 1), B: await stream([S, u1, a1, u2], 16) }; }],
  ["C2 prewarm shape stream max1, then real turn stream", async () => { const S = sys("c2"); return { A: await stream([S, u1, a1], 1), B: await stream([S, u1, a1, u2], 16) }; }],
  ["C3 prewarm shape non-stream max16, then real turn stream", async () => { const S = sys("c3"); return { A: await nonStream([S, u1, a1], 16), B: await stream([S, u1, a1, u2], 16) }; }],
  ["C4 prewarm ends with a user message (non-stream max1), then real turn", async () => { const S = sys("c4"); return { A: await nonStream([S, u1, a1, { role: "user", content: "Context for this turn" }], 1), B: await stream([S, u1, a1, u2], 16) }; }],
  ["C5 control: real turn stream, then next real turn stream", async () => { const S = sys("c5"); return { A: await stream([S, u1], 16), B: await stream([S, u1, a1, u2], 16) }; }],
  ["C6 same request twice non-stream max1", async () => { const S = sys("c6"); return { A: await nonStream([S, u1, a1], 1), B: await nonStream([S, u1, a1], 1) }; }],
  ["C7 same request twice stream max1", async () => { const S = sys("c7"); return { A: await stream([S, u1, a1], 1), B: await stream([S, u1, a1], 1) }; }],
  ["C8 prewarm non-stream max1 then the same prompt streamed max16", async () => { const S = sys("c8"); return { A: await nonStream([S, u1, a1], 1), B: await stream([S, u1, a1], 16) }; }],
];
for (const [name, run] of cases) {
  if (only && only !== "C") break;
  const t0 = Date.now();
  console.log(name, JSON.stringify(await run()), `${Date.now() - t0} ms`);
}
// --- pool and idle probes (argv[2] = "P") ---
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function others(n: number, tag: string) { for (let i = 0; i < n; i++) await nonStream([sys(`${tag}-other-${i}`), u1], 1); }
const pcases: Array<[string, () => Promise<unknown>]> = [
  ["P1 prewarm, idle 12 s, real turn", async () => { const S = sys("p1"); const A = await nonStream([S, u1, a1], 1); await sleep(12_000); return { A, B: await stream([S, u1, a1, u2], 16) }; }],
  ["P2 prewarm, 1 other request, real turn", async () => { const S = sys("p2"); const A = await nonStream([S, u1, a1], 1); await others(1, "p2"); return { A, B: await stream([S, u1, a1, u2], 16) }; }],
  ["P3 prewarm, 3 other requests, real turn", async () => { const S = sys("p3"); const A = await nonStream([S, u1, a1], 1); await others(3, "p3"); return { A, B: await stream([S, u1, a1, u2], 16) }; }],
  ["P4 prewarm, 6 other requests, real turn", async () => { const S = sys("p4"); const A = await nonStream([S, u1, a1], 1); await others(6, "p4"); return { A, B: await stream([S, u1, a1, u2], 16) }; }],
];
if (only === "P") for (const [name, run] of pcases) { const t0 = Date.now(); console.log(name, JSON.stringify(await run()), `${Date.now() - t0} ms`); }

// --- concurrency probes (argv[2] = "Q") ---
const small = (tag: string, max = 18) => nonStream([{ role: "system", content: `You are brief. ${filler(`${tag}-small`, 200)}` }, { role: "user", content: "Say one word." }], max);
const qcases: Array<[string, () => Promise<unknown>]> = [
  ["Q1 prewarm concurrent with a small request, then real turn alone", async () => { const S = sys("q1"); const [A, s] = await Promise.all([nonStream([S, u1, a1], 1), small("q1")]); return { A, s, B: await stream([S, u1, a1, u2], 16) }; }],
  ["Q2 prewarm alone, then real turn concurrent with a small request", async () => { const S = sys("q2"); const A = await nonStream([S, u1, a1], 1); const [B, s] = await Promise.all([stream([S, u1, a1, u2], 16), small("q2")]); return { A, s, B }; }],
  ["Q4 prewarm concurrent with small, real turn concurrent with small", async () => { const S = sys("q4"); const [A, s1] = await Promise.all([nonStream([S, u1, a1], 1), small("q4a")]); const [B, s2] = await Promise.all([stream([S, u1, a1, u2], 16), small("q4b")]); return { A, s1, B, s2 }; }],
  ["Q5 prewarm alone; small long decode starts, real turn 150 ms later", async () => { const S = sys("q5"); const A = await nonStream([S, u1, a1], 1); const sp = small("q5", 64); await sleep(150); const B = await stream([S, u1, a1, u2], 16); return { A, s: await sp, B }; }],
  ["Q6 small long decode starts, prewarm 150 ms later; then real turn alone", async () => { const S = sys("q6"); const sp = small("q6", 64); await sleep(150); const A = await nonStream([S, u1, a1], 1); const s = await sp; return { A, s, B: await stream([S, u1, a1, u2], 16) }; }],
  ["Q7 cold real turn concurrent with small, then prewarm alone, then next real turn alone", async () => { const S = sys("q7"); const [T, s] = await Promise.all([stream([S, u1], 16), small("q7")]); const A = await nonStream([S, u1, a1], 1); return { T, s, A, B: await stream([S, u1, a1, u2], 16) }; }],
];
if (only === "Q") for (const [name, run] of qcases) { const t0 = Date.now(); console.log(name, JSON.stringify(await run()), `${Date.now() - t0} ms`); }

// --- where do states exist after a cold request (argv[2] = "S") ---
const m = (role: "user" | "assistant", tag: string, words: number): LlmMessage => ({ role, content: filler(tag, words) });
const scases: Array<[string, () => Promise<unknown>]> = [
  ["S1 cold A=[S,m1,m2,m3,uvol(500w)]; B diverges at the start of the last message", async () => { const S = sys("s1"); const w = [m("user", "s1m1", 100), m("assistant", "s1m2", 100), m("user", "s1m3", 100)]; const A = await stream([S, ...w, m("user", "s1vol", 500)], 8); return { A, B: await stream([S, ...w, { role: "user", content: "short question?" }], 8) }; }],
  ["S2 cold A as S1; B diverges one message earlier (at m3)", async () => { const S = sys("s2"); const w = [m("user", "s2m1", 100), m("assistant", "s2m2", 100)]; const A = await stream([S, ...w, m("user", "s2m3", 100), m("user", "s2vol", 500)], 8); return { A, B: await stream([S, ...w, { role: "user", content: "short question?" }], 8) }; }],
  ["S3 cold A as S1; B diverges in the middle of the last message", async () => { const S = sys("s3"); const w = [m("user", "s3m1", 100), m("assistant", "s3m2", 100), m("user", "s3m3", 100)]; const vol = filler("s3vol", 500); const A = await stream([S, ...w, { role: "user", content: vol }], 8); return { A, B: await stream([S, ...w, { role: "user", content: vol.slice(0, vol.length / 2) + " different tail here." }], 8) }; }],
  ["S4 cold A as S1; B extends A exactly (A plus assistant plus user)", async () => { const S = sys("s4"); const w = [m("user", "s4m1", 100), m("assistant", "s4m2", 100), m("user", "s4m3", 100), m("user", "s4vol", 500)]; const A = await stream([S, ...w], 8); return { A, B: await stream([S, ...w, { role: "assistant", content: "Noted, thanks." }, { role: "user", content: "short question?" }], 8) }; }],
  ["S5 cold A with a 4300-word system (about 5k tokens); B diverges at the start of the last message", async () => { const S: LlmMessage = { role: "system", content: `You are a terse assistant. ${filler("s5", 4300)}` }; const w = [m("user", "s5m1", 100), m("assistant", "s5m2", 100)]; const A = await stream([S, ...w, m("user", "s5vol", 300)], 8); return { A, B: await stream([S, ...w, { role: "user", content: "short question?" }], 8) }; }],
  ["S6 cold A; small prewarm-shaped request that diverges at the last message; then B extends the prewarm", async () => { const S = sys("s6"); const w = [m("user", "s6m1", 100), m("assistant", "s6m2", 100), m("user", "s6m3", 100)]; const A = await stream([S, ...w, m("user", "s6vol", 500)], 8); const P = await nonStream([S, ...w, { role: "user", content: "short question?" }, { role: "assistant", content: "Noted." }], 1); return { A, P, B: await stream([S, ...w, { role: "user", content: "short question?" }, { role: "assistant", content: "Noted." }, { role: "user", content: "next?" }], 8) }; }],
];
if (only === "S") for (const [name, run] of scases) { const t0 = Date.now(); console.log(name, JSON.stringify(await run()), `${Date.now() - t0} ms`); }
process.exit(0);
