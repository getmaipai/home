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
import type { ContextItem } from "./contract";
import type { LlmMessage } from "@/lib/llm";

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

export function contextToMessages(context: readonly ContextItem[], utterance: string): LlmMessage[] {
  const windowItems = context.filter((item) => item.source === "window");
  // "utterance" is excluded too: it rides the "utterance" argument
  // below as the final user message, the one place it belongs in the
  // prompt - not a second time in the system context block.
  const other = context.filter((item) => item.source !== "window" && item.source !== "utterance");

  const messages: LlmMessage[] = [];
  if (other.length > 0) {
    messages.push({ role: "system", content: other.map(renderContextLine).join("\n") });
  }
  // The window already alternates user/assistant/tool roles correctly
  // (buildConversationWindow()'s own job); this machine never rebuilds
  // that ordering, only replays the window's own roles verbatim.
  for (const item of windowItems) {
    messages.push({ role: windowRoleFromId(item.id), content: item.text });
  }
  messages.push({ role: "user", content: utterance });
  return messages;
}
