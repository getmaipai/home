import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { subjectBounds } from "./subject";
async function picture(rect: { left: number; top: number; width: number; height: number } | null) {
  const base = sharp({ create: { width: 40, height: 30, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
  return new Uint8Array(await (rect ? base.composite([{ input: { create: { width: rect.width, height: rect.height, channels: 4, background: { r: 20, g: 30, b: 40, alpha: 1 } } }, left: rect.left, top: rect.top }]) : base).png().toBuffer());
}
describe("subjectBounds", () => {
  test("returns the bounds of visible pixels", async () => { expect(await subjectBounds(await picture({ left: 7, top: 5, width: 12, height: 9 }))).toEqual({ left: 7, top: 5, width: 12, height: 9 }); });
  test("returns null for an empty image", async () => { expect(await subjectBounds(await picture(null))).toBeNull(); });
});
