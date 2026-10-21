// RECENCY-02: does the robot sound like its companion? Builds the real spoken-class messages (persona prefix, window, memory,
// the plan line) for scenario turns with Home's own functions, sends them to the live Stack's chat model with the production
// sampling and thinking off, and scores warmth and the follow-up on a remembered fact. Prompt variants replace only the "How to
// answer this one:" line, so the measure isolates the one sentence the model reads last.
//
//   MAIPAI_STACK_URL=http://127.0.0.1:8770 bun run scripts/bench/robotVoice.ts [--runs 3] [--companion rivet]
import { adaptPersonaToBand, resolvePersona } from "@/lib/persona";
import { planFor, planLineForTurnMachine } from "@/lib/register";
import { fallbackSignal } from "@/lib/turnSignal";
import { contextToMessages } from "@/lib/turnMachine/messages";
import type { ContextItem } from "@/lib/turnMachine/contract";
import { CHAT_SAMPLING } from "@/lib/llm";
import type { TurnSignal } from "@maipai/spec/gen/ts/turn-signal.js";

const URL_BASE = (process.env.MAIPAI_STACK_URL ?? "http://127.0.0.1:8770").replace(/\/$/, "");
const arg = (name: string, fallback: string) => { const at = process.argv.indexOf(name); return at < 0 ? fallback : (process.argv[at + 1] ?? fallback); };
const RUNS = Number(arg("--runs", "3"));
const COMPANION = arg("--companion", "rivet");
const VARIANTS = (arg("--variants", "base,voice,voice_memory")).split(",");

type Scenario = { id: string; text: string; act: TurnSignal["primary_act"]; window?: Array<["user" | "assistant", string]>; memory?: string[]; expect?: RegExp };
const SLUSH: Array<["user" | "assistant", string]> = [
  ["user", "I'm making a slushy for later."], ["assistant", "Ooh, slushy time! What flavor are you going for?"],
  ["user", "Blue raspberry, the good stuff."], ["assistant", "Blue raspberry is a classic. Brain freeze incoming!"],
  ["user", "Ha, yeah. Anyway, what's the weather like?"], ["assistant", "It's 64 and cloudy right now."],
  ["user", "Cool. How tall is the Eiffel Tower?"], ["assistant", "About 330 meters, roughly 1,083 feet."],
  ["user", "Nice. What time is it?"], ["assistant", "It's 3:27 PM."],
];
const SCENARIOS: Scenario[] = [
  { id: "cookies", text: "I just baked cookies.", act: "inform" },
  { id: "puppy", text: "I got a new puppy today.", act: "inform" },
  { id: "homework", text: "I finished my homework.", act: "inform" },
  { id: "beach", text: "We're going to the beach this weekend.", act: "inform" },
  { id: "bored", text: "I'm bored.", act: "inform" },
  { id: "hello", text: "Hey there!", act: "greeting" },
  { id: "capital", text: "What's the capital of France?", act: "question" },
  { id: "joke", text: "Tell me a joke.", act: "directive" },
  { id: "wife", text: "Say hello to my wife.", act: "directive", window: SLUSH, memory: ["Jesse said earlier today that he is making a slushy."], expect: /slush/i },
  { id: "wife2", text: "My wife just walked in.", act: "inform", window: SLUSH, memory: ["Jesse said earlier today that he is making a slushy."], expect: /slush/i },
];

/** The line the model reads last, per variant. "base" is production. */
const PLAN_ADD = "Stay in your own voice: start with a quick happy reaction, and if something you remember about them or they said earlier fits, tie it in playfully.";
function planLine(variant: string, base: string): string {
  if (variant === "base") return base;
  const voice = "Answer in your own voice: warm, upbeat and a little silly. Open with a quick reaction to what they said, in one or two short sentences.";
  if (variant === "voice") return `${voice}`;
  if (variant === "behavior") return base;
  if (variant === "behavior_plan") return `${base} ${PLAN_ADD}`;
  if (variant === "voice_memory") return `${voice} If something you remember about them or something they said earlier fits, tie it in playfully.`;
  return base;
}

