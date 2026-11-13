import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { cleanJunk, deriveJunkRegion, type JunkTools } from "@/lib/films/junkCleanup";
import { cutOutPause, makeSheetFromPictures, type SheetTools } from "@/lib/films/sheetMaker";

cutOutPause.ms = 0;
const W = 200, H = 200, FACE = { x: 40, y: 30, w: 50, h: 60 };
/** A cut-out: this person (a textured block with a face), a neighbour's strip at the right edge, and a stray speck far away. */
async function cutOutWithJunk(): Promise<Buffer> {
  const raw = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = (y * W + x) * 4, own = x >= 20 && x < 130 && y >= 10, junk = x >= 150 && x < 190 && y >= 40 && y < 150, speck = x >= 5 && x < 12 && y >= 5 && y < 10;
    if (own) { raw[p] = (x * 7 + y * 3) % 200; raw[p + 1] = (x * 5) % 180; raw[p + 2] = 90; raw[p + 3] = 255; }
    else if (junk) { raw[p] = 10; raw[p + 1] = 10; raw[p + 2] = 10; raw[p + 3] = 255; }
    else if (speck) { raw[p] = 50; raw[p + 1] = 50; raw[p + 2] = 50; raw[p + 3] = 255; }
  }
  return sharp(raw, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
}
const alphaOf = async (png: Buffer) => { const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return Uint8Array.from({ length: data.length / 4 }, (_, p) => data[p * 4 + 3]!); };
// A good removal: only the dark neighbour and the speck inside the editable region turn white; the person's own block (blue 90) stays.
const whiteInMask = async (png: Uint8Array, mask: Uint8Array) => { const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true }); for (let p = 0; p < mask.length; p++) if (mask[p] && data[p * 3 + 2]! < 80) { data[p * 3] = 255; data[p * 3 + 1] = 255; data[p * 3 + 2] = 255; } return new Uint8Array(await sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toBuffer()); };
const fakeTools = (over: Partial<JunkTools> = {}): JunkTools => ({
  findFaces: async () => [FACE],
  // The fake editor paints the editable region white (what a good removal looks like).
  editMasked: async (png, mask) => whiteInMask(png, mask),
  faceSimilarity: async () => 0.99,
  ...over,
});

describe("junk region", () => {
  test("covers the neighbour's side, other faces and specks, and never the own face box", async () => {
    const cut = await cutOutWithJunk();
    const alpha = await alphaOf(cut);
    const region = deriveJunkRegion({ alpha, width: W, height: H, own: FACE, others: [], neighbours: ["right"] });
    const at = (mask: Uint8Array, x: number, y: number) => mask[y * W + x]!;
    expect(at(region.editable, 170, 80)).toBe(255);   // the neighbour's strip
    expect(at(region.editable, 8, 7)).toBe(255);      // the speck
    expect(at(region.editable, 60, 60)).toBe(0);      // the own face
    expect(at(region.editable, 30, 100)).toBe(0);     // the own body on the far side
    for (let p = 0; p < region.editable.length; p++) if (region.protect[p]) expect(region.editable[p]).toBe(0);
    expect(region.junkArea).toBeGreaterThan(40 * 110);
  });
  test("another face found inside the cut-out is junk with some room around it, and a photo with no neighbour side and no specks has no junk", async () => {
    const cut = await cutOutWithJunk();
    const alpha = await alphaOf(cut);
    const withOther = deriveJunkRegion({ alpha, width: W, height: H, own: FACE, others: [{ x: 150, y: 50, w: 30, h: 30 }], neighbours: [] });
    expect(withOther.editable[60 * W + 160]).toBe(255);
    const clean = Uint8Array.from(alpha, (a, p) => (p % W >= 20 && p % W < 130 && a ? 255 : 0));
    expect(deriveJunkRegion({ alpha: clean, width: W, height: H, own: FACE, others: [], neighbours: [] }).junkArea).toBe(0);
  });
});

