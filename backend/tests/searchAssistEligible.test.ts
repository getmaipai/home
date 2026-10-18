// ROUTER-BUILD-01c: who is scored and who may be rescued. A child or teen is scored only with a minor context (01i);
// spoken turns are scored but never rescued.
import { describe, expect, test } from "bun:test";
import { searchAssistEligibility, cappedSearchAssistMode, MINOR_RESCUE_ENABLED, type EligibilityState } from "@/lib/searchAssist/eligible";

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

  test("a child or teen with no minor context fails closed and is not scored", () => {
    for (const mode of ["shadow", "rescue"] as const) {
      for (const role of ["child", "teen"]) {
        expect(searchAssistEligibility(state({ actor: { id: "c", role, birthdate: null } }), mode, { now: NOW, modelToolCalls: 0 })).toEqual({
          scored: false,
          rescuable: false,
          off_reason: "gate_not_allow",
        });
      }
    }
  });

  test("a minor is scored only with the gate allowing, the web on and a recall vector, and named when one is missing", () => {
    const child = state({ actor: { id: "c", role: "child", birthdate: null } });
    const ok = { gateAllows: true, webOn: true, recallVector: true };
    expect(searchAssistEligibility(child, "shadow", { now: NOW, minor: ok })).toEqual({ scored: true, rescuable: false });
    expect(searchAssistEligibility(child, "shadow", { now: NOW, minor: { ...ok, gateAllows: false } }).off_reason).toBe("gate_not_allow");
    expect(searchAssistEligibility(child, "shadow", { now: NOW, minor: { ...ok, webOn: false } }).off_reason).toBe("web_off_for_mode");
    expect(searchAssistEligibility(child, "shadow", { now: NOW, minor: { ...ok, recallVector: false } }).off_reason).toBe("no_recall_vector");
  });

  test("no minor turn is rescuable in any mode, surface, round or context while the constant is false", () => {
    expect(MINOR_RESCUE_ENABLED).toBe(false);
    for (const role of ["child", "teen"]) {
      for (const mode of ["off", "shadow", "rescue"] as const) {
        for (const spoken of [false, true]) {
          for (const surfaceClass of ["written", "spoken"]) {
            for (const modelToolCalls of [undefined, 0, 1]) {
              for (const gateAllows of [false, true]) {
                for (const webOn of [false, true]) {
                  for (const recallVector of [false, true]) {
                    const r = searchAssistEligibility(state({ actor: { id: "m", role, birthdate: null }, spoken, planBasis: { surfaceClass } }), mode, { now: NOW, modelToolCalls, minor: { gateAllows, webOn, recallVector } });
                    expect(r.rescuable).toBe(false);
                  }
                }
              }
            }
          }
        }
      }
    }
    expect(cappedSearchAssistMode("child", "rescue")).toBe("shadow");
    expect(cappedSearchAssistMode("teen", "rescue")).toBe("shadow");
    expect(cappedSearchAssistMode("adult", "rescue")).toBe("rescue");
  });

  test("a birthdate under 18 does not change an adult role", () => {
    const young = state({ actor: { id: "t", role: "adult", birthdate: "2012-01-01" } });
    expect(searchAssistEligibility(young, "rescue", { now: NOW, modelToolCalls: 0 })).toEqual(searchAssistEligibility(state(), "rescue", { now: NOW, modelToolCalls: 0 }));
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
