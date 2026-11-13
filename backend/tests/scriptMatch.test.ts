import { describe, expect, test } from "bun:test";
import { matchScript, quotedLines, scriptCaptionCues } from "@/lib/transcripts/scriptMatch";

describe("script matching", () => {
  test("extracts straight and curly quoted lines", () => {
    expect(quotedLines('Say "hello there". Then “good morning”.')).toEqual(["hello there", "good morning"]);
    expect(quotedLines("No quoted speech")).toEqual([]);
  });

  test("keeps script spelling and heard times, interpolating gaps and dropping extras", () => {
    const exact = matchScript("Hello, world!", [
      { text: "hello", start_s: 0.2, end_s: 0.5 }, { text: "world", start_s: 0.6, end_s: 1 },
    ]);
    expect(exact).toEqual([
      { text: "Hello,", start_s: 0.2, end_s: 0.5 }, { text: "world!", start_s: 0.6, end_s: 1 },
    ]);
    expect(matchScript("Good morning", [{ text: "good", start_s: 0, end_s: 0.2 }, { text: "mourning", start_s: 0.3, end_s: 0.8 }])).toEqual([
      { text: "Good", start_s: 0, end_s: 0.2 }, { text: "morning", start_s: 0.3, end_s: 0.8 },
    ]);
    expect(matchScript("Hello there friend", [
      { text: "hello", start_s: 0, end_s: 0.2 }, { text: "friend", start_s: 0.8, end_s: 1 },
    ])).toEqual([
      { text: "Hello", start_s: 0, end_s: 0.2 }, { text: "there", start_s: 0.5, end_s: 0.5 }, { text: "friend", start_s: 0.8, end_s: 1 },
    ]);
    expect(matchScript("Hello friend", [
      { text: "hello", start_s: 0, end_s: 0.2 }, { text: "um", start_s: 0.3, end_s: 0.4 }, { text: "friend", start_s: 0.8, end_s: 1 },
    ])).toHaveLength(2);
    expect(matchScript("Hello", [])).toEqual([]);
  });

  test("builds caption cues with line, duration and padding rules", () => {
    const words = Array.from({ length: 15 }, (_, index) => ({ text: `word${index}`, start_s: index * 0.2 + 0.1, end_s: index * 0.2 + 0.3 }));
    const cues = scriptCaptionCues(words);
    expect(cues.length).toBeGreaterThan(1);
    expect(cues.every((cue) => cue.text.length <= 42)).toBe(true);
    expect(cues[0]!.start).toBeCloseTo(0.02);
    expect(cues[0]!.end - cues[0]!.start).toBeGreaterThanOrEqual(1);
    expect(cues[cues.length - 1]!.end).toBeCloseTo(words[words.length - 1]!.end_s + 0.35);
  });
});
