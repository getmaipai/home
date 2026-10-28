import { beforeEach, describe, expect, it } from "bun:test";
import { ECHO_WINDOW_MS, repeatNotes, resetEchoRecords, type EchoContext } from "@/lib/echo";
import { toolResultContent } from "@/lib/composer";
import type { ToolExecutionOutcome } from "@/lib/turnContext";

function outcome(data: Record<string, unknown>, callId = "c1", args: Record<string, unknown> = { place: "home" }): ToolExecutionOutcome {
  return { callId, packageId: "weather", status: "succeeded", args, result: { data } } as unknown as ToolExecutionOutcome;
}
function ctx(over: Partial<EchoContext> = {}): EchoContext {
  return { conversationId: "conv1", turnId: "t1", surfaceClass: "spoken", ageBand: "adult", safetyFlagged: false, nowMs: 1_000_000, ...over };
}

beforeEach(() => resetEchoRecords());

describe("repeatNotes (NAT-05)", () => {
  it("has no note the first time", () => {
    expect(repeatNotes([outcome({ t: 70 })], ctx()).size).toBe(0);
  });
  it("marks an unchanged repeat inside the window and allows shortening on spoken", () => {
    repeatNotes([outcome({ t: 70 })], ctx());
    const n = repeatNotes([outcome({ t: 70 })], ctx({ turnId: "t2", nowMs: 1_030_000 })).get("c1");
    expect(n?.evidence).toBe("unchanged");
    expect(n?.since_seconds).toBe(30);
    expect(n?.note).toContain("short");
  });
  it("requires naming a change when the evidence differs", () => {
    repeatNotes([outcome({ t: 70 })], ctx());
    const n = repeatNotes([outcome({ t: 64 })], ctx({ turnId: "t2", nowMs: 1_030_000 })).get("c1");
    expect(n?.evidence).toBe("changed");
    expect(n?.note).toContain("what changed");
  });
  it("never suggests shortening on adult written chat, but does on a teen's written chat", () => {
    repeatNotes([outcome({ t: 70 })], ctx({ surfaceClass: "written" }));
    const adult = repeatNotes([outcome({ t: 70 })], ctx({ surfaceClass: "written", turnId: "t2", nowMs: 1_030_000 })).get("c1");
    expect(adult?.note).not.toContain("shorter");
    expect(adult?.note).toContain("as completely");
    resetEchoRecords();
    repeatNotes([outcome({ t: 70 })], ctx({ surfaceClass: "written", ageBand: "teen" }));
    const teen = repeatNotes([outcome({ t: 70 })], ctx({ surfaceClass: "written", ageBand: "teen", turnId: "t2", nowMs: 1_030_000 })).get("c1");
    expect(teen?.note).toContain("short");
  });
  it("ignores a repeat outside the window, another subject, another conversation and a flagged turn", () => {
    repeatNotes([outcome({ t: 70 })], ctx());
    expect(repeatNotes([outcome({ t: 70 })], ctx({ turnId: "t2", nowMs: 1_000_000 + ECHO_WINDOW_MS + 1 })).size).toBe(0);
    expect(repeatNotes([outcome({ t: 70 }, "c1", { place: "work" })], ctx({ turnId: "t3", nowMs: 1_010_000 })).size).toBe(0);
    expect(repeatNotes([outcome({ t: 70 })], ctx({ turnId: "t4", conversationId: "conv2", nowMs: 1_010_000 })).size).toBe(0);
    expect(repeatNotes([outcome({ t: 70 })], ctx({ turnId: "t5", nowMs: 1_010_000, safetyFlagged: true })).size).toBe(0);
  });
  it("gives a later model round of the same turn the same note, not a self-repeat", () => {
    expect(repeatNotes([outcome({ t: 70 })], ctx()).size).toBe(0);
    expect(repeatNotes([outcome({ t: 70 })], ctx({ nowMs: 1_002_000 })).size).toBe(0);
    const first = repeatNotes([outcome({ t: 70 })], ctx({ turnId: "t2", nowMs: 1_030_000 }));
    const again = repeatNotes([outcome({ t: 70 })], ctx({ turnId: "t2", nowMs: 1_031_000 }));
    expect(again.get("c1")).toEqual(first.get("c1"));
  });
  it("puts the note in the evidence JSON", () => {
    repeatNotes([outcome({ t: 70 })], ctx());
    const repeats = repeatNotes([outcome({ t: 70 })], ctx({ turnId: "t2", nowMs: 1_030_000 }));
    const json = JSON.parse(toolResultContent(outcome({ t: 70 }), undefined, true, { ageBand: "adult", safetyFlagged: false, repeats }));
    expect(json.repeat.evidence).toBe("unchanged");
  });
});

describe("hedging dial hint (NAT-06)", () => {
  const weatherWithChance = { callId: "c9", packageId: "weather", status: "succeeded", args: {}, result: { data: { precipitation_chance: 40 } } } as unknown as ToolExecutionOutcome;
  const parse = (hedging?: "low" | "medium" | "high") => JSON.parse(toolResultContent(weatherWithChance, undefined, true, { ageBand: "adult", safetyFlagged: false, hedging }));
  it("adds the hint only for low or high, beside a band below sure", () => {
    expect(parse("high").hedging).toBe("high");
    expect(parse("low").hedging).toBe("low");
    expect(parse("medium").hedging).toBeUndefined();
    expect(parse(undefined).hedging).toBeUndefined();
  });
});
