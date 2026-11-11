import { describe, expect, test } from "bun:test";
import { takeClipSize } from "@/lib/companionClipSize";
import { videoSizeFor } from "@/lib/videos/quality";
import media from "@maipai/spec/vocab/companion-media.json";

// The Stack (backend/src/video/ltx25.ts, LTX25_MEASURED) makes only measured sizes: 512x256, 640x320, 768x448 (ltx25-q8) and 1024x576 (ltx25-max),
// and since c751a0e their tall twins. A take must ask for one of these (the spec's 384x384 `generate` size is Wan Quick's and was refused).
const ACCEPTED = new Set(["512x256", "640x320", "768x448", "1024x576", "256x512", "320x640", "448x768", "576x1024"]);
const sizeText = (s: { width: number; height: number }) => `${s.width}x${s.height}`;

describe("take size comes from the video flow's own size picker", () => {
  test("ltx25 models ask for a size the Stack makes, wide or tall by the picture's shape", () => {
    for (const [model, quality] of [["ltx25-q8", "detailed"], ["ltx25-max", "detailed"]] as const) {
      for (const portrait of [false, true]) expect(ACCEPTED.has(sizeText(takeClipSize(model, quality, portrait)))).toBe(true);
    }
  });
  test("it is exactly what videoSizeFor says, so the two cannot drift", () => {
    expect(sizeText(takeClipSize("ltx25-q8", "detailed", false))).toBe(videoSizeFor("ltx25", "detailed", false));
    expect(sizeText(takeClipSize("ltx25-q8", "detailed", true))).toBe(videoSizeFor("ltx25", "detailed", true));
  });
  test("Wan Quick keeps the spec's generate size", () => {
    expect(takeClipSize("wan-quick", "quick", false)).toEqual({ width: media.generate.width, height: media.generate.height });
  });
});

import { reportedVideoModelMatches } from "@/lib/companionArt";
describe("a finished clip's reported model (found on the first real run: the Stack names the engine, not the alias)", () => {
  const art = { model: "ltx25-q8", quality: "detailed" } as never;
  test("the alias, the take's model and the Stack's own name for LTX-2.5 all match", () => {
    expect(reportedVideoModelMatches("ltx25-q8", art, "ltx25-q8")).toBe(true);
    expect(reportedVideoModelMatches("ltx-2-5-q8-distilled-mlx", art, "ltx25-q8")).toBe(true);
  });
  test("a different model does not match", () => {
    expect(reportedVideoModelMatches("ltx-2-5-bf16-distilled-mlx-max", art, "ltx25-q8")).toBe(false);
    expect(reportedVideoModelMatches("wan-quick", art, "ltx25-q8")).toBe(false);
  });
});

import { reportedVideoQualityMatches } from "@/lib/companionArt";
describe("a finished clip's reported quality (the Stack says ltx25, Home's lane is detailed)", () => {
  test("ltx25 matches the q8 model, ltx25max the max model, and a mismatch is refused", () => {
    expect(reportedVideoQualityMatches("ltx25", { model: "ltx25-q8", quality: "detailed" } as never)).toBe(true);
    expect(reportedVideoQualityMatches("ltx25max", { model: "ltx25-max", quality: "detailed" } as never)).toBe(true);
    expect(reportedVideoQualityMatches("ltx25max", { model: "ltx25-q8", quality: "detailed" } as never)).toBe(false);
    expect(reportedVideoQualityMatches("quick", { model: "ltx25-q8", quality: "detailed" } as never)).toBe(false);
  });
});

import { PACK_MOTIONS, packTakePrompt } from "@/lib/companionTakes";
describe("a pack clip's prompt (the generic mascot prompt made a hand appear and the face change on the first real run)", () => {
  test("is a locked headshot loop with nothing below the chest and hands never shown, for every pack state", () => {
    for (const state of ["idle", "listening", "thinking", "speaking"]) {
      const prompt = packTakePrompt({ text: "A knight holding a sword, full body, riding a horse." }, state, "green");
      expect(prompt).not.toMatch(/knight|sword|full body|horse/i); // the character text is never used for a pack clip
      expect(prompt).toContain("nothing shown below the chest"); expect(prompt).toContain("Hands are never shown"); expect(prompt).toContain("final frame matches the first");
      expect(prompt).not.toMatch(/head to feet|fist|lightbulb/i);
      expect(PACK_MOTIONS[state]).toBeTruthy();
    }
  });
});
