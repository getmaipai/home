import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { composeNatural, FLOOR_LINE } from "@/lib/videos/firstPictureCompose";
import { parsePose, readPose, __setPoseVisionForTests } from "@/lib/pictures/pose";

describe("first picture natural composition", () => {
  test("cleans dark translucent outline pixels against a bright plate", async () => {
    const w = 40, h = 60;
    const rgba = Buffer.alloc(w * h * 4);
    for (let y = 10; y < 50; y++) for (let x = 10; x < 30; x++) {
      const i = (y * w + x) * 4;
      rgba[i] = 180; rgba[i + 1] = 80; rgba[i + 2] = 40; rgba[i + 3] = x === 10 || x === 29 ? 120 : 255;
      if (x === 10 || x === 29) rgba[i] = rgba[i + 1] = rgba[i + 2] = 5;
    }
    const person = await sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
    const plate = await sharp({ create: { width: 120, height: 100, channels: 3, background: { r: 240, g: 240, b: 240 } } }).png().toBuffer();
    const out = await sharp(await composeNatural(plate, [{ image: person, pose: "standing" }])).removeAlpha().raw().toBuffer();
    expect(Math.min(...out)).toBeGreaterThan(90);
  });

  const plate = () => sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 200, g: 190, b: 150 } } }).png().toBuffer();
  const figure = (r: number, g: number, b: number) => sharp({ create: { width: 60, height: 160, channels: 4, background: { r, g, b, alpha: 1 } } }).png().toBuffer();
  const lowestOpaqueRow = async (png: Buffer, plateColour: [number, number, number]) => {
    const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let low = -1;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) { const i = (y * info.width + x) * 3; if (Math.abs(data[i]! - plateColour[0]) + Math.abs(data[i + 1]! - plateColour[1]) + Math.abs(data[i + 2]! - plateColour[2]) > 150 && y > low) low = y; }
    return low;
  };

  test("colour moves toward the plate by about the set strength, and the shape is kept", async () => {
    const person = await figure(20, 40, 200);
    const mean = async (png: Buffer) => { const { data } = await sharp(png).removeAlpha().extract({ left: 190, top: 100, width: 10, height: 20 }).raw().toBuffer({ resolveWithObject: true }); return [data[0]!, data[1]!, data[2]!]; };
    const off = await mean(await composeNatural(await plate(), [{ image: person, pose: "standing" }], { labStrength: 0 }));
    const on = await mean(await composeNatural(await plate(), [{ image: person, pose: "standing" }], { labStrength: 0.4 }));
    expect(off[2]!).toBeGreaterThan(150); // blue stays blue with no shift
    expect(on[2]! - off[2]!).toBeLessThan(-8); // the blue loses some of itself toward the plate's warm tone
  });

  test("a standing person's feet are on the floor line and the head is in the frame", async () => {
    const out = await composeNatural(await plate(), [{ image: await figure(20, 40, 200), pose: "standing" }]);
    const { data, info } = await sharp(out).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const bluish = (x: number, y: number) => { const i = (y * info.width + x) * 3; return data[i + 2]! > data[i]! + 30; };
    let top = -1, bottom = -1;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) if (bluish(x, y)) { if (top < 0) top = y; bottom = y; }
    expect(top).toBeGreaterThan(0);
    expect(Math.abs(bottom - 300 * FLOOR_LINE)).toBeLessThan(6);
  });

  test("a seated person with no seat is cut by the lower edge; with a seat box they sit in it", async () => {
    const cut = await composeNatural(await plate(), [{ image: await figure(20, 40, 200), pose: "seated", seat: null }]);
    expect(await lowestOpaqueRow(cut, [200, 190, 150])).toBeGreaterThanOrEqual(295);
    const boxed = await composeNatural(await plate(), [{ image: await figure(20, 40, 200), pose: "seated", seat: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } }]);
    const { data, info } = await sharp(boxed).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const i = (Math.round(300 * 0.4) * info.width + Math.round(400 * 0.25)) * 3;
    expect(data[i + 2]!).toBeGreaterThan(data[i]!);
  });

  test("parses structured poses and safely falls back when vision fails", async () => {
    expect(parsePose("prefix {\"pose\":\"seated\"}" )).toBe("seated");
    __setPoseVisionForTests(async () => { throw new Error("offline"); });
    expect(await readPose(new Uint8Array([1, 2, 3]))).toEqual({ pose: "standing" });
    __setPoseVisionForTests(null);
  });
});
