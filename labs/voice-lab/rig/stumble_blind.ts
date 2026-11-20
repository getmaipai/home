// Review item F, blind A/B: the same fifteen moments answered under two stumble levels (default natural vs fits), spoken by the voice, shuffled, on a page that names no level.
// Needs the chat model (9921) and the voice server (9923): run it only in a free-GPU window, never during a live test. Output: public/stumble/index.html (+ wavs), the key in data-scratch/stumble-key.json (NOT under public),
// and a text-only pattern report (fillers, repeats, opening words) per level from rig/listen/judge.ts stumbleReport, so the written pattern is judged before anyone listens.
// Usage: bun rig/stumble_blind.ts [--a natural] [--b fits] ; afterwards: bun rig/stumble_blind.ts --tally '<answers json copied from the page>'
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildPrompt } from "../src/prompt";
import { availableTags } from "../src/sounds";
import { buildBlindPage, shuffleOrder, tally } from "../src/blindPage";
import { stumbleReport } from "./listen/judge";
const arg = (k: string, d: string) => { const i = process.argv.indexOf("--" + k); return i >= 0 ? process.argv[i + 1]! : d; };
const KEY = join(import.meta.dir, "../../../data-scratch/stumble-key.json");
if (process.argv.includes("--tally")) { const t = tally(JSON.parse(arg("tally", "{}")), JSON.parse(readFileSync(KEY, "utf8")).levels); console.log(JSON.stringify(t, null, 2)); process.exit(0); }
const A = arg("a", "natural"), B = arg("b", "fits"), LLM = Bun.env.LAB_LLM_URL ?? "http://127.0.0.1:9921", TTS = "http://127.0.0.1:9923", OUT = join(import.meta.dir, "../public/stumble"); mkdirSync(OUT, { recursive: true });
// a spread on purpose: facts she should say cleanly, things she could honestly be unsure about, small talk, instructions, feelings
const MOMENTS = ["What is the capital of Australia?", "How was your day?", "What should I make for dinner tonight?", "Can you remind me how to boil an egg?", "I think I messed up at work today.", "Do you remember what we talked about yesterday?", "What is the tallest mountain in the world?", "Tell me something funny.", "Is it going to rain this weekend?", "What is seven times eight?", "I can not decide between the blue one and the green one.", "Why is the sky blue?", "Give me the steps to reset my router.", "What do you think about pineapple on pizza?", "I got the job!"];
async function chat(level: string, you: string): Promise<string> { const r = await fetch(`${LLM}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: [{ role: "system", content: buildPrompt(availableTags("casual"), level) }, { role: "user", content: you }], temperature: 0.7, max_tokens: 120, stream: false }), signal: AbortSignal.timeout(120000) }); const j: any = await r.json(); return String(j.choices?.[0]?.message?.content ?? "").replace(/\[[^\]]*\]\s*/g, "").trim(); }
async function say(text: string): Promise<Uint8Array> { const f = new FormData(); f.set("text", text); f.set("voice", "casual"); return new Uint8Array(await (await fetch(TTS + "/tts", { method: "POST", body: f, signal: AbortSignal.timeout(180000) })).arrayBuffer()); }
const levels: Record<string, string[]> = {}, texts: Record<string, string[]> = { [A]: [], [B]: [] }, moments: Array<{ you: string; takes: Array<{ id: string; src: string }> }> = [];
for (const [m, you] of MOMENTS.entries()) {
  const made = { [A]: await chat(A, you), [B]: await chat(B, you) }; texts[A]!.push(made[A]); texts[B]!.push(made[B]);
  const order = shuffleOrder(2, m + 11).map((i) => [A, B][i]!); levels[String(m + 1)] = order; const takes: Array<{ id: string; src: string }> = [];
  for (const [k, lv] of order.entries()) { const id = `${m + 1}_${k + 1}`; writeFileSync(join(OUT, `${id}.wav`), await say(made[lv]!)); takes.push({ id, src: `${id}.wav` }); }
  moments.push({ you, takes });
}
writeFileSync(join(OUT, "index.html"), buildBlindPage(moments, "Which sounds more like a person?"));
writeFileSync(KEY, JSON.stringify({ levels, texts }, null, 1));
for (const lv of [A, B]) console.log(lv, JSON.stringify(stumbleReport(texts[lv]!)));
console.log(`page: public/stumble/index.html (key in ${KEY}, keep it from the listener)`);
