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
  const bounds = async (out: Uint8Array) => {
    const { data, info } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let left = info.width, right = -1, top = info.height, bottom = -1;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) if (data[(y * info.width + x) * 4 + 3]! > 10) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
    return { left, right, top, bottom, centreX: (left + right) / 2, centreY: (top + bottom) / 2 };
  };
  test("placement moves the subject to the chosen centre without resizing it", async () => {
    const input = await image(100, { left: 40, top: 40, width: 20, height: 20 });
    const centred = await bounds(await fitToFrame(input, { size: 100, marginPercent: 10 }));
    const moved = await bounds(await fitToFrame(input, { size: 100, marginPercent: 10, placement: { zoom: 1, x: 0.45, y: 0.55 } }));
    expect(moved.right - moved.left).toBe(centred.right - centred.left);
    expect(moved.centreX).toBeCloseTo(44.5, 0); expect(moved.centreY).toBeCloseTo(54.5, 0);
  });
  test("placement zoom scales the subject and a subject moved past the edge is cut by the frame", async () => {
    const input = await image(100, { left: 40, top: 40, width: 20, height: 20 });
    const normal = await bounds(await fitToFrame(input, { size: 100, marginPercent: 10 }));
    const zoomed = await bounds(await fitToFrame(input, { size: 100, marginPercent: 10, placement: { zoom: 2, x: 0.5, y: 0.5 } }));
    expect(zoomed.right - zoomed.left).toBeGreaterThan(normal.right - normal.left);
    const cut = await bounds(await fitToFrame(input, { size: 100, marginPercent: 10, placement: { zoom: 1, x: 0.95, y: 0.5 } }));
    expect(cut.right).toBe(99);
    // Far past the edge is refused in plain words; a large zoom and a push well below the frame still work, with no upper limit on the zoom.
    await expect(fitToFrame(input, { size: 100, marginPercent: 10, placement: { zoom: 1, x: 3, y: 0.5 } })).rejects.toThrow("moved out of the picture");
    const down = await bounds(await fitToFrame(input, { size: 100, marginPercent: 10, placement: { zoom: 1, x: 0.5, y: 1.3 } }));
    expect(down.top).toBeGreaterThan(normal.top);
    const huge = await bounds(await fitToFrame(input, { size: 100, marginPercent: 10, placement: { zoom: 100, x: 0.5, y: 0.5 } }));
    expect([huge.left, huge.top, huge.right, huge.bottom]).toEqual([0, 0, 99, 99]);
  });
});