const item = (id: string, text: string, source: ContextItem["source"]): ContextItem => ({ id, text, source, subjects: [], disclosure: "child_ok" });

async function ask(messages: unknown[]): Promise<string> {
  const res = await fetch(`${URL_BASE}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "chat", messages, stream: false, max_tokens: 160, chat_template_kwargs: { enable_thinking: false }, ...CHAT_SAMPLING }) });
  if (!res.ok) throw new Error(`stack ${res.status}`);
  const body = (await res.json()) as { choices: { message: { content?: string } }[] };
  return (body.choices[0]?.message.content ?? "").trim();
}

const OPENER = /^\W*(ooh|oh|whoa|woah|yay|wow|hehe|haha|ha|aww|hooray|hey|hi|nice|awesome|sweet|cool|yes|yum|ahh)\b/i;
const personaFor = () => adaptPersonaToBand(resolvePersona(COMPANION), "adult");
// Style lines a companion package may declare (`companion.behavior`), tried here as data in the persona, not as code.
const LIVELY_BEHAVIOR = [
  "Start with a quick, happy reaction to what they said, like Ooh, Whoa or Yay, before anything else.",
  "When something they told you earlier fits what they say now, bring it back in a playful way.",
  "Stay upbeat, friendly and a little silly; never flat or businesslike.",
];

async function main(): Promise<void> {
  const basePersona = personaFor();
  const rows: Array<{ variant: string; id: string; reply: string; opener: boolean; bangs: number; callback: boolean | null }> = [];
  for (const variant of VARIANTS) {
    const persona = variant.startsWith("behavior") ? { ...basePersona, behavior: [...(basePersona.behavior ?? []), ...LIVELY_BEHAVIOR] } : basePersona;
    for (const sc of SCENARIOS) {
      const signal = { ...fallbackSignal(sc.text, "adult", "identified_profile", sc.act), target: "self" as const };
      const plan = planFor({ signal, surface: "robot", surfaceClass: "spoken", brevity: false, evidence: { choices: 0, sources: 0, deliverable: false }, companion: { directness: "diplomatic", engagement: persona.engagement, complexity: persona.complexity }, band: "adult", deferred: false, disclosureWithheld: false });
      const items: ContextItem[] = [
        ...(sc.window ?? []).map(([role, text], i) => item(`window-${role}-${i + 1}`, text, "window")),
        ...(sc.memory ?? []).map((text, i) => item(`memory-${i + 1}`, text, "memory")),
      ];
      const base = planLineForTurnMachine(plan, signal, "spoken", persona.engagement);
      const built = contextToMessages(items, sc.text, persona, plan, signal, "spoken");
      const last = built[built.length - 1]!;
      const messages = built.slice(0, -1).concat({ ...last, content: String(last.content).replace(`How to answer this one: ${base}`, `How to answer this one: ${planLine(variant, base)}`) });
      for (let run = 0; run < RUNS; run++) {
        const reply = await ask(messages);
        rows.push({ variant, id: sc.id, reply, opener: OPENER.test(reply), bangs: (reply.match(/!/g) ?? []).length, callback: sc.expect ? sc.expect.test(reply) : null });
      }
    }
  }
  console.log(`companion ${COMPANION}, ${RUNS} runs per scenario`);
  for (const variant of VARIANTS) {
    const mine = rows.filter((r) => r.variant === variant);
    const callbacks = mine.filter((r) => r.callback !== null);
    console.log(`${variant.padEnd(14)} warm opener ${mine.filter((r) => r.opener).length}/${mine.length} | has ! ${mine.filter((r) => r.bangs > 0).length}/${mine.length} | remembered-fact follow-up ${callbacks.filter((r) => r.callback).length}/${callbacks.length}`);
  }
  for (const variant of VARIANTS) for (const id of (process.env.RV_SHOW ?? "cookies,bored,wife").split(",")) console.log(`  [${variant}] ${id}: ${rows.find((r) => r.variant === variant && r.id === id)?.reply.replace(/\n/g, " ")}`);
}
await main();
