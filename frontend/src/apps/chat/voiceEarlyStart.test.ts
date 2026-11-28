import { describe, expect, test } from "bun:test";
import { decideVoiceEarlyStart, type VoiceEarlyStartInput } from "@/apps/chat/voiceEarlyStart";

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const allowed: VoiceEarlyStartInput = { mode: "listening", muted: false, overlapPaused: false, replySpeaking: false };

describe("voice early-start decision", () => {
  test.each([
    ["muted", { ...allowed, muted: true }, "muted"],
    ["paused overlap", { ...allowed, overlapPaused: true }, "refused_overlap_paused"],
    ["speaking mode", { ...allowed, mode: "speaking" }, "refused_mode_speaking"],
    ["thinking mode", { ...allowed, mode: "thinking" }, "refused_mode_thinking"],
    ["connecting mode", { ...allowed, mode: "connecting" }, "refused_mode_connecting"],
    ["reply audio still speaking", { ...allowed, replySpeaking: true }, "refused_reply_speaking"],
  ] as const)("names the existing blocker: %s", (_name, input, blocker) => {
    expect(decideVoiceEarlyStart(input)).toEqual({ allow: false, blocker });
  });

  test("allows a listening session with no other blocker", () => {
    expect(decideVoiceEarlyStart(allowed)).toEqual({ allow: true });
  });

  test("interruption pause always switches early start off", () => {
    expect(decideVoiceEarlyStart({ ...allowed, overlapPaused: true })).toEqual({ allow: false, blocker: "refused_overlap_paused" });
  });

  test("seeded random inputs agree with the rule statement and never allow a forbidden mode or paused overlap", () => {
    const modes: VoiceEarlyStartInput["mode"][] = ["connecting", "listening", "thinking", "speaking"];
    for (let seed = 1; seed <= 500; seed++) {
      const next = rng(seed);
      for (let i = 0; i < 40; i++) {
        const input: VoiceEarlyStartInput = {
          mode: modes[Math.floor(next() * modes.length)]!,
          muted: next() < 0.5,
          overlapPaused: next() < 0.5,
          replySpeaking: next() < 0.5,
        };
        const actual = decideVoiceEarlyStart(input);
        const expected = input.muted ? { allow: false as const, blocker: "muted" as const }
          : input.overlapPaused ? { allow: false as const, blocker: "refused_overlap_paused" as const }
          : input.mode === "speaking" ? { allow: false as const, blocker: "refused_mode_speaking" as const }
          : input.mode === "thinking" ? { allow: false as const, blocker: "refused_mode_thinking" as const }
          : input.mode === "connecting" ? { allow: false as const, blocker: "refused_mode_connecting" as const }
          : input.replySpeaking ? { allow: false as const, blocker: "refused_reply_speaking" as const }
          : { allow: true as const };
        expect(actual).toEqual(expected);
        if (input.overlapPaused || input.mode !== "listening") expect(actual.allow).toBe(false);
      }
    }
  });
});
