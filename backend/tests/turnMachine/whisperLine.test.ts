// WHISPER-01: the fixed whisper line is for a spoken adult turn only, and rides after the stable prefix.
import { describe, expect, test } from "bun:test";
import type { TurnSignal } from "@maipai/spec/gen/ts/turn-signal.js";
import { contextToMessages } from "@/lib/turnMachine/messages";
import { WHISPER_LINE, WHISPER_MODE_LINE, whisperLineFor } from "@/lib/turnMachine/whisperLine";
import { fallbackSignal } from "@/lib/turnSignal";
import { planFor } from "@/lib/register";
import { buildStablePrefix } from "@/lib/turnShared";
import { DEFAULT_PERSONA } from "@/lib/persona";
import { turnWarmupPrompt } from "@/lib/turnMachine/warmup";

type Band = "adult" | "teen" | "child";
function system(band: Band, surfaceClass: "written" | "spoken" | "glance"): string {
  const signal: TurnSignal = fallbackSignal("hello", band, "identified_profile", "question");
  const plan = planFor({ signal, surface: "chat", surfaceClass, brevity: false, evidence: { choices: 0, sources: 0, deliverable: false }, companion: { directness: 0.5 } as never } as never);
  return String(contextToMessages([], "hello", DEFAULT_PERSONA, plan, signal, surfaceClass, [], false, "", undefined, whisperLineFor(surfaceClass, band))[0]?.content);
}

describe("WHISPER-01 whisper line", () => {
  test("only a spoken adult turn gets the line", () => {
    expect(whisperLineFor("spoken", "adult")).toBe(WHISPER_LINE);
    expect(whisperLineFor(undefined, "adult")).toBe(WHISPER_LINE);
    for (const [surface, band] of [["written", "adult"], ["glance", "adult"], ["spoken", "teen"], ["spoken", "child"]] as const) expect(whisperLineFor(surface, band)).toBe("");
  });
  test("while the whisper is on, the mode line replaces it and says nothing about tags", () => {
    expect(whisperLineFor("spoken", "adult", true)).toBe(WHISPER_MODE_LINE);
    expect(WHISPER_MODE_LINE).toContain("[normal voice]");
    expect(WHISPER_MODE_LINE).toContain("Do not write [whispering]");
    expect(whisperLineFor("spoken", "teen", true)).toBe("");
    expect(whisperLineFor("written", "adult", true)).toBe("");
  });
  test("the line follows the stable prefix, which stays what the warm-up primes", async () => {
    const text = system("adult", "spoken");
    expect(text).toContain(WHISPER_LINE);
    expect(text.startsWith(buildStablePrefix(DEFAULT_PERSONA, "spoken"))).toBe(true);
    expect((await turnWarmupPrompt("spoken")).system).toBe(buildStablePrefix(DEFAULT_PERSONA, "spoken"));
  });
  test("a written turn, a teen and a child never see it", () => {
    for (const [band, surface] of [["adult", "written"], ["teen", "spoken"], ["child", "spoken"]] as const) expect(system(band, surface)).not.toContain("[whispering]");
  });
});
