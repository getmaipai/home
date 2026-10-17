// Timeline of one canary turn: when each event arrives. Needs MAIPAI_DATA_DIR (scratch) and CANARY_TEXT, CANARY_SPOKEN=1 optional.
import { setHouseholdSettingValue } from "@/lib/settings";
import { runTurnNextStream } from "@/lib/turnMachine/turnNext";
import { streamTurnEvents, SPOKEN_CUE_DELAY_MS, THINKING_CUE_DELAY_MS } from "@/routes/turn";
import { healthActor } from "@/lib/canary/identity";
setHouseholdSettingValue("engines.stack.url", "http://127.0.0.1:8770");
const spoken = process.env.CANARY_SPOKEN === "1";
const actor = healthActor();
const t0 = performance.now();
const at = () => `${((performance.now() - t0) / 1000).toFixed(1)}s`;
const abort = new AbortController();
setTimeout(() => abort.abort(), Number(process.env.CANARY_MS ?? 150_000));
const result = await runTurnNextStream(actor, "chat", process.env.CANARY_TEXT ?? "hello there", { temporary: true, spoken, signal: abort.signal });
if (!result.ok || result.kind !== "stream") { console.log("no stream", JSON.stringify(result).slice(0, 200)); process.exit(0); }
let chars = 0;
for await (const ev of streamTurnEvents(result, actor.id, spoken ? SPOKEN_CUE_DELAY_MS : THINKING_CUE_DELAY_MS, abort.signal, false, undefined, "adult", undefined, undefined, { spokenTurn: spoken, onToolStart: (p) => console.log(at(), "tool_start", p) })) {
  if (ev.type === "delta") { if (chars === 0) console.log(at(), "first delta"); chars += ev.text.length; }
  else if (ev.type === "status") console.log(at(), "status", ev.stage);
  else if (ev.type === "done") console.log(at(), "done reply chars", ev.value.reply.text.length, "blocks", JSON.stringify((ev.value as { blocks?: unknown[] }).blocks?.map((b) => (b as { type?: string }).type) ?? null), "source", (ev.value as { source?: string }).source);
  else if (ev.type === "error") console.log(at(), "error", ev.error.slice(0, 80));
  else if (ev.type === "reasoning") { /* quiet */ }
  else if (!ev.type) console.log(at(), "untyped", JSON.stringify(ev).slice(0, 120));
  else console.log(at(), ev.type);
}
console.log(at(), "chars", chars, "tools", (result.toolEvents ?? []).map((e) => `${e.t}:${(e as { package_id?: string }).package_id ?? ""}`).join(","));
process.exit(0);
