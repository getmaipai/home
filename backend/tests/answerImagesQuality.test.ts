import { describe, expect, test, beforeAll } from "bun:test";
import sharp, { type Sharp } from "sharp";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { filterAnswerImages, hashes, nearestDistance } from "@/lib/answerImages/quality";

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

// IMGQ-01 (design: data-scratch/research/image-quality-design.md section 4):
// two real 64-bit hashes (DCT pHash and dHash) over the full frame, centre
// crops and the mirror, threshold 10. The old "pHash" was a 256-bit
// blockhash judged against a 64-bit threshold.
// A photo-like synthetic: six seed-dependent waves (the low frequencies a
// perceptual hash reads) under a fine texture. The sawtooth `photo` above is
// the same grey ramp for every seed once scaled down, so crops of it do not
// behave like crops of a real photo.
const smoothPhoto = (seed: number, width = 720, height = 540) => {
  let state = (seed * 0x9e3779b9) >>> 0;
  const rnd = () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const waves = Array.from({ length: 6 }, () => ({ a: rnd() * 2 * Math.PI, f: 0.6 + rnd() * 2.2, p: rnd() * 2 * Math.PI, c: [rnd(), rnd(), rnd()] }));
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 3;
    for (let ch = 0; ch < 3; ch++) {
      let v = 0;
      for (const w of waves) v += w.c[ch]! * Math.sin(2 * Math.PI * w.f * ((x / width) * Math.cos(w.a) + (y / height) * Math.sin(w.a)) + w.p);
      data[i + ch] = Math.max(0, Math.min(255, Math.round(128 + 40 * v + ((x * 7 + y * 3 + ch * 11) % 17) - 8)));
    }
  }
  return sharp(data, { raw: { width, height, channels: 3 } });
};

describe("IMGQ-01: near-duplicates by pHash and dHash", () => {
  const variant = async (fn: (s: Sharp) => Sharp) => new Uint8Array(await fn(smoothPhoto(2)).jpeg({ quality: 85 }).toBuffer());
  const jpeg = (id: string, bytes: Uint8Array) => ({ id, bytes, contentType: "image/jpeg" });

  test("a 75 percent centre crop, a 6 percent border, a mirror and a watermarked copy each collapse into the original", async () => {
    const original = new Uint8Array(await smoothPhoto(2).jpeg({ quality: 88 }).toBuffer());
    const copies = {
      crop75: await variant((s) => s.extract({ left: 90, top: 68, width: 540, height: 405 })),
      border: await variant((s) => s.extend({ top: 32, bottom: 32, left: 43, right: 43, background: "#ffffff" })),
      mirror: await variant((s) => s.flop()),
      watermark: await variant((s) => s.composite([{ input: Buffer.from('<svg width="720" height="540"><text x="120" y="300" font-size="72" fill="white" fill-opacity="0.5" transform="rotate(-20 360 270)">SAMPLE</text></svg>') }])),
    };
    for (const [name, bytes] of Object.entries(copies)) {
      const out = await filterAnswerImages([jpeg("original", original), jpeg(name, bytes)]);
      expect({ name, kept: out.images.length, duplicate: out.dropped_by_quality.duplicate }).toEqual({ name, kept: 1, duplicate: 1 });
    }
  });

  test("different shots are more than 10 bits apart and all survive", async () => {
    const shots = await Promise.all([2, 8, 11, 17].map(async (seed) => new Uint8Array(await smoothPhoto(seed).jpeg().toBuffer())));
    const hs = await Promise.all(shots.map(hashes));
    for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) expect(nearestDistance(hs[i]!, hs[j]!)).toBeGreaterThan(10);
    const out = await filterAnswerImages(shots.map((b, i) => jpeg(`s${i}`, b)));
    expect(out.images).toHaveLength(4);
  });

  test("each hash is 64 bits, not the old 256-bit blockhash", async () => {
    const h = await hashes(fixtures.get("photo.jpg")!);
    expect(h.full.d).toMatch(/^[01]{64}$/);
    expect(h.full.p).toMatch(/^[01]{64}$/);
  });
});

// IMGQ-02 (design section 6): the placeholder floor.
describe("IMGQ-02: placeholders, low-byte frames and screen captures", () => {
  test("a 600x400 two-colour 'image not found' card is dropped as flat (entropy under 3 bits)", async () => {
    const card = await sharp({ create: { width: 600, height: 400, channels: 3, background: "#dddddd" } }).composite([{ input: Buffer.from('<svg width="600" height="400"><rect x="200" y="150" width="200" height="100" fill="#999999"/></svg>') }]).png().toBuffer();
    const out = await filterAnswerImages([{ id: "card", bytes: new Uint8Array(card), contentType: "image/png" }]);
    expect(out.dropped_by_quality).toEqual({ flat_or_text: 1 });
  });

  test("a 2 MP WebP under 0.015 bytes per pixel is dropped; a real photo WebP passes", async () => {
    const blur = await sharp({ create: { width: 1600, height: 1250, channels: 3, background: "#7a8a9a" } }).webp({ quality: 5 }).toBuffer();
    expect(blur.byteLength / (1600 * 1250)).toBeLessThan(0.015);
    const photoWebp = await fromPhoto(photo(4, 720, 540)).webp({ quality: 80 }).toBuffer();
    const out = await filterAnswerImages([{ id: "blur", bytes: new Uint8Array(blur), contentType: "image/webp" }, { id: "photo", bytes: new Uint8Array(photoWebp), contentType: "image/webp" }]);
    expect(out.images.map((i) => i.id)).toEqual(["photo"]);
    expect(Object.values(out.dropped_by_quality).reduce((a, b) => a + (b ?? 0), 0)).toBe(1);
  });

  test("a PNG at a screen size with a camera's EXIF is a photo, not a screen capture", async () => {
    const big = fromPhoto(photo(6, 1920, 1080));
    const bare = await big.clone().png().toBuffer();
    const camera = await big.clone().withExif({ IFD0: { Make: "Example Camera" } }).png().toBuffer();
    expect((await sharp(camera).metadata()).exif).toBeDefined();
    const out = await filterAnswerImages([{ id: "bare", bytes: new Uint8Array(bare), contentType: "image/png" }, { id: "camera", bytes: new Uint8Array(camera), contentType: "image/png" }]);
    expect(out.dropped_by_quality.screenshot).toBe(1);
    expect(out.images.map((i) => i.id)).toEqual(["camera"]);
  });
});
