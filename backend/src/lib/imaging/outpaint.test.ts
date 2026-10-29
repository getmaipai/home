import { expect, test } from "bun:test";
import sharp from "sharp";
import { OUTPAINT_CANVAS, pasteHead, planBodyCanvas } from "./outpaint";

// A "person": a skin-coloured face on top of a blue shirt, cut off by the left, right and bottom of the frame.
async function headAndShoulders(): Promise<Uint8Array> {
  const face = await sharp({ create: { width: 500, height: 520, channels: 4, background: { r: 200, g: 140, b: 100, alpha: 1 } } }).png().toBuffer();
  const shirt = await sharp({ create: { width: 1024, height: 400, channels: 4, background: { r: 90, g: 130, b: 200, alpha: 1 } } }).png().toBuffer();
  return new Uint8Array(await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: shirt, left: 0, top: 624 }, { input: face, left: 262, top: 100 }]).png().toBuffer());
}
const pixel = async (png: Uint8Array, x: number, y: number) => { const { data, info } = await sharp(Buffer.from(png)).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); const at = (y * info.width + x) * 4; return [data[at]!, data[at + 1]!, data[at + 2]!, data[at + 3]!]; };

test("a picture cut off at the bottom is placed small on a plain canvas with a mask that keeps it and the band above it", async () => {
  const plan = await planBodyCanvas(await headAndShoulders(), ["left", "right", "bottom"]);
  expect(plan).not.toBeNull();
  expect((await sharp(Buffer.from(plan!.canvas)).metadata()).width).toBe(OUTPAINT_CANVAS);
  const top = Math.round(OUTPAINT_CANVAS * 0.06);
  expect((await pixel(plan!.mask, 10, 10))[0]).toBe(0); // the band above the picture is kept
  expect((await pixel(plan!.mask, 512, top + 40))[0]).toBe(0); // the picture itself is kept
  expect((await pixel(plan!.mask, 512, 800))[0]).toBe(255); // the empty area below is painted
  expect((await pixel(plan!.canvas, 512, 900)).slice(0, 3)).toEqual([217, 217, 217]);
});

test("a picture that is not cut off at the bottom is left to the ordinary fill", async () => {
  expect(await planBodyCanvas(await headAndShoulders(), ["left", "right"])).toBeNull();
});

test("pasting the head puts the person's own pixels back over whatever the model drew, and fades out below the chin", async () => {
  const plan = (await planBodyCanvas(await headAndShoulders(), ["left", "right", "bottom"]))!;
  const drawn = new Uint8Array(await sharp({ create: { width: 1024, height: 1024, channels: 3, background: { r: 10, g: 200, b: 10 } } }).png().toBuffer());
  const pasted = await pasteHead(drawn, plan.head);
  const top = Math.round(OUTPAINT_CANVAS * 0.06);
  expect((await pixel(pasted, 512, top + 20)).slice(0, 3)).toEqual([200, 140, 100]); // the face is the original's
  expect((await pixel(pasted, 512, 900)).slice(0, 3)).toEqual([10, 200, 10]); // the body is the model's
});
