// RESEARCH-TIER-01: a search step reads as what it did, and the summary line counts steps and sites, never queries or addresses.
import { describe, expect, test } from "bun:test";
import { timelineVerb, toolTimelineRestingLabel } from "@/apps/chat/chatToolUis";

describe("research step rows", () => {
  test("a search step says Searching, Searched or Failed; any other tool keeps Running and Ran", () => {
    expect(timelineVerb({ packageId: "websearch", state: "running" })).toBe("Searching");
    expect(timelineVerb({ packageId: "websearch", state: "ok" })).toBe("Searched");
    expect(timelineVerb({ packageId: "websearch", state: "error" })).toBe("Failed");
    expect(timelineVerb({ packageId: "weather", state: "ok" })).toBe("Ran");
  });

  test("the resting line adds the site count only when sites were read", () => {
    expect(toolTimelineRestingLabel(5, { total_time_ms: 42_000 } as never, 12)).toBe("Worked for 42 seconds, 5 steps, 12 sites");
    expect(toolTimelineRestingLabel(1, { total_time_ms: 9_000 } as never)).toBe("Worked for 9 seconds, 1 step");
    expect(toolTimelineRestingLabel(2, undefined, 1)).toBe("2 tool calls, 1 site");
  });
});
