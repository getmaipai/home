// ROUTER-BUILD-01c: who is scored and who may be rescued. Children and teens
// are never scored; spoken turns are scored but never rescued.
import { describe, expect, test } from "bun:test";
import { searchAssistEligibility, type EligibilityState } from "@/lib/searchAssist/eligible";

const NOW = new Date("2026-10-11T12:00:00Z");

function state(over: Record<string, unknown> = {}): EligibilityState {
  return {
    surface: "chat",
    actor: { id: "p1", role: "adult", birthdate: null },
    speakerEvidence: null,
    spoken: false,
    bare: false,
    crisis: false,
    budget: { tools_offered: ["websearch", "weather"] },
    planBasis: { surfaceClass: "written" },
    outcomes: [],
    ...over,
  } as unknown as EligibilityState;
}

describe("search assist eligibility", () => {
  test("an adult written turn is scored and, in rescue mode, rescuable", () => {
    expect(searchAssistEligibility(state(), "rescue", { now: NOW, modelToolCalls: 0 })).toEqual({ scored: true, rescuable: true });
  });

  test("shadow mode scores but never rescues", () => {
    expect(searchAssistEligibility(state(), "shadow", { now: NOW, modelToolCalls: 0 })).toEqual({ scored: true, rescuable: false });
  });

  test("off scores nothing", () => {
    expect(searchAssistEligibility(state(), "off", { now: NOW })).toEqual({ scored: false, rescuable: false, off_reason: "mode_off" });
  });

  test("a child or teen is never scored, whatever the mode", () => {
    for (const mode of ["shadow", "rescue"] as const) {
      expect(searchAssistEligibility(state({ actor: { id: "c", role: "child", birthdate: null } }), mode, { now: NOW, modelToolCalls: 0 })).toEqual({
        scored: false,
        rescuable: false,
        off_reason: "band_child",
      });
      expect(searchAssistEligibility(state({ actor: { id: "t", role: "teen", birthdate: null } }), mode, { now: NOW, modelToolCalls: 0 })).toEqual({
        scored: false,
        rescuable: false,
        off_reason: "band_teen",
      });
    }
  });

  test("a birthdate under 18 outranks an adult role", () => {
    const young = state({ actor: { id: "t", role: "adult", birthdate: "2012-01-01" } });
    expect(searchAssistEligibility(young, "rescue", { now: NOW, modelToolCalls: 0 }).off_reason).toBe("band_teen");
  });

  test("an unidentified robot speaker is anonymous and not scored", () => {
    const robot = state({ surface: "robot", speakerEvidence: null });
    const r = searchAssistEligibility(robot, "shadow", { now: NOW });
    expect(r.scored).toBe(false);
    expect(r.off_reason).toBe("anonymous");
  });

  test("websearch not offered means not scored", () => {
    const r = searchAssistEligibility(state({ budget: { tools_offered: ["weather"] } }), "shadow", { now: NOW });
    expect(r).toEqual({ scored: false, rescuable: false, off_reason: "no_websearch" });
  });

  test("bare, continuation, crisis and promptLimit turns are not scored", () => {
    for (const over of [{ bare: true }, { continuation: { assistantText: "x" } }, { crisis: true }, { promptLimit: "core_only" }]) {
      expect(searchAssistEligibility(state(over), "shadow", { now: NOW })).toEqual({ scored: false, rescuable: false, off_reason: "no_tools_turn" });
    }
  });

  test("a spoken turn is scored but never rescuable", () => {
    expect(searchAssistEligibility(state({ spoken: true }), "rescue", { now: NOW, modelToolCalls: 0 })).toEqual({ scored: true, rescuable: false });
    expect(searchAssistEligibility(state({ planBasis: { surfaceClass: "spoken" } }), "rescue", { now: NOW, modelToolCalls: 0 })).toEqual({
      scored: true,
      rescuable: false,
    });
    expect(searchAssistEligibility(state({ planBasis: { surfaceClass: "glance" } }), "rescue", { now: NOW, modelToolCalls: 0 }).rescuable).toBe(false);
  });

  test("rescue needs round one with no tool call from the model", () => {
    expect(searchAssistEligibility(state(), "rescue", { now: NOW, modelToolCalls: 1 }).rescuable).toBe(false);
    expect(searchAssistEligibility(state(), "rescue", { now: NOW }).rescuable).toBe(false);
    expect(searchAssistEligibility(state({ outcomes: [{}] }), "rescue", { now: NOW, modelToolCalls: 0 }).rescuable).toBe(false);
  });

  test("an owner and an admin count as adults", () => {
    for (const role of ["owner", "admin"]) {
      expect(searchAssistEligibility(state({ actor: { id: "a", role, birthdate: null } }), "shadow", { now: NOW }).scored).toBe(true);
    }
  });
});
