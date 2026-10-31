import { describe, expect, test, afterEach } from "bun:test";
import { __setPromptClockForBench } from "@/lib/benchSampling";
import { speechTextFor } from "@/lib/turnShared";

// NAT-02: spoken times read against the household clock.
afterEach(() => __setPromptClockForBench(null));

describe("speechTextFor with the household clock", () => {
  test("a time later today drops its part of day", () => {
    __setPromptClockForBench(() => new Date(2026, 9, 28, 15, 0));
    const spoken = speechTextFor("phone", "Dinner is at 4:00 pm.", undefined);
    expect(spoken).toContain("four o'clock");
    expect(spoken).not.toContain("afternoon");
  });

  test("a time on another day keeps its part of day", () => {
    __setPromptClockForBench(() => new Date(2026, 9, 28, 21, 0));
    const spoken = speechTextFor("phone", "The alarm is at 6:00 am.", undefined);
    expect(spoken).toContain("morning");
  });

  test("a formal clock_style keeps the part of day, plain and loose drop it (NAT-06)", () => {
    __setPromptClockForBench(() => new Date(2026, 9, 28, 15, 0));
    expect(speechTextFor("phone", "Dinner is at 4:00 pm.", undefined, "formal")).toContain("P M");
    expect(speechTextFor("phone", "Dinner is at 4:00 pm.", undefined, "plain")).toContain("four o'clock");
    expect(speechTextFor("phone", "Dinner is at 4:00 pm.", undefined, "loose")).toContain("four o'clock");
  });

  test("emoji are removed from spoken text", () => {
    expect(speechTextFor("phone", "Hello 😊!", undefined)).not.toContain("😊");
  });
});
