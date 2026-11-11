import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { PACK_FRAME_PX, clampSquare, cropToPack, frameForImage, frameInClip, frameOfBox, opaqueBox, packFrameOfSource, packLandmarks, packPoint } from "@/lib/companionPackFrame";

describe("the pack frame of the rest picture (the Stack's companionCrop rule: square around the opaque box, side x 1.06, clamped inside)", () => {
  test("a box in the middle of a picture", () => {
    expect(frameOfBox({ minX: 16, minY: 8, maxX: 47, maxY: 55 }, 64, 64)).toEqual({ x: 7, y: 7, size: 51 }); // side 48 -> 51, centred on (32, 32)
  });
  test("a box touching the picture's edge is moved inside, and one as big as the picture takes all of it", () => {
    expect(frameOfBox({ minX: 0, minY: 20, maxX: 49, maxY: 69 }, 100, 100)).toEqual({ x: 0, y: 19, size: 53 }); // would start at -1
    expect(frameOfBox({ minX: 0, minY: 0, maxX: 99, maxY: 99 }, 100, 100)).toEqual({ x: 0, y: 0, size: 100 }); // 106 does not fit
    expect(frameOfBox({ minX: 80, minY: 80, maxX: 99, maxY: 99 }, 100, 100)).toEqual({ x: 78, y: 78, size: 22 }); // would run past the corner
  });
  test("no opaque pixel gives the largest centred square; a wide picture is cropped square", () => {
    expect(frameOfBox(null, 200, 100)).toEqual({ x: 50, y: 0, size: 100 });
    expect(clampSquare({ x: -5, y: 90, size: 30 }, 100, 100)).toEqual({ x: 0, y: 70, size: 30 });
  });
  test("opaqueBox counts alpha above 16 only, and packFrameOfSource keys the green out first", async () => {
    const raw = Buffer.alloc(8 * 8 * 4); raw[(2 * 8 + 3) * 4 + 3] = 255; raw[(5 * 8 + 6) * 4 + 3] = 16; raw[(6 * 8 + 6) * 4 + 3] = 17;
    expect(opaqueBox(raw, 8, 8)).toEqual({ minX: 3, minY: 2, maxX: 6, maxY: 6 });
    const picture = Buffer.alloc(64 * 64 * 4); for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) { const o = (y * 64 + x) * 4, inside = x >= 16 && x < 48 && y >= 8 && y < 56; picture[o] = inside ? 128 : 0; picture[o + 1] = inside ? 128 : 255; picture[o + 2] = inside ? 128 : 0; picture[o + 3] = 255; }
    const png = new Uint8Array(await sharp(picture, { raw: { width: 64, height: 64, channels: 4 } }).png().toBuffer());
    expect(await packFrameOfSource(png, "#00FF00")).toEqual({ frame: { x: 14, y: 4, size: 37 }, size: { width: 64, height: 64 } });
  });
});

describe("the pack frame in a clip's pixels (the rest fitted whole into the clip size, centred, key colour around it)", () => {
  const frame = { x: 105, y: 105, size: 815 };
  test("a square rest in a wide clip", () => {
    // s = 448 / 1024 = 0.4375, drawn 448x448, left offset floor((768 - 448) / 2) = 160
    expect(frameInClip(frame, { width: 1024, height: 1024 }, { width: 768, height: 448 })).toEqual({ x: 206, y: 46, size: 357 });
  });
  test("a tall rest in a wide clip", () => {
    // s = 0.4375, drawn 224x448, left offset 272
    expect(frameInClip({ x: 0, y: 100, size: 512 }, { width: 512, height: 1024 }, { width: 768, height: 448 })).toEqual({ x: 272, y: 44, size: 224 });
  });
  test("a crop touching the rest's edge stays touching the drawn picture's edge", () => {
    expect(frameInClip({ x: 0, y: 512, size: 512 }, { width: 1024, height: 1024 }, { width: 768, height: 448 })).toEqual({ x: 160, y: 224, size: 224 }); // left and bottom edges of the drawn picture
    expect(frameInClip({ x: 512, y: 0, size: 512 }, { width: 1024, height: 1024 }, { width: 768, height: 448 })).toEqual({ x: 384, y: 0, size: 224 }); // right and top edges
  });
  test("a rest of the clip's own size maps one to one, and a rest picture smaller than the clip is scaled up", () => {
    expect(frameInClip({ x: 10, y: 20, size: 100 }, { width: 640, height: 480 }, { width: 640, height: 480 })).toEqual({ x: 10, y: 20, size: 100 });
    expect(frameInClip({ x: 10, y: 20, size: 100 }, { width: 320, height: 240 }, { width: 640, height: 480 })).toEqual({ x: 20, y: 40, size: 200 });
  });
});

