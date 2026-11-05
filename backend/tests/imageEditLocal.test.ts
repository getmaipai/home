import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { processBackgroundBlur, processLocalPicture } from "@/lib/imageEdit";
import { registeredMediaOps } from "@/lib/mediaOps/registry";

describe("local picture operations", () => {
  test("registry exposes the three tools to the child band under the existing photo lane", async () => {
    await import("@/lib/mediaOps/picture");
    const entries = registeredMediaOps().filter((op) => ["picture.crop", "picture.adjust", "picture.blur_background"].includes(op.id));
    expect(entries).toHaveLength(3);
    expect(entries.every((op) => op.minBand === "child" && op.listed !== false && op.needs === null)).toBe(true);
  });

  test("centres a 4:3 crop of a square PNG", async () => {
    const source = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 120, g: 80, b: 40, alpha: 1 } } }).png().toBuffer();
    const result = await processLocalPicture(new Uint8Array(source), { operation: "crop", aspect: "4:3" });
    expect([result.width, result.height]).toEqual([64, 48]);
    expect((await sharp(result.png).metadata()).format).toBe("png");
  });

  test("auto tone changes pixel statistics and retains alpha", async () => {
    const raw = Buffer.alloc(16 * 16 * 4);
    for (let i = 0; i < 16 * 16; i++) { const value = 65 + (i % 12) * 2; raw[i * 4] = value; raw[i * 4 + 1] = value + 2; raw[i * 4 + 2] = value + 4; raw[i * 4 + 3] = i % 2 ? 255 : 120; }
    const source = await sharp(raw, { raw: { width: 16, height: 16, channels: 4 } }).png().toBuffer();
    const result = await processLocalPicture(new Uint8Array(source), { operation: "adjust", auto: true });
    const before = await sharp(source).stats(); const after = await sharp(result.png).stats();
    expect(after.channels[0]!.mean).not.toBe(before.channels[0]!.mean);
    const { data, info } = await sharp(result.png).raw().toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(4);
    expect(new Set(Array.from({ length: info.width * info.height }, (_, i) => data[i * 4 + 3])).size).toBeGreaterThan(1);
  });

  test("uses a supplied matte to keep the subject sharp over the blurred original", async () => {
    const raw = Buffer.alloc(32 * 32 * 3);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { const i = (y * 32 + x) * 3; raw[i] = x < 16 ? 0 : 255; raw[i + 1] = 40; raw[i + 2] = 80; }
    const source = await sharp(raw, { raw: { width: 32, height: 32, channels: 3 } }).png().toBuffer();
    const matte = await sharp({ create: { width: 32, height: 32, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: await sharp({ create: { width: 12, height: 20, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer(), left: 10, top: 6 }]).png().toBuffer();
    const result = await processBackgroundBlur(new Uint8Array(source), new Uint8Array(matte), 8);
    expect([result.width, result.height]).toEqual([32, 32]);
    expect((await sharp(result.png).metadata()).hasAlpha).toBe(true);
  });
});
