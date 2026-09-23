// PARITY-BISECT-01's own pure stage-building logic, split from
// parity-bisect.ts (the same reason finish.ts splits off setup.ts:
// `import "./setup"` at module scope exits the process the moment it
// runs outside a bench's own environment, so a test importing
// buildStages() needs a module that never reaches that import).
import type { LlmMessage, ToolSpec, LlmCompleteOptions } from "@/lib/llm";
import type { Persona } from "@/lib/persona";
import { buildStablePrefix } from "@/lib/turnEngine";
import { contextToMessages } from "@/lib/turnMachine/messages";
import type { ReplyPlan } from "@maipai/spec/gen/ts/reply-plan.js";
import type { TurnSignal } from "@maipai/spec/gen/ts/turn-signal.js";

export const QUESTION = "how does a prompt cache make a language model faster and why does that matter";
// llama-server's own documented default (turnEngine.ts's CHAT_SAMPLING
// comment: "plain chat used to run at llama-server's own default of
// 0.8"); passed explicitly wherever a stage means "the engine's own
// defaults" - llm.ts's chatSamplingFor() only applies CHAT_SAMPLING
// when the caller leaves temperature unset, so this is the one real
// way to opt a stage out of it through the real client.
export const ENGINE_DEFAULT_TEMPERATURE = 0.8;

export const hasHeadings = (text: string): boolean => /^#{1,6}\s/m.test(text);
export const hasLists = (text: string): boolean => /^\s*[-*]\s|^\s*\d+\.\s/m.test(text);

export interface Stage {
  name: string;
  messages: LlmMessage[];
  opts: LlmCompleteOptions;
}

/** Pure: builds every stage's own request (messages + options), no
 * live call - the six components stacking toward the new path's exact
 * prompt shape, plus the two bare-call floor rows. */
export function buildStages(persona: Persona, plan: ReplyPlan, signal: TurnSignal, tools: ToolSpec[]): Stage[] {
  const stage1Messages: LlmMessage[] = [{ role: "system", content: buildStablePrefix(persona, "written") }, { role: "user", content: QUESTION }];
  const stage3Messages = contextToMessages([], QUESTION, persona, plan, signal, "written");
  const mergedSystemContent = stage3Messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const stage4Messages: LlmMessage[] = [{ role: "system", content: mergedSystemContent }, { role: "user", content: QUESTION }];

  return [
    { name: "0a-bare-thinking-on", messages: [{ role: "user", content: QUESTION }], opts: { temperature: ENGINE_DEFAULT_TEMPERATURE, thinking: true } },
    { name: "0b-bare-thinking-off", messages: [{ role: "user", content: QUESTION }], opts: { temperature: ENGINE_DEFAULT_TEMPERATURE, thinking: false } },
    { name: "1-stable-prefix", messages: stage1Messages, opts: { temperature: ENGINE_DEFAULT_TEMPERATURE, thinking: false } },
    { name: "2-plus-tools", messages: stage1Messages, opts: { temperature: ENGINE_DEFAULT_TEMPERATURE, thinking: false, tools, tool_choice: "auto" } },
    { name: "3-plus-volatile", messages: stage3Messages, opts: { temperature: ENGINE_DEFAULT_TEMPERATURE, thinking: false, tools, tool_choice: "auto" } },
    // A side comparison against stage 3's own shape (merging its two
    // system messages into one), not a further stack - stages 5 and 6
    // continue from stage 3's own two-message split, which is what the
    // real new path sends.
    { name: "4-merged-system", messages: stage4Messages, opts: { temperature: ENGINE_DEFAULT_TEMPERATURE, thinking: false, tools, tool_choice: "auto" } },
    { name: "5-chat-sampling", messages: stage3Messages, opts: { thinking: false, tools, tool_choice: "auto" } },
    { name: "6-thinking-off-confirm", messages: stage3Messages, opts: { thinking: false, tools, tool_choice: "auto" } },
  ];
}
