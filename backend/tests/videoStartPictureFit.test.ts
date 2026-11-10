// Any picture can start a clip: a huge photo is shrunk and a rotated one turned upright before the Stack sees it; a normal one goes through
// untouched; the clip's length never depends on the picture. A file that is not a picture goes through so the Stack's own line explains it.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import sharp from "sharp";
import { resetDb } from "./reset-db";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import { START_PICTURE_MAX_SIDE, fitPictureForStack, pictureNeedsFit, submitVideo } from "@/lib/videos/stack";

const make = async (width: number, height: number, format: "png" | "jpeg" = "png") => {
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 31 + (i >> 8)) & 255; // noisy, so a big one really is heavy
  const image = sharp(raw, { raw: { width, height, channels: 3 } });
  return (format === "png" ? await image.png({ compressionLevel: 0 }).toBuffer() : await image.jpeg({ quality: 100 }).toBuffer()).toString("base64");
};
const sizeOf = async (base64: string) => { const meta = await sharp(Buffer.from(base64, "base64")).metadata(); return { width: meta.width!, height: meta.height! }; };

describe("fitPictureForStack", () => {
  test("a normal picture, wide, tall, square or tiny, goes through byte for byte", async () => {
    for (const [w, h] of [[640, 360], [360, 640], [500, 500], [16, 16]] as const) {
      const picture = await make(w, h);
      expect(await fitPictureForStack(picture), `${w}x${h}`).toBe(picture);
    }
  });
  test("a huge picture is shrunk to fit, keeping its shape, in a format the Stack reads", async () => {
    const wide = await fitPictureForStack(await make(6000, 3000));
    const { width, height } = await sizeOf(wide);
    expect(Math.max(width, height)).toBe(START_PICTURE_MAX_SIDE);
    expect(width / height).toBeCloseTo(2, 1);
    expect(Buffer.from(wide, "base64").length).toBeLessThan(8 * 1024 * 1024);
    const tall = await sizeOf(await fitPictureForStack(await make(2000, 4000)));
    expect(tall.height).toBe(START_PICTURE_MAX_SIDE);
    expect(tall.width).toBeCloseTo(1280, -1);
  });
  test("a very heavy file under the side limit is re-encoded under the byte limit", async () => {
    const heavy = await make(2400, 1800); // uncompressed noise PNG, well over 8 MB
    expect(Buffer.from(heavy, "base64").length).toBeGreaterThan(8 * 1024 * 1024);
    expect(Buffer.from(await fitPictureForStack(heavy), "base64").length).toBeLessThan(8 * 1024 * 1024);
  });
  test("a sideways photo (rotation in its metadata) is turned upright", async () => {
    const sideways = (await sharp(Buffer.from(await make(400, 200, "jpeg"), "base64")).withMetadata({ orientation: 6 }).jpeg().toBuffer()).toString("base64");
    expect(await sizeOf(await fitPictureForStack(sideways))).toEqual({ width: 200, height: 400 });
  });
  test("only a heavy picture is touched on its way to the Stack; a big-looking but light one, a sideways one and a tiny one go as they are", async () => {
    expect(pictureNeedsFit(undefined)).toBe(false);
    expect(pictureNeedsFit(await make(640, 360))).toBe(false);
    expect(pictureNeedsFit(await make(2400, 1800))).toBe(true);
  });
  test("a file that is not a picture goes through unchanged", async () => {
    expect(await fitPictureForStack(Buffer.from("not a picture").toString("base64"))).toBe(Buffer.from("not a picture").toString("base64"));
  });
});

describe("submitVideo", () => {
  test("a normal picture is sent exactly as it is", async () => {
    const picture = await make(300, 500);
    await submitVideo({ prompt: "a boat", model: "ltx25-q8", size: "256x512", seconds: 5, image: picture, timeout_ms: 1 } as never);
    expect((fake.submitted[0] as { image: string }).image).toBe(picture);
  });
  let fake: FakeVideoStack;
  beforeEach(() => { resetDb(); fake = installFakeVideoStack(); });
  afterEach(() => fake.restore());
  test("a huge start and end picture reach the Stack fitted, and the length asked for is the length sent", async () => {
    await submitVideo({ prompt: "a boat", model: "ltx25-q8", size: "256x512", seconds: 10, image: await make(5000, 3000), end_image: await make(3000, 5000), timeout_ms: 1 } as never);
    const sent = fake.submitted[0] as { image: string; end_image: string; seconds: number };
    expect(sent.seconds).toBe(10);
    expect(Math.max(...Object.values(await sizeOf(sent.image)))).toBe(START_PICTURE_MAX_SIDE);
    expect(Math.max(...Object.values(await sizeOf(sent.end_image)))).toBe(START_PICTURE_MAX_SIDE);
  });
});
