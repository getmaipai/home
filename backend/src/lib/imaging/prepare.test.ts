import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { preparePicture } from "./prepare";
async function png(alpha: boolean, size = 40) { return new Uint8Array(await sharp({ create: { width: size, height: size, channels: 4, background: { r: 80, g: 90, b: 100, alpha: alpha ? 0.5 : 1 } } }).png().toBuffer()); }
const fit = async (bytes: Uint8Array) => bytes;
describe("preparePicture", () => {
  test("upscales only below target and records exactly the steps", async () => {
    const calls: string[] = [];
    const tools = { upscale: async (bytes: Uint8Array) => { calls.push("upscale"); return bytes; }, removeBackground: async (bytes: Uint8Array) => { calls.push("remove"); return bytes; }, fit };
    const options = { size: 40, marginPercent: 10, upscaleBelowShortSide: 40, ...tools };
    const small = await preparePicture(await png(false, 20), options);
    expect(calls).toEqual(["upscale", "remove"]); expect(small.steps).toEqual(["upscale", "remove_background", "find_subject", "fit"]);
    calls.length = 0;
    const large = await preparePicture(await png(true, 40), options);
    expect(calls).toEqual([]); expect(large.steps).toEqual(["find_subject", "fit"]);
  });
  test("removes only when there is no real transparency", async () => {
    let removed = 0;
    const out = await preparePicture(await png(true), { size: 40, marginPercent: 10, upscaleBelowShortSide: 40, removeBackground: async (bytes) => { removed++; return bytes; }, fit });
    expect(removed).toBe(0); expect(out.steps).toEqual(["find_subject", "fit"]);
  });
  test("throws one plain sentence when a required tool is missing", async () => {
    await expect(preparePicture(await png(false, 20), { size: 40, marginPercent: 10, upscaleBelowShortSide: 40, removeBackground: async (bytes) => bytes, fit })).rejects.toThrow("The upscaler isn't installed. Install it from the engine's model list, then try again.");
  });
});
