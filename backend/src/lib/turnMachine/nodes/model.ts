// U2c, the `model` node (turn-machine-state-record-2026-09-22.md's
// state table and "The interim rule"): one call, the fixed tool set
// from the budget, tool_choice per the interim rule, streamed so the
// wire's own `reasoning`/`delta` events (section "What every turn
// writes") come from the same call turnNext.ts forwards to the client.
//
// The interim rule (simple-turn-pipeline-2026-09-22.md point 3, folded
// with the state record's own "unless this conversation already holds
// the answer" refinement): when the turn signal reads primary_act
// "question" and target "world", and the budget's always_search is on,
// the call runs tool_choice "required" over exactly two tools - the
// search tool and, when answer_from_context_tool is also on,
// answer_from_this_conversation (one argument: the quoted line of the
// context list it answers from). The household-subject rule (a turn
// naming a family member is never sent to the web) is a context check,
// not a signal field: it looks at whether any "roster"-sourced item's
// text names a subject already in the household-subject stack this
// turn's context carries - here, simply, whether the utterance itself
// contains a roster name, the same literal check subjects.ts's own
// speakerNamedAny() already makes for this exact purpose elsewhere.
import { startCompleteStream } from "@/lib/llm";
import type { LlmMessage, ToolSpec, ToolCall } from "@/lib/llm";
import { loadManifestOnly } from "@/lib/plugins";
import { speakerNamedAny } from "@/lib/subjects";
import { visibleText, extractReasoningText } from "@/lib/wellFormed";
import { contextToMessages } from "../messages";
import type { Node, TurnState } from "../contract";

export const ANSWER_FROM_CONTEXT_TOOL_ID = "answer_from_this_conversation";

const ANSWER_FROM_CONTEXT_TOOL: ToolSpec = {
  id: ANSWER_FROM_CONTEXT_TOOL_ID,
  description: "Answer the question from a line already in this conversation, instead of searching the web. Only use this when the answer is genuinely already here.",
  args: {
    type: "object",
    required: ["quote"],
    properties: {
      quote: { type: "string", description: "The exact line from the conversation this answer comes from." },
    },
  },
};

export interface ModelInput {
  utterance: string;
  /** machine.ts's own round counter: `budget.model_transitions &&
   * roundsUsed < budget.rounds`, so a `rounds: 0` or
   * `model_transitions: false` budget (the robot's Pi, a model with no
   * measured record) never offers a tool on the first call either, and
   * a `rounds: 1` budget's second entry (after one tool executed) is
   * answer-only - the state table's "tool ... exits: model while
   * rounds remain; else answer" applied at the model node's own
   * boundary, since offering no tools is what makes a text answer
   * certain, never a second, separate cap checked somewhere else. */
  toolsAllowed: boolean;
  /** The interim rule's own retry guard (the state record: "a quote
   * that is not there is an ungrounded argument and the search runs
   * instead"): true only on the one re-entry machine.ts's
   * `answer_from_context_check` state makes after policy rejected an
   * ungrounded quote. Forces the search tool alone, `tool_choice`
   * "required" - never offering `answer_from_this_conversation` again,
   * which is what guarantees this retries exactly once instead of the
   * model choosing the same broken answer a second time. */
  forceSearchOnly?: boolean;
}

export type ModelOutput =
  | { kind: "text"; text: string; thinking: boolean; reasoning?: string }
  | { kind: "tool_calls"; calls: ToolCall[]; reasoning?: string }
  | { kind: "answer_from_context"; quote: string; reasoning?: string };

/** Whether the utterance is what the interim rule calls "a question
 * about the world" - the signal's own closed-set fields, no new rule. */
function isWorldQuestion(state: TurnState): boolean {
  return state.signal.primary_act === "question" && state.signal.target === "world";
}

/** The roster names this turn's own context list already carries
 * (nodes/context.ts's "roster" item), read back rather than re-fetched -
 * one source of the household's names, whichever node asks. */
function rosterNames(state: TurnState): string[] {
  return state.context.filter((c) => c.source === "roster").map((c) => c.text);
}

function householdSubjectNamed(state: TurnState): boolean {
  const roster = rosterNames(state);
  return roster.length > 0 && speakerNamedAny(state.utterance, roster);
}

function toolSpecFor(id: string): ToolSpec | null {
  if (id === ANSWER_FROM_CONTEXT_TOOL_ID) return ANSWER_FROM_CONTEXT_TOOL;
  const loaded = loadManifestOnly(id);
  if (!loaded.ok) return null;
  return { id, description: loaded.value.description, args: loaded.value.args };
}

/** ReplyPlan bounds length in words (max_words), never tokens; llm.ts's
 * max_tokens wants a token ceiling. English averages under 1.5 tokens
 * per word, so doubling max_words is a deliberately generous ceiling -
 * a plan meant to stop a rambling reply, not clip a normal one short. */
function maxTokensFor(plan: TurnState["plan"]): number | undefined {
  return typeof plan?.max_words === "number" ? Math.ceil(plan.max_words * 2) : undefined;
}

