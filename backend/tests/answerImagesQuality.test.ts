import { describe, expect, test, beforeAll } from "bun:test";
import sharp from "sharp";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { filterAnswerImages } from "@/lib/answerImages/quality";

const dir = await mkdtemp(join(tmpdir(), "answer-images-"));
const fixtures = new Map<string, Uint8Array>();
const photo = (seed: number, width: number, height: number) => {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 3;
    data[i] = (x * 7 + y * 3 + seed * 39) % 256;
    data[i + 1] = (y * 9 + x * 2 + seed * 71) % 256;
    data[i + 2] = ((x ^ y) + seed * 23) % 256;
  }
  return { data, width, height, channels: 3 as const };
};
const fromPhoto = (p: ReturnType<typeof photo>) => sharp(p.data, { raw: { width: p.width, height: p.height, channels: p.channels } });

beforeAll(async () => {
  const save = async (name: string, bytes: Buffer) => { fixtures.set(name, new Uint8Array(bytes)); await Bun.write(join(dir, name), bytes); };
  const base = photo(2, 720, 540);
  await save("photo.jpg", await fromPhoto(base).jpeg({ quality: 88 }).toBuffer());
  await save("photo-blurred.jpg", await fromPhoto(base).blur(5).jpeg({ quality: 88 }).toBuffer());
  await save("photo-medium.jpg", await fromPhoto(base).resize(480).jpeg({ quality: 70 }).toBuffer());
  await save("photo-lead.jpg", await fromPhoto(base).resize(600).jpeg({ quality: 75 }).toBuffer());
  await save("photo-small.jpg", await fromPhoto(base).resize(320).jpeg({ quality: 50 }).toBuffer());
  await save("crop-a.jpg", await fromPhoto(base).extract({ left: 72, top: 54, width: 576, height: 432 }).jpeg().toBuffer());
  await save("crop-b.jpg", await fromPhoto(base).extract({ left: 144, top: 108, width: 432, height: 324 }).jpeg().toBuffer());
  await save("different.jpg", await fromPhoto(photo(8, 720, 540)).jpeg().toBuffer());
  await save("hotlink.jpg", await sharp({ create: { width: 320, height: 240, channels: 3, background: "#cc3344" } }).jpeg().toBuffer());
  await save("not-found.jpg", await sharp({ create: { width: 320, height: 240, channels: 3, background: "#3355cc" } }).jpeg().toBuffer());
  await save("pixel.jpg", await sharp({ create: { width: 1, height: 1, channels: 3, background: "#777" } }).jpeg().toBuffer());
  await save("thumbnail.jpg", await fromPhoto(photo(3, 120, 90)).jpeg().toBuffer());
  await save("logo.png", await sharp({ create: { width: 320, height: 240, channels: 4, background: { r: 20, g: 90, b: 200, alpha: 0.1 } } }).png().toBuffer());
  await save("flat-text.png", await sharp({ create: { width: 320, height: 240, channels: 3, background: "white" } }).composite([{ input: Buffer.from('<svg width="320" height="240"><text x="10" y="120">HOTLINK BLOCKED</text></svg>') }]).png().toBuffer());
  await save("blank-low-bytes.jpg", await sharp({ create: { width: 1600, height: 1200, channels: 3, background: "#fafafa" } }).jpeg({ quality: 15 }).toBuffer());
  fixtures.set("html", new TextEncoder().encode("<!doctype html><title>404 Not Found</title><h1>Not Found</h1>"));
  fixtures.set("svg", new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="red"/></svg>'));
  const redFrame = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).gif().toBuffer();
  const blueFrame = await sharp({ create: { width: 2, height: 2, channels: 3, background: "blue" } }).gif().toBuffer();
  const blueDescriptor = Buffer.from(blueFrame.subarray(27, 37));
  blueDescriptor[9] = 0x80; // local two-color palette for frame two
  fixtures.set("animated.gif", new Uint8Array(Buffer.concat([
    redFrame.subarray(0, 19), redFrame.subarray(19, redFrame.length - 1),
    blueFrame.subarray(19, 27), blueDescriptor, blueFrame.subarray(13, 19),
    blueFrame.subarray(37, blueFrame.length - 1), Buffer.from([0x3b]),
  ])));
  const bomb = Buffer.from(await fromPhoto(photo(9, 8, 8)).png().toBuffer());
  bomb.writeUInt32BE(100_000, 16); bomb.writeUInt32BE(100_000, 20);
  fixtures.set("bomb", new Uint8Array(bomb));
});

const candidate = (id: string, bytesKey: string, leadImage = false) => ({ id, bytes: fixtures.get(bytesKey)!, contentType: bytesKey === "html" ? "text/html" : bytesKey === "svg" ? "image/svg+xml" : bytesKey === "animated.gif" ? "image/gif" : bytesKey.endsWith(".png") || bytesKey === "bomb" ? "image/png" : "image/jpeg", leadImage });

