import { expect, test } from "bun:test";
import sharp from "sharp";
import { lightArt } from "@/lib/media/serve";

test("a large cover goes out smaller as WebP; a small one is untouched", async () => {
  const noise = Buffer.alloc(2000 * 2000 * 3);
  for (let i = 0; i < noise.length; i += 1) noise[i] = (i * 2654435761) >>> 24;
  const big = await sharp(noise, { raw: { width: 2000, height: 2000, channels: 3 } }).png().toBuffer();
  expect(big.byteLength).toBeGreaterThan(150_000);
  const out = await lightArt(new Uint8Array(big), "image/png");
  expect(out.type).toBe("image/webp");
  expect(out.body.byteLength).toBeLessThan(big.byteLength);
  expect((await sharp(out.body).metadata()).width).toBeLessThanOrEqual(800);
  const tiny = new Uint8Array([1, 2, 3]);
  const same = await lightArt(tiny, "image/png");
  expect(same.body).toBe(tiny);
  expect(same.type).toBe("image/png");
});