describe("cleanJunk", () => {
  test("removes the junk, leaves the face pixel for pixel, and reports the checks", async () => {
    const cut = await cutOutWithJunk();
    const result = await cleanJunk(cut, ["right"], fakeTools());
    expect(result.kind).toBe("cleaned");
    if (result.kind !== "cleaned") return;
    expect(result.junkAfter).toBeLessThan(result.junkBefore);
    expect(result.faceSsim).toBeGreaterThanOrEqual(0.98);
    const out = await sharp(result.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(out.info.width).toBeLessThan(W);              // trimmed: the neighbour strip and speck are gone
    // The face pixels equal the cut-out's: the own block starts at x=20, y=10 and is trimmed to that corner.
    const orig = await sharp(cut).ensureAlpha().raw().toBuffer();
    for (const [x, y] of [[45, 40], [60, 60], [85, 85]] as const) for (let c = 0; c < 4; c++) expect(out.data[((y - 10) * out.info.width + (x - 20)) * 4 + c]).toBe(orig[(y * W + x) * 4 + c]!);
  });
  test("an edit that redraws the face is refused (the mask never lets the face change, and a redraw elsewhere is not used)", async () => {
    const cut = await cutOutWithJunk();
    const redraw = fakeTools({ editMasked: async (png, mask) => { const painted = await whiteInMask(png, mask); const { data } = await sharp(painted).raw().toBuffer({ resolveWithObject: true }); for (let y = 30; y < 90; y++) for (let x = 40; x < 90; x++) { data[(y * W + x) * 3] = 255 - data[(y * W + x) * 3]!; } return new Uint8Array(await sharp(data, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer()); } });
    const result = await cleanJunk(cut, ["right"], redraw);
    expect(result.kind).toBe("cleaned"); // the redrawn face pixels are never copied: only whiteness inside the junk region removes anything
    if (result.kind === "cleaned") expect(result.faceSsim).toBeGreaterThanOrEqual(0.98);
  });
  test("a changed face likeness, an edit that removes nothing, an edit that errors and a face that cannot be checked all fail and keep the plain cut-out", async () => {
    const cut = await cutOutWithJunk();
    expect((await cleanJunk(cut, ["right"], fakeTools({ faceSimilarity: async () => 0.8 }))).kind).toBe("failed");
    expect((await cleanJunk(cut, ["right"], fakeTools({ faceSimilarity: async () => null }))).kind).toBe("failed");
    expect((await cleanJunk(cut, ["right"], fakeTools({ editMasked: async (png) => new Uint8Array(png) }))).kind).toBe("failed");
    expect((await cleanJunk(cut, ["right"], fakeTools({ editMasked: async () => { throw new Error("busy"); } }))).kind).toBe("failed");
    expect((await cleanJunk(cut, ["right"], fakeTools({ findFaces: async () => [] }))).kind).toBe("kept");
  });
  test("an edit that wipes out most of the person is refused", async () => {
    const cut = await cutOutWithJunk();
    const result = await cleanJunk(cut, ["left", "right"], fakeTools({ findFaces: async () => [{ x: 60, y: 30, w: 10, h: 20 }], editMasked: async (png, mask) => { const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true }); for (let p = 0; p < mask.length; p++) if (mask[p]) data.fill(255, p * 3, p * 3 + 3); return new Uint8Array(await sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toBuffer()); } }));
    expect(result.kind).toBe("failed");
  });
});

describe("sheet maker uses it only for a split photo", () => {
  const photo = async () => new Uint8Array(await sharp({ create: { width: 600, height: 300, channels: 3, background: { r: 1, g: 1, b: 1 } } }).png().toBuffer());
  const remover = async () => new Uint8Array(await cutOutWithJunk());
  const base = (faces: Array<{ x: number; y: number; w: number; h: number }>): SheetTools => ({ removeBackground: remover, findFaces: async (bytes) => ((await sharp(Buffer.from(bytes)).metadata()).width === 600 ? faces : [FACE]) });
  const picture = async () => ({ bytes: await photo(), mediaType: "image/png", name: "pair", role: "actor" as const, look: "two people" });
  test("two faces: each person is cleaned and the sheet has no note", async () => {
    let calls = 0;
    const tools: SheetTools = { ...base([{ x: 100, y: 60, w: 40, h: 50 }, { x: 400, y: 60, w: 40, h: 50 }]), junk: { editMasked: async (png, mask) => { calls++; return whiteInMask(png, mask); }, faceSimilarity: async () => 0.99 } };
    const sheet = await makeSheetFromPictures([await picture()], tools);
    expect(calls).toBe(2);
    expect(sheet.notes).toEqual([]);
  });
  test("a failed cleanup keeps the plain cut-out and says so in plain words", async () => {
    const tools: SheetTools = { ...base([{ x: 100, y: 60, w: 40, h: 50 }, { x: 400, y: 60, w: 40, h: 50 }]), junk: { editMasked: async () => { throw new Error("busy"); }, faceSimilarity: async () => 0.99 } };
    const sheet = await makeSheetFromPictures([await picture()], tools);
    expect(sheet.panels.length).toBeGreaterThan(1);
    expect(sheet.notes.filter((note) => note.includes("could not be cleaned off")).length).toBe(2);
  });
  test("one face: the plain cut-out is used and the editor is never called", async () => {
    let calls = 0;
    const tools: SheetTools = { ...base([{ x: 100, y: 60, w: 40, h: 50 }]), junk: { editMasked: async (png) => { calls++; return new Uint8Array(png); }, faceSimilarity: async () => 1 } };
    const sheet = await makeSheetFromPictures([await picture()], tools);
    expect(calls).toBe(0);
    expect(sheet.notes).toEqual([]);
  });
});
