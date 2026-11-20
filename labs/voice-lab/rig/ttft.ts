// Time to first chat token for different request shapes, against the lab's own chat engine (9921). Shows the fixed cost per request.
import { buildPrompt, datedUser } from "../src/prompt";
import { toolDefinitions } from "../src/tools";
const LLM = "http://127.0.0.1:9921";
const hist: any[] = [{ role: "system", content: buildPrompt() }];
async function ask(label: string, user: string, extra: any, keep = true, stream = true) {
  const msgs = [...hist, { role: "user", content: datedUser(user) }];
  const t0 = performance.now(); let first = 0, text = "";
  const r = await fetch(LLM + "/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stream: true, cache_prompt: true, id_slot: 0, messages: msgs, max_tokens: 40, temperature: 0.8, ...extra }) });
  const dec = new TextDecoder(); let buf = "";
  for await (const c of r.body as any) { buf += dec.decode(c, { stream: true }); let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line.startsWith("data:") || line.includes("[DONE]")) continue; try { const t = JSON.parse(line.slice(5)).choices?.[0]?.delta?.content; if (t) { if (!first) first = performance.now() - t0; text += t; } } catch {} } }
  console.log(label.padEnd(40), "first token", Math.round(first), "ms"); if (keep) { hist.push({ role: "user", content: datedUser(user) }, { role: "assistant", content: text }); } return text;
}
const tools = { tools: toolDefinitions, tool_choice: "auto" };
await ask("warm up (cold prefix) with tools", "Hi there.", tools);
for (let i = 0; i < 3; i++) await ask(`turn ${i + 1} with tools`, ["What should I name a goldfish?", "Tell me about the moon.", "How do I boil an egg?"][i]!, tools);
for (let i = 0; i < 3; i++) await ask(`turn ${i + 4} without tools`, ["Why is the sky blue?", "Do cats dream?", "What is two plus two?"][i]!, {});
// same request twice: second one is fully cached
await ask("repeat A (no keep) with tools", "Say hello.", tools, false); await ask("repeat A again (fully cached)", "Say hello.", tools, false);
await ask("repeat B without tools", "Say hello now.", {}, false); await ask("repeat B again (fully cached)", "Say hello now.", {}, false);
