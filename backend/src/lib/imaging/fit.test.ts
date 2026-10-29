import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { fitToFrame } from "./fit";

async function image(size: number, rect: { left: number; top: number; width: number; height: number } | null) {
  const base = sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
  return rect ? new Uint8Array(await base.composite([{ input: { create: { width: rect.width, height: rect.height, channels: 4, background: { r: 240, g: 30, b: 10, alpha: 1 } } }, left: rect.left, top: rect.top }]).png().toBuffer()) : new Uint8Array(await base.png().toBuffer());
}
describe("fitToFrame", () => {
  test("trims and centres an off-centre small subject with a margin", async () => {
    const out = await fitToFrame(await image(100, { left: 8, top: 20, width: 20, height: 40 }), { size: 100, marginPercent: 10 });
    const { data, info } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(100); expect(info.height).toBe(100);
    const xs: number[] = [], ys: number[] = [];
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) if (data[(y * info.width + x) * 4 + 3]! > 10) { xs.push(x); ys.push(y); }
    expect(Math.min(...xs)).toBe(30); expect(Math.max(...xs)).toBe(69);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(49.5);
  });
  test("keeps the margin around a full-frame subject and outputs a size square PNG", async () => {
    const out = await fitToFrame(await image(100, { left: 0, top: 0, width: 100, height: 100 }), { size: 100, marginPercent: 10 });
    const meta = await sharp(out).metadata(); expect(meta.format).toBe("png"); expect(meta.width).toBe(100); expect(meta.height).toBe(100);
    const { data, info } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(data[3]).toBe(0); expect(data[(50 * info.width + 50) * 4 + 3]).toBe(255);
  });
  test("rejects fully transparent pictures plainly", async () => {
    await expect(fitToFrame(await image(20, null), { size: 100, marginPercent: 10 })).rejects.toThrow("That picture has no visible subject.");
  });
});
