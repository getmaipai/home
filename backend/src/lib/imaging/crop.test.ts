import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { cropToFrame } from "./crop";

describe("cropToFrame", () => {
  test("zoom one keeps the image dimensions", async () => {
    const png = new Uint8Array(await sharp({ create: { width: 1024, height: 1024, channels: 4, background: "red" } }).png().toBuffer());
    const out = await sharp(await cropToFrame(png, { zoom: 1, x: .5, y: .5 })).metadata();
    expect([out.width, out.height]).toEqual([1024, 1024]);
  });
  test("zoom two crops around the centre", async () => {
    const png = new Uint8Array(await sharp({ create: { width: 1024, height: 1024, channels: 4, background: "red" } }).png().toBuffer());
    const out = await sharp(await cropToFrame(png, { zoom: 2, x: .5, y: .5 })).metadata();
    expect([out.width, out.height]).toEqual([512, 512]);
  });
  test("clamps the centre at each edge", async () => {
    const png = new Uint8Array(await sharp({ create: { width: 1024, height: 1024, channels: 4, background: "red" } }).png().toBuffer());
    for (const point of [{ x: 0, y: 0 }, { x: 1, y: 1 }]) {
      const out = await cropToFrame(png, { zoom: 2, ...point });
      expect((await sharp(out).metadata()).width).toBe(512);
    }
  });
});
