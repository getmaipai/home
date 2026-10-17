// STATUS-PHRASES-02 (live, 2026-10-17): while a weather, timer, math or
// remember call ran, the chat showed a "searching" phrase ("Running a
// search…", "Checking the web…"). Only the web search is a search.
import { describe, expect, test } from "bun:test";
import { toolStatusMoment } from "@/lib/turnMachine/nodes/tool";

describe("toolStatusMoment", () => {
  test("the web search waits on a searching phrase", () => {
    expect(toolStatusMoment("websearch")).toBe("searching");
  });
  test("every other tool waits on a checking phrase, never a search one", () => {
    for (const tool of ["weather", "timer", "math", "remember", "remind", "convert", "almanac-date", "show_images"]) {
      expect(toolStatusMoment(tool)).toBe("checking");
    }
  });
});
