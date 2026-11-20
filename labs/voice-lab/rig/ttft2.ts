import { buildPrompt, datedUser } from "../src/prompt";
import { toolDefinitions } from "../src/tools";
const LLM = "http://127.0.0.1:9921"; const sys = buildPrompt();
async function t(label: string, extra: any, user = "Say hello right now.") {
  const msgs = [{ role: "system", content: sys }, { role: "user", content: datedUser(user) }];
  const run = async () => { const t0 = performance.now(); let first = 0; const r = await fetch(LLM + "/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stream: true, cache_prompt: true, id_slot: 0, messages: msgs, max_tokens: 8, temperature: 0.8, ...extra }) });
    const dec = new TextDecoder(); for await (const c of r.body as any) { if (!first && dec.decode(c).includes('"content":"')) first = performance.now() - t0; } return first; };
  await run(); const a = [await run(), await run(), await run()].map(Math.round); console.log(label.padEnd(44), "cached first token ms", a.join(" "));
}
await t("no tools", {});
await t("tools, auto", { tools: toolDefinitions, tool_choice: "auto" });
await t("tools, tool_choice none", { tools: toolDefinitions, tool_choice: "none" });
await t("tools, auto, parse_tool_calls false", { tools: toolDefinitions, tool_choice: "auto", parse_tool_calls: false });
await t("tools, auto, parallel false", { tools: toolDefinitions, tool_choice: "auto", parallel_tool_calls: false });
await t("tools, no tool_choice", { tools: toolDefinitions });
