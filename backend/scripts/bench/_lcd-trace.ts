import "../../../scripts/runTemp";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const chatUrl = process.env.MAIPAI_LLAMA_SERVER_URL!.replace(/\/$/, "");
const OUT = process.env.LCD_OUT!;
const REPS = Number(process.env.LCD_REPS ?? 8);
const Q = process.env.LCD_Q ?? "have you heard of LCD Soundsystem";
mkdirSync(OUT, { recursive: true });
process.env.MAIPAI_DATA_DIR = mkdtempSync(join(tmpdir(), "lcd-trace-"));
const dead = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response(JSON.stringify({ query: { search: [] } }), { headers: { "content-type": "application/json" } }) });
process.env.MAIPAI_WIKIPEDIA_BASE_URL = `http://127.0.0.1:${dead.port}`;
const { startFixtureSearch } = await import("./fixtureSearch");
const fx = startFixtureSearch([{ id: "lcd", prompt: Q }]);
let log: { req: any; res: string }[] = [];
const roleRow = (id: string, wire: string) => ({ id, label: id, wire, residency: "resident", endpoints: [], quality: ["everyday"], sharesModelWith: null, state: { state: "ready", reason: null }, reason: null, model: null, check: { state: "passed", at: null, reason: null, stale: false } });
const standIn = Bun.serve({ port: 0, hostname: "127.0.0.1", idleTimeout: 120, async fetch(req) {
  const path = new URL(req.url).pathname;
  if (path === "/healthz") return Response.json({ ok: true, version: "x", uptimeSeconds: 0 });
  if (path === "/health") return Response.json({ status: "ok" });
  if (path === "/stack/v1/roles") return Response.json({ roles: [roleRow("chat", "chat"), roleRow("judge", "chat"), roleRow("embed", "embeddings")] });
  if (path === "/v1/embeddings") return Response.json({ error: "offline", role: "embed", state: "offline", offline_reason: "bench" }, { status: 503 });
  if (path === "/v1/chat/completions") {
    const body = await req.text();
    const up = await fetch(chatUrl + path, { method: "POST", headers: { "content-type": "application/json" }, body, signal: req.signal });
    const text = await up.text();
    let out = ""; const calls: string[] = [];
    for (const l of text.split("\n")) { if (!l.startsWith("data:")) continue; const p = l.slice(5).trim(); if (!p || p === "[DONE]") continue; try { const d = JSON.parse(p).choices?.[0]?.delta; if (d?.content) out += d.content; for (const t of d?.tool_calls ?? []) calls.push(JSON.stringify(t.function)); } catch {} }
    log.push({ req: JSON.parse(body), res: out + (calls.length ? "\n[TOOLCALLS] " + calls.join(" ") : "") });
    return new Response(text, { status: up.status, headers: { "content-type": up.headers.get("content-type") ?? "application/json" } });
  }
  return new Response("nf", { status: 404 });
} });
process.env.MAIPAI_LLAMA_SERVER_URL = standIn.url.toString().replace(/\/$/, "");
process.env.MAIPAI_EMBED_URL = process.env.MAIPAI_LLAMA_SERVER_URL;
const setup = await import("./setup");
const runner = await import("./conversationRunner");
const { setHouseholdSettingValue } = await import("@/lib/settings");
await setup.startBench();
setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
setHouseholdSettingValue("search.searxng_url", fx.url);
const people = runner.createBenchPeople();
const { createConversation } = await import("@/lib/conversationHistory");
const { runTurnNextStream } = await import("@/lib/turnMachine/turnNext");
const { streamTurnEvents } = await import("@/routes/turn");
const all: any[] = [];
for (let i = 1; i <= REPS; i++) {
  log = [];
  const actor = people.owner as any;
  const c = createConversation(actor, { surface: "chat" }); if (!c.ok) throw new Error(c.error);
  let reply = "";
  const r = await runTurnNextStream(actor, "chat", Q, { conversationId: c.value.id, spoken: false, thinking: false });
  if (r.ok && r.kind !== "immediate") for await (const e of streamTurnEvents(r, actor.id, 900, undefined, true)) { if (e.type === "delta") reply += e.text; else if (e.type === "done" && !reply.trim()) reply = e.value.reply.text; }
  all.push({ rep: i, reply, rounds: log });
  console.log(`--- rep ${i} ---\n${reply}\n`);
  writeFileSync(join(OUT, "runs.json"), JSON.stringify(all, null, 2));
}
runner.cleanupBenchPeople(people);
process.exit(0);
