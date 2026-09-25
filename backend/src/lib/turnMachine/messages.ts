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
import { promptSurfaceClassFor } from "@/lib/surfaceClass";
import { buildStablePrefix } from "@/lib/turnEngine";
import { planLineForTurnMachine } from "@/lib/register";
import { MEMORY_SECTION_HEADER, MEMORY_TRUST_REMINDER, NOTHING_STORED_LINE } from "@/lib/memoryFraming";

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

/** The one place that renders a real memory match's own header, bullets
 * and trust line - shared by both classes below, so a future edit to
 * this shape (the header wording, a bullet's own format, the trust
 * line) can never land in one class and not the other by hand. */
function renderMemoryMatches(memoryItems: readonly ContextItem[]): string {
  return `${MEMORY_SECTION_HEADER}\n${memoryItems.map(renderContextLine).join("\n")}\n${MEMORY_TRUST_REMINDER}`;
}

/** CONTEXT-RECALL-01 (dev.md "The owner's three live turns", (2)): the
 * same header, trust line and "nothing matched" line the old path's
 * own memorySection used (turnEngine.ts), shared via memoryFraming.ts -
 * a recalled row reads as background evidence under this header, never
 * as the turn's own subject, which is what let a fresh conversation's
 * small talk get answered as if a remembered lookup were the question.
 * The header and trust line always wrap the memory items, even when
 * there are none (NOTHING_STORED_LINE says so plainly, #93's own
 * reasoning: an empty recall is said, not left blank, so the model
 * answers a general question from what it knows instead of reaching
 * for the recall tool to check what context already checked). Spoken
 * class only, unchanged - the written class's own twin is below. */
function renderMemoryBlock(memoryItems: readonly ContextItem[]): string {
  if (memoryItems.length === 0) return `${MEMORY_SECTION_HEADER}\n${NOTHING_STORED_LINE}\n${MEMORY_TRUST_REMINDER}`;
  return renderMemoryMatches(memoryItems);
}

/** The written-adult class's own twin (dev.md "The written prompt on
 * tier 1, decided"): NOTHING_STORED_LINE and its framing are the
 * "still answer, don't decline" INSTRUCTION half of the shared block -
 * real on the spoken class (every measured shape with an instruction
 * sentence in the written prompt cost length), but a written-adult
 * turn with no memory match gets no memory section at all rather than
 * a sentence-shaped framing of an absence. A real match is content
 * (the header, the bullet, the trust line, unchanged - renderMemoryMatches()
 * above, never a second copy of that template), so it still renders in
 * full. */
function renderMemoryBlockWritten(memoryItems: readonly ContextItem[]): string | null {
  return memoryItems.length > 0 ? renderMemoryMatches(memoryItems) : null;
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
  // CONTEXT-RECALL-01: memory splits out from the rest of the volatile
  // items so it can be framed separately, below.
  const memoryItems = volatile.filter((item) => item.source === "memory");
  const restVolatile = volatile.filter((item) => item.source !== "memory");

  // The reply floor is a written-class, adult-only backstop
  // (isWrittenAdultTurn, surfaceClass.ts): a review caught this file's
  // first cut passing the raw surfaceClass straight to buildStablePrefix
  // and planLine, so a child's chat turn got the written persona's "never
  // cut a genuinely complete answer short" wording and planLine's "as
  // long as it needs" length clause while nodes/model.ts's max_tokens
  // still fell through to the small, age-clamped word budget. Collapsed
  // to "spoken" for any turn that isn't a written, adult one, so the
  // prompt never promises a length the token budget can't back.
  const promptSurfaceClass: SurfaceClass = promptSurfaceClassFor(surfaceClass, plan.age_band);

  const messages: LlmMessage[] = [];
  const stableContextLines = stable.length > 0 ? `\n\n${stable.map(renderContextLine).join("\n")}` : "";
  // PREFIX-ROLE-01 (dev.md "PREFIX-ROLE-01: moving the stable message's
  // role alone does not clear the bar either"): tried and reverted -
  // moving this message's role to "user" for a written-adult turn
  // measured no effect (0.15x/0.16x, no better than the system-role
  // shape it replaced, worse on one question). The stable message stays
  // role "system" on every surface class; the coordinator's own
  // follow-up ruling named the volatile message's own plan line as the
  // real suspect instead - see below.
  messages.push({ role: "system", content: `${buildStablePrefix(persona, promptSurfaceClass)}${stableContextLines}` });
  // The window already alternates user/assistant/tool roles correctly
  // (buildConversationWindow()'s own job); this machine never rebuilds
  // that ordering, only replays the window's own roles verbatim.
  for (const item of windowItems) {
    messages.push({ role: windowRoleFromId(item.id), content: item.text });
  }
  if (promptSurfaceClass === "written") {
    // The written prompt on tier 1, decided (dev.md, the coordinator's
    // own design record): no reanchor line, no plan line - arm 1 (the
    // plan line dropped) measured 0 of 5 "you" misreads on the
    // benchmarking question where arm 2 (the reanchor folded ahead of
    // the question) reproduced it, and both are instruction, never
    // content. The memory block itself only renders on a real match -
    // NOTHING_STORED_LINE's own framing is the instruction half of that
    // shared block (renderMemoryBlockWritten's own comment). Content-only
    // otherwise (clock, a tool round's result), and when nothing
    // remains at all, no second system message - never an empty or
    // instruction-only one.
    const writtenVolatileParts = [renderMemoryBlockWritten(memoryItems), restVolatile.length > 0 ? restVolatile.map(renderContextLine).join("\n") : null].filter((part): part is string => part !== null);
    if (writtenVolatileParts.length > 0) {
      messages.push({ role: "system", content: writtenVolatileParts.join("\n\n") });
    }
    messages.push({ role: "user", content: utterance });
    return messages;
  }

  // CONTEXT-RECALL-01: the memory block (renderMemoryBlock, always
  // present - the header and trust line wrap even a "nothing matched"
  // line) leads the volatile message; every other volatile source
  // (clock, a tool round's own result) follows as a plain labeled
  // line, unchanged from before this item.
  const otherVolatileLines = restVolatile.length > 0 ? `${restVolatile.map(renderContextLine).join("\n")}\n\n` : "";
  // TRUEUP-01 (docs/plans/chat-trueup-2026-09-23.md): the reanchor line
  // (companionReanchorLine(), "Remember: you are X.") leaves the spoken
  // class too - no design ever put it here (the old path's own
  // reanchorSection is a Session C plan step, not a design, per the
  // verdict table), and it is the confirmed cause of the "you" misread
  // (dev.md, PREFIX-ROLE-01's arm 2: arm 1, the plan line alone dropped,
  // measured 0 of 5 misreads where arm 2, the reanchor folded ahead of
  // the question, reproduced it). The written class dropped it earlier
  // in this function, before this record; drift over ten spoken turns
  // becomes a replay row (TRUEUP-01's own tests), never a line back in
  // the prompt.
  messages.push({ role: "system", content: `${renderMemoryBlock(memoryItems)}\n\n${otherVolatileLines}How to answer this one: ${planLineForTurnMachine(plan, signal, promptSurfaceClass)}` });
  messages.push({ role: "user", content: utterance });
  return messages;
}
