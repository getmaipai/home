// VOICE-REPLY-01 (live, 2026-10-17): in conversation mode the person heard only
// "Give me a second." The Stack now serves Muse Glimmer 30B as its MLX build
// ("muse-glimmer-30b-mlx-4bit", ENGINE-MLX-01), an id Home had no record for. The
// running model fell to the unmeasured defaults: thinking "switchable", so a spoken
// turn's 128-token ceiling was spent on reasoning the client drops, the engine
// stopped on `length` with no text, the retry used the same ceiling, and the reply
// was empty. Measured on the live Stack: max_tokens 128, predicted 128, stop_reason
// length, twice. The build now reads the model's record, the budget is the running
// model's, and a model that proves otherwise is learned from its own `length` stops.
import { afterEach, describe, expect, test } from "bun:test";
import { replyMaxTokensFor, rememberCeilingSpentInvisibly, __resetLearnedCeilingsForTests } from "@/lib/turnMachine/nodes/model";
import { resolveTurnBudgetAndEngineModel } from "@/lib/turnMachine/budget";
import { chatCatalogEntry, thinkingModeFor } from "@/lib/modelCatalog";
import { visibleReplyMaxTokens } from "@/lib/turnShared";
import { __setRoleHealthForTests } from "@/lib/roleHealth";
import type { TurnState } from "@/lib/turnMachine/contract";

const MLX = "muse-glimmer-30b-mlx-4bit";
const GGUF = "muse-glimmer-30b-q4-k-xl";
const budget = { reply_ceiling_tokens: 1536, thinking_budget_tokens: 0, thinking_budget_tokens_toggled: 512 } as TurnState["budget"];
type CeilingState = Pick<TurnState, "planBasis" | "plan" | "budget" | "modelId" | "engineModelId">;
function spoken(ageBand: "child" | "teen" | "adult", engineModelId: string): CeilingState {
  return { planBasis: { surfaceClass: "spoken", brevity: false } as TurnState["planBasis"], plan: { age_band: ageBand, max_words: 40 } as TurnState["plan"], budget, engineModelId } as CeilingState;
}

afterEach(() => { __resetLearnedCeilingsForTests(); __setRoleHealthForTests({}); });

describe("the MLX build of Glimmer reads Glimmer's record", () => {
  test("the build resolves to the model's record and reasons on every turn", () => {
    expect(chatCatalogEntry(MLX)?.id).toBe(GGUF);
    expect(thinkingModeFor(MLX)).toBe("always");
    expect(chatCatalogEntry("no-such-model")).toBeUndefined();
  });
  test("an adult's spoken turn reserves the reasoning allowance (the live failure: 128 tokens, all reasoning)", () => {
    const ceiling = replyMaxTokensFor(spoken("adult", MLX), false);
    expect(ceiling).toBe(visibleReplyMaxTokens(40, true));
    expect(ceiling).toBeGreaterThan(visibleReplyMaxTokens(40, false) + 400);
  });
  test("the turn budget is the running model's, not the unset chat.model_id", async () => {
    __setRoleHealthForTests({ chat: { availability: "ready", reason: null, modelId: MLX, contextPerSlot: 131072, slots: 1, contextScope: "per_slot" } });
    const adult = await resolveTurnBudgetAndEngineModel(undefined, "adult");
    expect(adult.engineModelId).toBe(MLX);
    expect(adult.budget.deadlines_ms.model).toBe(chatCatalogEntry(GGUF)!.turn_budget!.deadlines_ms.model);
    const child = await resolveTurnBudgetAndEngineModel(undefined, "child");
    expect(child.budget.rounds).toBe(chatCatalogEntry(GGUF)!.turn_budget!.rounds);
  });
});

describe("a model with no record is learned from its own length stops", () => {
  const UNKNOWN = "some-future-build";
  test("before the first empty stop, the bare ceiling; after it, the reserve", () => {
    expect(replyMaxTokensFor(spoken("adult", UNKNOWN), false)).toBe(visibleReplyMaxTokens(40, false));
    rememberCeilingSpentInvisibly(UNKNOWN);
    expect(replyMaxTokensFor(spoken("adult", UNKNOWN), false)).toBe(visibleReplyMaxTokens(40, true));
  });
  test("learning one model does not change another", () => {
    rememberCeilingSpentInvisibly(UNKNOWN);
    expect(replyMaxTokensFor(spoken("adult", "qwen3-8b-instruct-q4-k-m"), false)).toBe(visibleReplyMaxTokens(40, false));
  });
});
