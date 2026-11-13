import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { harmonize, ringMask } from "@/lib/videos/firstPictureHarmony";

const rawMask = async (png: Buffer) => sharp(png).greyscale().raw().toBuffer();
describe("first picture harmony masks", () => {
  test("leaves faces and bodies protected while opening the outline ring and contact strips", async () => {
    const width = 180, height = 100, people = [];
    for (const left of [25, 105]) {
      const alpha = Buffer.alloc(width * height); for (let y = 20; y < 80; y++) alpha.fill(255, y * width + left, y * width + left + 30);
      people.push({ alpha, contact: { left, top: 80, width: 30, height: 9 } });
    }
    const mask = await rawMask(await ringMask({ width, height, people, faceBoxes: [{ box: [32, 25, 12, 12] }, { box: [112, 25, 12, 12] }] }));
    for (const x of [35, 115]) expect(mask[30 * width + x]).toBe(0);
    for (const x of [23, 24, 56]) expect(mask[48 * width + x]).toBe(255);
    for (const x of [27, 40, 53]) expect(mask[84 * width + x]).toBe(255);
  });
  test("restores the original face pixels after the edit paints everything red", async () => {
    const width = 100, height = 80, src = await sharp({ create: { width, height, channels: 3, background: "#336699" } }).png().toBuffer();
    const alpha = Buffer.alloc(width * height); for (let y = 20; y < 70; y++) alpha.fill(255, y * width + 30, y * width + 70);
    const out = await harmonize({ png: src, people: [{ alpha, contact: { left: 30, top: 70, width: 40, height: 8 } }], faceBoxes: [{ box: [42, 28, 16, 18] }], signal: new AbortController().signal,
      tools: { harmonize: async () => new Uint8Array(await sharp({ create: { width, height, channels: 3, background: "red" } }).png().toBuffer()) } });
    const [before, after] = await Promise.all([sharp(src).removeAlpha().raw().toBuffer(), sharp(out).removeAlpha().raw().toBuffer()]);
    const i = (36 * width + 52) * 3; expect(after.subarray(i, i + 3)).toEqual(before.subarray(i, i + 3));
    const ring = (18 * width + 28) * 3; expect(after[ring]).toBeGreaterThan(200); expect(after[ring + 1]).toBeLessThan(30);
  });
});
