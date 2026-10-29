import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { borderLooksKeyed, compositeOnNeutral, cutOutBackground } from "./backdrop";
import { fillCutOffInstruction, restyleInstruction } from "./instructions";
import { planFillCutOff } from "./fill";

const solid = async (r: number, g: number, b: number) => new Uint8Array(await sharp({ create: { width: 64, height: 64, channels: 3, background: { r, g, b } } }).png().toBuffer());

describe("backdrop", () => {
  test("borderLooksKeyed is true for a key-coloured ring and false for a backdrop the model drew itself", async () => {
    expect(await borderLooksKeyed(await solid(0, 255, 0), [0, 255, 0])).toBe(true);
    expect(await borderLooksKeyed(await solid(150, 165, 160), [0, 255, 0])).toBe(false);
    expect(await borderLooksKeyed(await solid(150, 165, 160), [255, 0, 255])).toBe(false);
  });
  test("compositeOnNeutral flattens transparency onto light grey", async () => {
    const clear = new Uint8Array(await sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer());
    const raw = await sharp(await compositeOnNeutral(clear)).raw().toBuffer();
    expect([raw[0], raw[1], raw[2]]).toEqual([217, 217, 217]);
  });
  test("cutOutBackground keys a keyed picture, lifts any other with the remover, and keeps the picture when the remover fails", async () => {
    const green = await solid(0, 255, 0), grey = await solid(150, 165, 160), lifted = await solid(1, 2, 3), keyed = await solid(9, 9, 9);
    const key = { rgb: [0, 255, 0] as const, strip: async () => keyed };
    expect(await cutOutBackground(green, { remove: async () => lifted, key })).toBe(keyed);
    expect(await cutOutBackground(grey, { remove: async () => lifted, key })).toBe(lifted);
    expect(await cutOutBackground(grey, { remove: async () => { throw new Error("no remover"); }, key })).toBe(grey);
  });
});

describe("instructions and fill plan", () => {
  test("every instruction carries the face and whole-body wording", () => {
    for (const text of [restyleInstruction(), fillCutOffInstruction(["bottom"])]) { expect(text).toContain("identical face"); expect(text).toContain("both arms and hands"); }
    expect(fillCutOffInstruction(["left", "bottom"])).toContain("at the left, bottom");
  });
  test("planFillCutOff trusts the stored edges and returns null when nothing is cut off", async () => {
    const plan = await planFillCutOff(await solid(10, 10, 10), ["bottom"]);
    expect(plan?.edges).toEqual(["bottom"]); expect(plan?.instruction).toContain("at the bottom");
    const clear = new Uint8Array(await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: await sharp({ create: { width: 20, height: 20, channels: 4, background: { r: 200, g: 0, b: 0, alpha: 1 } } }).png().toBuffer(), left: 22, top: 22 }]).png().toBuffer());
    expect(await planFillCutOff(clear)).toBeNull();
  });
});
