import { describe, expect, test } from "bun:test";
import { CHAT_SAMPLING } from "@/lib/llm";
import { isRouteE1Arm, routeE1ArmConfig } from "./routeE1Arms";

describe("E1 Stack arm mapping", () => {
  test("maps the five registered arms to their model, sampling and thinking settings", () => {
    expect(routeE1ArmConfig("A0")).toEqual({
      arm: "A0", modelId: "qwen3-8b-instruct-q4-k-m", sampling: "chat", thinking: false,
      thinkingBudgetTokens: 0, samplingParams: CHAT_SAMPLING,
    });
    expect(routeE1ArmConfig("A0n")).toEqual({
      arm: "A0n", modelId: "qwen3-8b-instruct-q4-k-m", sampling: "nodrx", thinking: false,
      thinkingBudgetTokens: 0, samplingParams: { temperature: 0.7, min_p: 0.05 },
    });
    expect(routeE1ArmConfig("A2")).toMatchObject({ arm: "A2", modelId: "qwen3-vl-8b-instruct-q4-k-m", sampling: "chat", thinking: false });
    expect(routeE1ArmConfig("A2n")).toMatchObject({ arm: "A2n", modelId: "qwen3-vl-8b-instruct-q4-k-m", sampling: "nodrx", thinking: false });
    expect(routeE1ArmConfig("A1")).toMatchObject({
      arm: "A1", modelId: "qwen3-8b-instruct-q4-k-m", sampling: "nodrx", thinking: true, thinkingBudgetTokens: 512,
    });
  });

  test("accepts only E1 arm names", () => {
    for (const arm of ["A0", "A0n", "A2", "A2n", "A1"]) expect(isRouteE1Arm(arm)).toBe(true);
    expect(isRouteE1Arm("A3")).toBe(false);
  });
});