interface GenerationAttempt {
  ok: true;
  /** The person-visible portion only (wellFormed.ts's visibleText()) -
   * a code review (2026-09-22, the reasoning-gating amendment) caught
   * this field previously holding neutralizeThinkTags()'s own output:
   * that helper only defangs a literal `<think>`/`</think>` STRING (so
   * it can't be mistaken for a real tag later), it does not remove a
   * think block's CONTENT, so a thinking model's reasoning was landing
   * directly in what callers treated as the visible reply. */
  text: string;
  /** wellFormed.ts's own extractReasoningText(), on the SAME raw text
   * `text` above was derived from - undefined when the generation
   * carried no think block at all. */
  reasoning: string | undefined;
  toolCalls: ToolCall[] | undefined;
  thinking: boolean;
}
type GenerationResult = GenerationAttempt | { ok: false; code: string };

/** One real model call: builds the tools block for this attempt, runs
 * it through the streaming client (COR-7's own signal support), and
 * drains it manually so the generator's return value (the tool calls)
 * survives - `for await...of` would discard it. */
async function runOneGeneration(state: TurnState, messages: LlmMessage[], tools: ToolSpec[], tool_choice: "auto" | "required" | undefined, thinking: boolean, reason: string, signal: AbortSignal): Promise<GenerationResult> {
  const started = await startCompleteStream("chat", messages, { tools: tools.length > 0 ? tools : undefined, tool_choice, thinking, max_tokens: maxTokensFor(state.plan) }, signal);
  if (!started.ok) return { ok: false, code: started.code };

  const requestSentMs = Date.now();
  let firstDeltaMs: number | null = null;
  let raw = "";
  let toolCalls: ToolCall[] | undefined;
  try {
    for (;;) {
      const step = await started.tokens.next();
      if (step.done) {
        toolCalls = step.value;
        break;
      }
      if (firstDeltaMs === null) firstDeltaMs = Date.now() - requestSentMs;
      raw += step.value;
    }
  } catch {
    return { ok: false, code: "generation_failed" };
  }

  state.generations.push({ reason, thinking, maxTokens: maxTokensFor(state.plan) ?? null, requestSentMs: requestSentMs - state.startedAt, firstDeltaMs, stats: started.stats });
  return { ok: true, text: visibleText(raw), reasoning: extractReasoningText(raw), toolCalls, thinking };
}

export const modelNode: Node<ModelInput, ModelOutput> = async (state, input, signal) => {
  const messages: LlmMessage[] = contextToMessages(state.context, input.utterance);
  state.messages = messages;

  const interimRuleApplies = input.toolsAllowed && state.budget.always_search && isWorldQuestion(state) && !householdSubjectNamed(state);

  let tools: ToolSpec[];
  let tool_choice: "auto" | "required" | undefined;
  if (input.forceSearchOnly) {
    tools = [toolSpecFor("websearch")].filter((t): t is ToolSpec => t !== null);
    tool_choice = "required";
  } else if (!input.toolsAllowed) {
    tools = [];
    tool_choice = undefined;
  } else if (interimRuleApplies) {
    const ids = state.budget.answer_from_context_tool ? ["websearch", ANSWER_FROM_CONTEXT_TOOL_ID] : ["websearch"];
    tools = ids.map(toolSpecFor).filter((t): t is ToolSpec => t !== null);
    tool_choice = "required";
  } else {
    tools = state.budget.tools_offered
      .slice()
      .sort()
      .map(toolSpecFor)
      .filter((t): t is ToolSpec => t !== null);
  }

  const thinkingOn = state.budget.thinking_budget_tokens > 0;
  let attempt = await runOneGeneration(state, messages, tools, tool_choice, thinkingOn, interimRuleApplies ? "interim_rule" : "model", signal);
  if (!attempt.ok) return { outcome: { ok: false, code: attempt.code }, output: { kind: "text", text: "", thinking: false } };

  // State table, `model`'s own exits: "no visible text: one
  // regeneration with thinking off, then answer." A tool call always
  // counts as "visible" (it is the turn's real output); only a call
  // that came back with neither text nor a tool call retries.
  if ((!attempt.toolCalls || attempt.toolCalls.length === 0) && attempt.text.trim().length === 0 && thinkingOn) {
    attempt = await runOneGeneration(state, messages, tools, tool_choice, false, "model_retry_no_thinking", signal);
    if (!attempt.ok) return { outcome: { ok: false, code: attempt.code }, output: { kind: "text", text: "", thinking: false } };
  }

  // "Reasoning is a second output" (the owner's ruling): `context`
  // already decided whether this turn may emit one at all;
  // `state.reasoning.emit === false` means "the model node consumes
  // the spans and emits nothing" - so a withheld turn's reasoning
  // never even reaches ModelOutput, let alone the trace or the wire.
  const reasoning = state.reasoning.emit ? attempt.reasoning : undefined;

  if (attempt.toolCalls && attempt.toolCalls.length > 0) {
    const contextAnswer = attempt.toolCalls.find((c) => c.tool === ANSWER_FROM_CONTEXT_TOOL_ID);
    if (contextAnswer) {
      const quote = typeof contextAnswer.args === "object" && contextAnswer.args && "quote" in contextAnswer.args ? String((contextAnswer.args as { quote: unknown }).quote) : "";
      return { outcome: { ok: true }, output: { kind: "answer_from_context", quote, reasoning } };
    }
    return { outcome: { ok: true }, output: { kind: "tool_calls", calls: attempt.toolCalls, reasoning } };
  }

  return { outcome: { ok: true }, output: { kind: "text", text: attempt.text, thinking: attempt.thinking, reasoning } };
};
