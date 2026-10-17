import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { cleanChatImage, MAX_CHAT_IMAGE_EDGE, MAX_CHAT_IMAGE_PIXELS } from "@/lib/imageUpload";
import { CHAT_IMAGE_REFUSAL, MAX_CHAT_IMAGE_BYTES } from "@/wire";

describe("chat image cleaning", () => {
  test("applies EXIF orientation and strips metadata from the stored JPEG", async () => {
    const source = await sharp({ create: { width: 2, height: 3, channels: 3, background: "red" } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const cleaned = await cleanChatImage(new Uint8Array(source));
    const stored = await sharp(cleaned.bytes).metadata();
    expect(cleaned.mediaType).toBe("image/jpeg");
    expect([cleaned.width, cleaned.height]).toEqual([3, 2]);
    expect(stored.exif).toBeUndefined();
    expect(stored.xmp).toBeUndefined();
    expect(stored.width).toBe(3);
    expect(stored.height).toBe(2);
  });

  test("converts supported PNG input to JPEG and refuses bytes without a matching image signature", async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 4, background: "blue" } }).png().toBuffer();
    expect((await cleanChatImage(new Uint8Array(png))).mediaType).toBe("image/jpeg");
    await expect(cleanChatImage(new Uint8Array([0, 1, 2, 3]))).rejects.toThrow("not a supported picture");
  });

  test("refuses files over the one declared byte cap with the composer line", async () => {
    expect(MAX_CHAT_IMAGE_BYTES).toBe(10 * 1024 * 1024);
    await expect(cleanChatImage(new Uint8Array(MAX_CHAT_IMAGE_BYTES + 1))).rejects.toThrow(CHAT_IMAGE_REFUSAL);
  });

  test("refuses a decoded image over 40 megapixels", async () => {
    expect(MAX_CHAT_IMAGE_PIXELS).toBe(40_000_000);
    const png = await sharp({ create: { width: 7000, height: 6000, channels: 3, background: "white" } }).png().toBuffer();
    await expect(cleanChatImage(new Uint8Array(png))).rejects.toThrow("too large to process");
  });

  test("downscales a large photo to the longest-edge cap, keeps a small one as it is, and keeps the orientation", async () => {
    const big = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: "green" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const cleaned = await cleanChatImage(new Uint8Array(big));
    expect(MAX_CHAT_IMAGE_EDGE).toBe(2000);
    expect([cleaned.width, cleaned.height]).toEqual([1500, 2000]);
    const small = await sharp({ create: { width: 640, height: 480, channels: 3, background: "red" } }).png().toBuffer();
    const kept = await cleanChatImage(new Uint8Array(small));
    expect([kept.width, kept.height]).toEqual([640, 480]);
  });

  test("drops GPS and camera tags", async () => {
    const tagged = await sharp({ create: { width: 8, height: 8, channels: 3, background: "blue" } }).jpeg().withExif({ IFD0: { Make: "TestCam" }, IFD3: { GPSLatitudeRef: "N" } }).toBuffer();
    expect((await sharp(tagged).metadata()).exif).toBeDefined();
    const stored = await sharp((await cleanChatImage(new Uint8Array(tagged))).bytes).metadata();
    expect(stored.exif).toBeUndefined();
  });

  test.skipIf(process.platform !== "darwin")("converts a HEIC picture (the system converter) to a JPEG", async () => {
    const dir = mkdtempSync(join(tmpdir(), "heic-test-"));
    try {
      const png = await sharp({ create: { width: 300, height: 200, channels: 3, background: "orange" } }).png().toBuffer();
      writeFileSync(join(dir, "a.png"), png);
      execFileSync("/usr/bin/sips", ["-s", "format", "heic", join(dir, "a.png"), "--out", join(dir, "a.heic")], { stdio: "ignore" });
      const cleaned = await cleanChatImage(new Uint8Array(readFileSync(join(dir, "a.heic"))));
      expect(cleaned.mediaType).toBe("image/jpeg");
      expect([cleaned.width, cleaned.height]).toEqual([300, 200]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
