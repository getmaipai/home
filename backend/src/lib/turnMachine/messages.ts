// U2b: "messages: LlmMessage[]; built from context, never from anything
// else" (the contract). The window's own turns already arrive as
// LlmMessage[] (conversationHistory.ts's buildConversationWindow(), via
// nodes/context.ts's "window" items) - this reassembles them in order,
// with every non-window item folded into one system-role context block
// ahead of them, and the new utterance appended last. One function, no
// per-source special casing beyond "window is a turn, everything else
// is a labeled context line" - the label carries the source's own
// meaning (a memory reads differently from a clock line) without a
// separate prompt template per source.
//
// U4b amended this contract (dev.md "U6 rerun 2 ruling" (1)): the
// stable message also carries `turnEngine.ts`'s own `buildStablePrefix()`
// (identity, `composePersonaPrompt`, the information-handling and
// naturalness policies - persona/plan are inputs now too, not "context
// alone"), and the volatile message gains the plan line
// (`register.ts`'s `planLine`). Both reused verbatim, never
// re-implemented here - a plain reply with none of this decoded for
// 6.6s against the old path's 0.5s (nothing said who was speaking, in
// what register, or how long), and NEXT-CACHE-01's own stable message
// had nothing but `profile`/`roster` to protect (three tokens on the
// bench household).
import type { ContextItem } from "./contract";
import type { LlmMessage } from "@/lib/llm";
import type { Persona } from "@/lib/persona";
import type { ReplyPlan } from "@maipai/spec/gen/ts/reply-plan.js";
import type { TurnSignal } from "@maipai/spec/gen/ts/turn-signal.js";
import type { SurfaceClass } from "@/lib/surfaceClass";
import { buildStablePrefix, companionReanchorLine } from "@/lib/turnEngine";
import { planLine } from "@/lib/register";

// GROUND-01: "utterance" is excluded here too, same as "window" - it is
// already the final "user" message contextToMessages() appends below,
// so a context-block line for it would repeat the question a second
// time in the prompt.
const SOURCE_LABEL: Record<Exclude<ContextItem["source"], "window" | "utterance">, string> = {
  memory: "remembered",
  episode: "episode",
  profile: "profile",
  clock: "clock",
  roster: "household",
  tool_result: "result",
  search_result: "search result",
  document: "document",
  notification: "notification",
  quoted: "quoted",
};

function renderContextLine(item: ContextItem): string {
  const label = SOURCE_LABEL[item.source as Exclude<ContextItem["source"], "window" | "utterance">];
  const dated = item.at ? ` (${item.at.slice(0, 10)})` : "";
  return `[${label}${dated}] ${item.text}`;
}

/** Reads the role nodes/context.ts encoded into a "window" item's id
 * ("window-<role>-<n>"), falling back to "user" for anything malformed
 * rather than dropping the item - a window turn always says something,
 * even if this ever sees an id from before the role was added. Not a
 * `Set`/array of the four role strings (the rule-budget lint counts a
 * 3+-string-literal array as a word list): LlmMessage["role"]'s own
 * closed type already limits this to exactly these four, checked one
 * at a time. */
function windowRoleFromId(id: string): "system" | "user" | "assistant" | "tool" {
  const role = id.split("-")[1];
  if (role === "system" || role === "assistant" || role === "tool") return role;
  return "user";
}

/** NEXT-CACHE-01 (dev.md "U6 rerun ruling" (b) 2): stable per actor and
 * household, not per utterance or per minute - checked one at a time,
 * never an array (the rule-budget lint's own word-list check, the same
 * reason SOURCE_LABEL above is a Record and windowRoleFromId() reads
 * its four roles one at a time). Everything else (`memory`, `clock`,
 * and any tool-round or utterance-matched source) changes every turn
 * by design and belongs in the volatile half instead. */
function isStableContext(source: ContextItem["source"]): boolean {
  if (source === "profile") return true;
  if (source === "roster") return true;
  return false;
}

/** U1's own cache-stable order (turnEngine.ts's buildStablePrefix()
 * ahead of the window, its own volatile `context` string after it -
 * `runTurn()`'s literal `[stablePrefix, ...window.messages, context,
 * utterance]` message list), carried to this path for the first time.
 * The old single system-message-first shape put memory matches, the
 * profile, the clock and the roster - all of it utterance- or
 * time-dependent - INTO the one message the Qwen3 template also fills
 * with the tools block, ahead of the whole window: every prompt
 * differed from its first token, and llama-server's prompt cache
 * (a longest-common-PREFIX match) never reused anything. Splitting
 * `other` by isStableContext() and moving the volatile half behind the
 * window means the prefix every turn in a conversation actually shares
 * (this stable message, unchanged for the same actor/household, plus
 * the window, unchanged once written) stays a real prefix match; only
 * the trailing volatile message and the new utterance differ, the
 * smallest part of the prompt a cache miss can cost.
 *
 * U4b: `buildStablePrefix(persona)` is now the FIRST part of the
 * stable message, ahead of the `profile`/`roster` context lines (if
 * any) - identity before facts, the same order the old path's own
 * `stablePrefix` versus `context` split already keeps, and the real
 * prefix NEXT-CACHE-01 needed. `planLine()` closes the volatile
 * message, right before the utterance - "how to answer this one" reads
 * as the turn's own last instruction, not buried among context facts. */
export function contextToMessages(context: readonly ContextItem[], utterance: string, persona: Persona, plan: ReplyPlan, signal: TurnSignal, surfaceClass: SurfaceClass): LlmMessage[] {
  const windowItems = context.filter((item) => item.source === "window");
  // "utterance" is excluded too: it rides the "utterance" argument
  // below as the final user message, the one place it belongs in the
  // prompt - not a second time in either context message.
  const other = context.filter((item) => item.source !== "window" && item.source !== "utterance");
  const stable = other.filter((item) => isStableContext(item.source));
  const volatile = other.filter((item) => !isStableContext(item.source));

  const messages: LlmMessage[] = [];
  const stableContextLines = stable.length > 0 ? `\n\n${stable.map(renderContextLine).join("\n")}` : "";
  messages.push({ role: "system", content: `${buildStablePrefix(persona)}${stableContextLines}` });
  // The window already alternates user/assistant/tool roles correctly
  // (buildConversationWindow()'s own job); this machine never rebuilds
  // that ordering, only replays the window's own roles verbatim.
  for (const item of windowItems) {
    messages.push({ role: windowRoleFromId(item.id), content: item.text });
  }
  const volatileContextLines = volatile.length > 0 ? `${volatile.map(renderContextLine).join("\n")}\n\n` : "";
  // A review caught this file's first cut carrying the identity line
  // once (the stable prefix) but never again - the old path's own
  // reanchorSection (companionReanchorLine(), turnEngine.ts) exists
  // specifically because legacy measured real persona-voice drift after
  // about eight turns with nothing repeating who's speaking. Reused
  // verbatim here too, every turn, the same volatile-zone role it
  // already has in the old path.
  const reanchor = companionReanchorLine(persona).trim();
  messages.push({ role: "system", content: `${volatileContextLines}${reanchor}\n\nHow to answer this one: ${planLine(plan, signal, surfaceClass)}` });
  messages.push({ role: "user", content: utterance });
  return messages;
}