describe("points, landmarks and pictures into the pack frame", () => {
  const frame = { x: 7, y: 7, size: 51 }, dims = { width: 64, height: 64 };
  test("x' = (x - frame.x) * 480 / size, same for y, extra numbers kept", () => {
    expect(packPoint(frame, dims, dims, [10, 10])).toEqual([(10 - 7) * 480 / 51, (10 - 7) * 480 / 51]);
    expect(packPoint(frame, dims, dims, [7, 58])).toEqual([0, 51 * 480 / 51]);
    expect(packPoint(frame, dims, dims, [1, 2, 9])[2]).toBe(9);
    // a picture twice as big as the source: its pixel (20, 20) is source pixel (10, 10)
    expect(packPoint(frame, dims, { width: 128, height: 128 }, [20, 20])).toEqual(packPoint(frame, dims, dims, [10, 10]));
  });
  test("landmark lists move, other fields stay", () => {
    const out = packLandmarks({ outerLips: [[10, 10], [30, 18]], nose: [[20, 8]], note: "x", ratio: 0.3, empty: [] }, frame, dims, dims);
    expect(out.outerLips[1]![0]).toBeCloseTo((30 - 7) * 480 / 51, 6); expect(out.outerLips[1]![1]).toBeCloseTo((18 - 7) * 480 / 51, 6);
    expect(out.nose[0]![1]).toBeCloseTo(1 * 480 / 51, 6); expect(out.note).toBe("x"); expect(out.ratio).toBe(0.3); expect(out.empty).toEqual([]);
  });
  test("frameForImage keeps the frame for the same size and scales it for another", () => {
    expect(frameForImage(frame, dims, dims)).toBe(frame);
    expect(frameForImage({ x: 8, y: 8, size: 32 }, dims, { width: 128, height: 128 })).toEqual({ x: 16, y: 16, size: 64 });
  });
  test("cropToPack gives 480x480 RGBA with the alpha kept and the crop's pixels", async () => {
    const raw = Buffer.alloc(64 * 64 * 4); for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) { const o = (y * 64 + x) * 4; raw[o] = x < 16 ? 255 : 0; raw[o + 1] = 0; raw[o + 2] = 200; raw[o + 3] = y < 16 ? 0 : 255; }
    const png = new Uint8Array(await sharp(raw, { raw: { width: 64, height: 64, channels: 4 } }).png().toBuffer());
    const out = sharp(await cropToPack(png, { x: 16, y: 16, size: 32 }, dims)), meta = await out.metadata();
    expect([meta.width, meta.height, meta.channels]).toEqual([PACK_FRAME_PX, PACK_FRAME_PX, 4]);
    const px = await out.raw().toBuffer();
    expect([px[0], px[2], px[3]]).toEqual([0, 200, 255]); // the red strip (x < 16) and the clear strip (y < 16) are outside the crop
    const whole = sharp(await cropToPack(png, { x: 0, y: 0, size: 64 }, dims)); const all = await whole.raw().toBuffer();
    expect(all[3]).toBe(0); expect(all[(300 * 480) * 4]).toBe(255); // top row clear; left strip red lower down
  });
});

import { bandOfFrame, frameInBand, headshotFrame, PACK_CLIP_ASPECT } from "@/lib/companionPackFrame";
describe("the headshot frame (clips start from a bar-free band of the picture: found on the first real pack)", () => {
  test("the frame is the square in the middle of a full-width band at the clip aspect, starting 10 percent above the head", () => {
    const f = headshotFrame({ minX: 256, minY: 128, maxX: 767, maxY: 895 }, 1024, 1024);
    expect(f).toEqual({ x: 214, y: 68, size: 597 }); expect(f.size).toBe(Math.round(1024 / PACK_CLIP_ASPECT));
  });
  test("the band is as wide as the clip needs and the pack frame is exactly the middle square of the clip made from it", () => {
    const f = { x: 214, y: 68, size: 597 }, band = bandOfFrame(f, { width: 1024, height: 1024 }, { width: 768, height: 448 });
    expect(band).toEqual({ x: 1, y: 68, width: 1023, height: 597 }); // the band is as wide as the clip aspect needs (rounded), inside the 1024 picture
    expect(frameInBand(f, band, { width: 768, height: 448 })).toEqual({ x: 160, y: 0, size: 448 });
  });
  test("a head near the top of the picture or a picture shorter than the band stay inside the picture", () => {
    expect(headshotFrame({ minX: 300, minY: 0, maxX: 700, maxY: 900 }, 1024, 1024).y).toBe(0);
    const f = headshotFrame({ minX: 100, minY: 10, maxX: 300, maxY: 400 }, 1000, 500);
    expect(f.y + f.size).toBeLessThanOrEqual(500); expect(f.x).toBeGreaterThanOrEqual(0);
  });
});
