import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { cleanChatImage, MAX_CHAT_IMAGE_PIXELS } from "@/lib/imageUpload";
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
});