describe("answer image quality", () => {
  for (const [name, reason] of [
    ["hotlink-block placeholder", "known_placeholder"], ["not found placeholder", "known_placeholder"],
    ["404 HTML page served as 200", "not_image"], ["1x1 pixel", "too_small"], ["120 px thumbnail", "too_small"],
    ["transparent logo", "mostly_transparent"], ["flat text-only image", "flat_or_text"],
    ["low-bytes-per-pixel blank", "low_bytes_per_pixel"], ["SVG", "unsupported_format"],
    ["animated GIF", "animated_image"], ["decompression bomb", "decode_error"],
  ] as const) test(`${name} is dropped and its reason counted`, async () => {
    const key = name === "hotlink-block placeholder" ? "hotlink.jpg" : name === "not found placeholder" ? "not-found.jpg" : name === "404 HTML page served as 200" ? "html" : name === "1x1 pixel" ? "pixel.jpg" : name === "120 px thumbnail" ? "thumbnail.jpg" : name === "transparent logo" ? "logo.png" : name === "flat text-only image" ? "flat-text.png" : name === "low-bytes-per-pixel blank" ? "blank-low-bytes.jpg" : name === "SVG" ? "svg" : name === "animated GIF" ? "animated.gif" : "bomb";
    const out = await filterAnswerImages([candidate("bad", key)]);
    if (name === "animated GIF") expect((await sharp(fixtures.get(key)!, { animated: true }).metadata()).pages).toBe(2);
    expect(out.images).toHaveLength(0);
    expect(out.dropped_by_quality).toEqual({ [reason]: 1 });
  });

  test("three sizes and two crops of one photo yield the lead, largest, sharpest picture first", async () => {
    const out = await filterAnswerImages([candidate("small", "photo-small.jpg"), candidate("crop-a", "crop-a.jpg"), candidate("medium", "photo-medium.jpg"), candidate("crop-b", "crop-b.jpg"), candidate("large", "photo.jpg")]);
    expect(out.images).toHaveLength(1);
    expect(out.images[0]!.id).toBe("large");
    const lead = await filterAnswerImages([candidate("smaller-lead", "photo-lead.jpg", true), candidate("large", "photo.jpg")]);
    expect(lead.images[0]!.id).toBe("smaller-lead");
  });
  test("genuinely different shots both survive", async () => {
    const out = await filterAnswerImages([candidate("one", "photo.jpg"), candidate("two", "different.jpg")]);
    expect(out.images.map(x => x.id)).toEqual(["one", "two"]);
  });
  test("all near-duplicates yield one picture", async () => {
    const out = await filterAnswerImages([candidate("a", "photo.jpg"), candidate("b", "crop-a.jpg"), candidate("c", "crop-b.jpg")]);
    expect(out.images).toHaveLength(1);
  });
  test("equal-size duplicates keep the sharper image", async () => {
    const out = await filterAnswerImages([candidate("blurred", "photo-blurred.jpg"), candidate("sharp", "photo.jpg")]);
    expect(out.images[0]!.id).toBe("sharp");
    expect(out.images[0]!.sharpness).toBeGreaterThan(0);
  });
  test("stock preview host is dropped and counted", async () => {
    const input = { ...candidate("stock", "photo.jpg"), sourceHost: "images.shutterstock.com" };
    const out = await filterAnswerImages([input]);
    expect(out.images).toHaveLength(0);
    expect(out.dropped_by_quality.stock_preview).toBe(1);
  });
  test("re-encode removes EXIF and GPS metadata", async () => {
    const bareJpeg = await fromPhoto(photo(5, 640, 480)).jpeg().toBuffer();
    // Write a minimal EXIF APP1 block with IFD0's GPSInfo pointer and actual
    // GPSLatitude/GPSLongitude rational tags into this synthetic JPEG.
    const tiff = Buffer.alloc(128);
    tiff.write("II", 0, "ascii"); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4);
    tiff.writeUInt16LE(1, 8);
    tiff.writeUInt16LE(0x8825, 10); tiff.writeUInt16LE(4, 12); tiff.writeUInt32LE(1, 14); tiff.writeUInt32LE(26, 18);
    tiff.writeUInt32LE(0, 22);
    tiff.writeUInt16LE(4, 26);
    const gpsEntry = (offset: number, tag: number, type: number, count: number, value: number) => {
      tiff.writeUInt16LE(tag, offset); tiff.writeUInt16LE(type, offset + 2); tiff.writeUInt32LE(count, offset + 4); tiff.writeUInt32LE(value, offset + 8);
    };
    gpsEntry(28, 1, 2, 2, 0x004e); gpsEntry(40, 2, 5, 3, 80);
    gpsEntry(52, 3, 2, 2, 0x0057); gpsEntry(64, 4, 5, 3, 104);
    tiff.writeUInt32LE(0, 76);
    [41, 52, 0, 1, 1, 1].forEach((value, i) => tiff.writeUInt32LE(value, 80 + i * 4));
    [87, 38, 0, 1, 1, 1].forEach((value, i) => tiff.writeUInt32LE(value, 104 + i * 4));
    const exif = Buffer.concat([Buffer.from("Exif\0\0", "binary"), tiff]);
    const app1 = Buffer.alloc(4 + exif.length);
    app1[0] = 0xff; app1[1] = 0xe1; app1.writeUInt16BE(2 + exif.length, 2); exif.copy(app1, 4);
    const withExif = Buffer.concat([bareJpeg.subarray(0, 2), app1, bareJpeg.subarray(2)]);
    const beforeExif = await sharp(withExif).metadata();
    expect(beforeExif.exif).toBeDefined();
    const gpsIfd = 6 + beforeExif.exif!.readUInt32LE(24);
    expect(beforeExif.exif!.readUInt16LE(gpsIfd)).toBe(4);
    expect(beforeExif.exif!.readUInt16LE(gpsIfd + 2)).toBe(1); // GPSLatitudeRef
    expect(beforeExif.exif!.readUInt16LE(gpsIfd + 14)).toBe(2); // GPSLatitude
    expect(beforeExif.exif!.readUInt16LE(gpsIfd + 26)).toBe(3); // GPSLongitudeRef
    expect(beforeExif.exif!.readUInt16LE(gpsIfd + 38)).toBe(4); // GPSLongitude
    const out = await filterAnswerImages([{ id: "exif", bytes: new Uint8Array(withExif), contentType: "image/jpeg" }]);
    expect(out.images).toHaveLength(1);
    const metadata = await sharp(out.images[0]!.full).metadata();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
  });
});
