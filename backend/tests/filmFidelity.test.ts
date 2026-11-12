import { afterEach, describe, expect, test } from "bun:test";
import sharp from "sharp";
import { measureClipDrift } from "@/lib/films/fidelity";
import { __setKeyframesForTests } from "@/lib/pictures/keyframes";

const jpeg = (color: { r: number; g: number; b: number }, split = false) => sharp({ create: { width: 256, height: 144, channels: 3, background: color } })
  .composite(split ? [{ input: { create: { width: 128, height: 144, channels: 3, background: { r: 255, g: 255, b: 255 } } }, left: 0, top: 0 }] : []).jpeg().toBuffer();

describe("film clip drift", () => {
  afterEach(() => __setKeyframesForTests(null));
  test("frames that stay on the starting picture measure near zero and an unrelated frame measures far", async () => {
    const start = new Uint8Array(await jpeg({ r: 40, g: 80, b: 160 }, true));
    const other = new Uint8Array(await sharp({ create: { width: 256, height: 144, channels: 3, background: { r: 0, g: 0, b: 0 } } }).composite([{ input: { create: { width: 256, height: 72, channels: 3, background: { r: 255, g: 255, b: 255 } } }, left: 0, top: 0 }]).jpeg().toBuffer());
    __setKeyframesForTests(async () => [start, start, other]);
    const drift = await measureClipDrift(start, new Uint8Array([1]), 5);
    expect(drift?.first).toBe(0);
    expect(drift?.middle).toBe(0);
    expect(drift!.last).toBeGreaterThan(12);
  });
  test("a clip that cannot be decoded measures as null, never an error", async () => {
    __setKeyframesForTests(async () => null);
    expect(await measureClipDrift(new Uint8Array([1]), new Uint8Array([1]), 5)).toBeNull();
  });
});
