// MINOR-SEARCH-01i: no child or teen turn can reach the rescue branch in
// nodes/model.ts. searchAssistMayHold is the only gate in front of it
// (attempt.hold === "rescue"), so it must be false for a minor even when the
// turn's own stored record claims an eligible, over-threshold rescue.
import { describe, expect, test } from "bun:test";
import { searchAssistMayHold } from "@/lib/turnMachine/nodes/model";

const tools = [{ id: "websearch" }] as never;

function turn(role: string, birthdate: string | null = null, surface = "chat") {
  return {
    surface,
    actor: { id: "p", role, birthdate },
    speakerEvidence: null,
    spoken: false,
    bare: false,
    crisis: false,
    budget: { tools_offered: ["websearch"] },
    planBasis: { surfaceClass: "written" },
    outcomes: [],
    searchAssist: { mode: "rescue", eligible: true, bucket: "over", p_rounded: 0.99, action: "none" },
  } as never;
}

describe("the rescue branch in model.ts", () => {
  test("an adult written turn the assist is sure about may hold", () => {
    expect(searchAssistMayHold(turn("adult"), tools)).toBe(true);
  });

  test("no minor turn may hold, whatever its stored search assist record says", () => {
    for (const state of [turn("child"), turn("teen"), turn("adult", "2012-01-01"), turn("adult", "2016-05-05")]) {
      expect(searchAssistMayHold(state, tools)).toBe(false);
    }
  });
});
