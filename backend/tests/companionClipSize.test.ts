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
      const prompt = packTakePrompt({ text: "A knight holding a sword, full body, riding a horse." }, state, "green"); const second = packTakePrompt({ text: "" }, state, "green", 1); expect(typeof second).toBe("string");
      expect(prompt).not.toMatch(/knight|sword|full body|horse/i); // the character text is never used for a pack clip
      expect(prompt).toContain("Only the head, neck and upper chest are in frame");
      // the words name what the video model does: none of the forbidden things may appear in the positive prompt (they live in the negative prompt)
      expect(prompt).not.toMatch(/sigh|exhale|deep breath|head drop|looking down|look down|eye roll|rolling|no hands|never shown|never close/i);
      expect(prompt).not.toMatch(/head to feet|fist|lightbulb/i);
      for (const motion of PACK_MOTIONS[state]!) expect(motion).not.toMatch(/sigh|exhale|deep breath|head drop|look(s|ing)? down|eye roll|never|\bno\b/i);
      expect(PACK_MOTIONS[state]!.length).toBeGreaterThan(0);
    }
  });
});

import sharp from "sharp";
import { restBandReference } from "@/lib/companionTakes";
describe("a pack clip's pin picture is a band of the character's own rest picture (pinning to the green start picture leaked green; a hand-keyed band came out magenta)", () => {
  test("it keeps the rest picture's transparency, is the clip's size, and takes the band's region", async () => {
    const N = 64, raw = Buffer.alloc(N * N * 4); for (let i = 0; i < N * N; i++) { const x = i % N, y = Math.floor(i / N), inside = x >= 16 && x < 48 && y >= 16 && y < 48; raw[i * 4] = 200; raw[i * 4 + 1] = 120; raw[i * 4 + 2] = 90; raw[i * 4 + 3] = inside ? 255 : 0; }
    const png = new Uint8Array(await sharp(raw, { raw: { width: N, height: N, channels: 4 } }).png().toBuffer());
    const out = await sharp(Buffer.from(await restBandReference(png, { x: 0, y: 8, width: 64, height: 37 }, { width: 64, height: 64 }, { width: 768, height: 448 }), "base64")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([out.info.width, out.info.height]).toEqual([768, 448]);
    expect(out.data[3]).toBe(0); // the corner stays transparent, its colour is never made green
    const o = (224 * 768 + 384) * 4; expect([out.data[o], out.data[o + 1], out.data[o + 2], out.data[o + 3]]).toEqual([200, 120, 90, 255]); // the middle keeps the figure's own colour
  });
});

describe("the two idle takes use different motions (the demo's breathing and the glance aside)", () => {
  test("variant 0 and 1 of idle differ, a state with one motion repeats it, and the Max model is asked for", () => {
    expect(packTakePrompt({ text: "" }, "idle", "green", 0)).not.toBe(packTakePrompt({ text: "" }, "idle", "green", 1));
    expect(packTakePrompt({ text: "" }, "speaking", "green", 0)).toBe(packTakePrompt({ text: "" }, "speaking", "green", 3));
    expect(PACK_MOTIONS.idle![0]).toMatch(/eyes open/); expect(PACK_MOTIONS.idle![1]).toMatch(/glance briefly/);
    for (const list of Object.values(PACK_MOTIONS)) for (const m of list) expect(m).not.toMatch(/blink|breath|sigh|calm|relaxed|tilt?s? slightly/i);
  });
});
