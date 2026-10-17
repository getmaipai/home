// MINOR-CEILING-01 (live, 2026-10-17): on Muse Glimmer 30B (thinking_mode
// "always": the template reasons on every turn and ignores enable_thinking),
// a child's "what's the weather?" and a teen's question came back EMPTY: the
// 96-token ceiling for a 40-word reply was spent entirely on reasoning the
// client drops for a minor, and no text was ever produced. The ceiling sent
// to such an engine reserves the reasoning allowance on top of the visible
// cap; the words the person may see do not grow (rule 0).
import { describe, expect, test } from "bun:test";
import { replyMaxTokensFor } from "@/lib/turnMachine/nodes/model";
import { visibleReplyMaxTokens } from "@/lib/turnShared";
import type { TurnState } from "@/lib/turnMachine/contract";

const budget = { reply_ceiling_tokens: 1536, thinking_budget_tokens: 0, thinking_budget_tokens_toggled: 512 } as TurnState["budget"];
type CeilingState = Pick<TurnState, "planBasis" | "plan" | "budget" | "modelId" | "engineModelId">;
function stateFor(ageBand: "child" | "teen" | "adult", modelId: string, viaEngine = false): CeilingState {
  return {
    planBasis: { surfaceClass: "written", brevity: false } as TurnState["planBasis"],
    plan: { age_band: ageBand, max_words: 40 } as TurnState["plan"],
    budget,
    // The person picked no model (the live case): the running model comes from the Stack read.
    ...(viaEngine ? { engineModelId: modelId } : { modelId }),
  } as CeilingState;
}

const ALWAYS = "muse-glimmer-30b-q4-k-xl";
const SWITCHABLE = "qwen3-8b-instruct-q4-k-m";

describe("replyMaxTokensFor on a model that reasons on every turn", () => {
  test("a child's turn with thinking off still reserves the reasoning allowance", () => {
    expect(replyMaxTokensFor(stateFor("child", ALWAYS), false)).toBe(visibleReplyMaxTokens(40, true));
    expect(replyMaxTokensFor(stateFor("child", ALWAYS), false)).toBeGreaterThan(visibleReplyMaxTokens(40, false));
  });
  test("a teen's turn too", () => {
    expect(replyMaxTokensFor(stateFor("teen", ALWAYS), false)).toBe(visibleReplyMaxTokens(40, true));
  });
  test("the running model the Stack reports counts when the person picked none (the live case)", () => {
    expect(replyMaxTokensFor(stateFor("child", ALWAYS, true), false)).toBe(visibleReplyMaxTokens(40, true));
    expect(replyMaxTokensFor(stateFor("child", SWITCHABLE, true), false)).toBe(visibleReplyMaxTokens(40, false));
  });
  test("a switchable model with thinking off keeps the bare visible ceiling", () => {
    expect(replyMaxTokensFor(stateFor("child", SWITCHABLE), false)).toBe(visibleReplyMaxTokens(40, false));
  });
  test("an adult's written turn is unchanged: the ceiling plus the toggled budget only when thinking", () => {
    expect(replyMaxTokensFor(stateFor("adult", ALWAYS), false)).toBe(1536);
    expect(replyMaxTokensFor(stateFor("adult", ALWAYS), true)).toBe(1536 + 512);
  });
});
