import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import sharp from "sharp";
import { putAnswerImage, getAnswerImage, clearAnswerImageCacheForTests, answerImagesCacheDir, clearTemporaryAnswerImages, __setAnswerImageCacheCapForTests, sweepAnswerImages } from "@/lib/answerImages/cache";
import { dataClassById } from "@/lib/dataClasses";
import { __setAnswerImageDnsLookupForTests } from "@/lib/answerImages/fetch";

afterEach(() => { __setAnswerImageCacheCapForTests(300 * 1024 * 1024); __setAnswerImageDnsLookupForTests(null); });

describe("answer image cache", () => {
  test("temporary images stay in memory and adult-only entries are hidden from minors", async () => {
    clearAnswerImageCacheForTests();
    const id = await putAnswerImage({ tile: new Uint8Array([1]), full: new Uint8Array([2]), band: "adult", temporary: true, temporaryChatId: "chat-a" });
    expect(existsSync(`${answerImagesCacheDir}/${id}-tile.webp`)).toBe(false);
    expect(await getAnswerImage(id, "adult", "tile")).toEqual(new Uint8Array([1]));
    expect(await getAnswerImage(id, "child", "tile")).toBeNull();
    expect(await getAnswerImage(id, "adult", "tile")).toEqual(new Uint8Array([1]));
    const otherId = await putAnswerImage({ tile: new Uint8Array([4]), full: new Uint8Array([5]), band: "adult", temporary: true, temporaryChatId: "chat-b" });
    clearTemporaryAnswerImages("chat-a");
    expect(await getAnswerImage(id, "adult", "tile")).toBeNull();
    expect(await getAnswerImage(otherId, "adult", "tile")).toEqual(new Uint8Array([4]));
    expect(dataClassById("answer-images").backup).toBe("exclude");
    expect(answerImagesCacheDir).toContain("answer-images");
  });

  test("the cache cap evicts old bytes and a later read refetches through validation", async () => {
    clearAnswerImageCacheForTests();
    const pixel = Buffer.alloc(720 * 540 * 3);
    for (let i = 0; i < pixel.length; i += 3) { pixel[i] = i % 251; pixel[i + 1] = (i * 3) % 239; pixel[i + 2] = (i * 7) % 233; }
    const jpeg = new Uint8Array(await sharp(pixel, { raw: { width: 720, height: 540, channels: 3 } }).jpeg({ quality: 88 }).toBuffer());
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return new Response(jpeg, { status: 200, headers: { "content-type": "image/jpeg" } }); }) as unknown as typeof fetch;
    __setAnswerImageDnsLookupForTests(async () => ({ address: "93.184.216.34", family: 4 }));
    try {
      const id = await putAnswerImage({ tile: new Uint8Array([1]), full: new Uint8Array([2]), band: "adult", originalUrl: "https://picture.example/photo.jpg" });
      __setAnswerImageCacheCapForTests(1);
      expect(sweepAnswerImages().evicted).toBe(1);
      expect(await getAnswerImage(id, "adult", "tile")).toBeInstanceOf(Uint8Array);
      expect(calls).toBe(1);
    } finally { globalThis.fetch = originalFetch; }
  });
  test("ANSWER-IMG-02: the same picture approved for a teen and then an adult stays readable by the teen, never by a child", async () => {
    const tile = new Uint8Array([7, 7]), full = new Uint8Array([8, 8]);
    const id = await putAnswerImage({ tile, full, band: "teen" });
    expect(await getAnswerImage(id, "teen", "tile")).toEqual(tile);
    expect(await putAnswerImage({ tile, full, band: "adult" })).toBe(id);
    expect(await getAnswerImage(id, "teen", "tile")).toEqual(tile);
    expect(await getAnswerImage(id, "adult", "full")).toEqual(full);
    expect(await getAnswerImage(id, "child", "tile")).toBeNull();
  });
});
