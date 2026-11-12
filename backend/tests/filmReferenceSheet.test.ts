import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { buildReferenceSheet, sheetGrid } from "@/lib/films/referenceSheet";

const solid = async (r: number, g: number, b: number, width = 640, height = 360) => new Uint8Array(await sharp({ create: { width, height, channels: 3, background: { r, g, b } } }).png().toBuffer());
async function pixel(png: Uint8Array, x: number, y: number) { const { data, info } = await sharp(Buffer.from(png)).raw().toBuffer({ resolveWithObject: true }); const at = (y * info.width + x) * info.channels; return [data[at]!, data[at + 1]!, data[at + 2]!]; }

describe("reference sheet", () => {
  test("lays out one to six panels", () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => sheetGrid(n))).toEqual([{ columns: 1, rows: 1 }, { columns: 2, rows: 1 }, { columns: 3, rows: 1 }, { columns: 2, rows: 2 }, { columns: 3, rows: 2 }, { columns: 3, rows: 2 }]);
  });
  test("four photos land untouched in their own quadrants on black, 768 by 448", async () => {
    const colors: Array<[number, number, number]> = [[200, 20, 20], [20, 200, 20], [20, 20, 200], [200, 200, 20]];
    const sheet = await buildReferenceSheet(await Promise.all(colors.map(([r, g, b]) => solid(r, g, b))));
    const meta = await sharp(Buffer.from(sheet)).metadata();
    expect([meta.width, meta.height]).toEqual([768, 448]);
    expect(await pixel(sheet, 192, 112)).toEqual([200, 20, 20]);   // top left
    expect(await pixel(sheet, 576, 112)).toEqual([20, 200, 20]);   // top right
    expect(await pixel(sheet, 192, 336)).toEqual([20, 20, 200]);   // bottom left
    expect(await pixel(sheet, 576, 336)).toEqual([200, 200, 20]);  // bottom right
    expect(await pixel(sheet, 384, 224)).toEqual([0, 0, 0]);       // the black gap between panels
    expect(await pixel(sheet, 2, 2)).toEqual([0, 0, 0]);           // the black margin
  });
  test("no pictures or seven pictures is refused", async () => {
    await expect(buildReferenceSheet([])).rejects.toThrow("one to six");
    await expect(buildReferenceSheet(await Promise.all(Array.from({ length: 7 }, () => solid(1, 2, 3))))).rejects.toThrow("one to six");
  });
});
