import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { makeSheetFromPictures, type SheetTools } from "@/lib/films/sheetMaker";

const solid = async (r: number, g: number, b: number, width = 400, height = 300) => new Uint8Array(await sharp({ create: { width, height, channels: 3, background: { r, g, b } } }).png().toBuffer());
// A fake background remover: a red block on transparency, as if the subject had been cut out.
const tools: SheetTools = {
  removeBackground: async () => new Uint8Array(await sharp({ create: { width: 120, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: { create: { width: 100, height: 280, channels: 4, background: { r: 200, g: 10, b: 10, alpha: 1 } } }, left: 10, top: 10 }]).png().toBuffer()),
  findFaces: async () => [{ x: 150, y: 20, w: 40, h: 50 }],
};
async function pixel(png: Uint8Array, x: number, y: number) { const { data, info } = await sharp(Buffer.from(png)).raw().toBuffer({ resolveWithObject: true }); const at = (y * info.width + x) * info.channels; return [data[at]!, data[at + 1]!, data[at + 2]!]; }

describe("sheet from pictures", () => {
  test("a person, an object and a place make cut-out panels on white and a full-height place panel", async () => {
    const sheet = await makeSheetFromPictures([
      { bytes: await solid(1, 1, 1), mediaType: "image/png", name: "girl", role: "actor", look: "a girl in a cream jacket" },
      { bytes: await solid(2, 2, 2), mediaType: "image/png", name: "can", role: "product", look: "a red can" },
      { bytes: await solid(20, 20, 200, 800, 450), mediaType: "image/png", name: "door", role: "set", look: "a glossy red door" },
    ], tools);
    const meta = await sharp(Buffer.from(sheet.png)).metadata();
    expect([meta.width, meta.height]).toEqual([768, 448]);
    expect(await pixel(sheet.png, 760, 440)).toEqual([20, 20, 200]);       // the place fills the right column
    expect(await pixel(sheet.png, 2, 2)).toEqual([255, 255, 255]);          // subjects sit on white
    expect(sheet.panels.map((panel) => `${panel.view}`)).toEqual(["Front View", "Face Close-up", "Front View", "Setting"]);
    expect(sheet.description.startsWith("Reference sheet: ")).toBe(true);
    expect(sheet.description).toContain("(Character, Front View): a girl in a cream jacket");
    expect(sheet.description).toContain("(Character, Face Close-up): a girl in a cream jacket");
    expect(sheet.description).toContain("(Prop, Front View): a red can");
    expect(sheet.description).toContain("Far Right (Setting): a glossy red door");
  });
  test("a failed cut-out falls back to the picture itself and a sheet with only places still builds", async () => {
    const broken: SheetTools = { removeBackground: async () => { throw new Error("no"); }, findFaces: async () => [] };
    const sheet = await makeSheetFromPictures([{ bytes: await solid(9, 9, 9), mediaType: "image/png", name: "mug", role: "product", look: "a white mug" }], broken);
    expect(sheet.panels).toHaveLength(1);
    const onlyPlace = await makeSheetFromPictures([{ bytes: await solid(5, 5, 200), mediaType: "image/png", name: "hall", role: "end_shot", look: "a glass hall" }], broken);
    expect(onlyPlace.description).toContain("Far Right (Setting): a glass hall");
  });
});

describe("sheet views the photos do not show", () => {
  const photo = async () => ({ bytes: await solid(1, 1, 1), mediaType: "image/png", look: "a woman in a cream coat" });
  test("a single person and an object get their drawn views after the originals", async () => {
    const calls: string[] = [];
    const viewTools = { editView: async (_ref: unknown, instruction: string) => { calls.push(instruction.split(",")[0]!); return solid(120, 120, 120, 200, 300); }, faceMatch: async () => 0.7 };
    const sheet = await makeSheetFromPictures([
      { ...(await photo()), name: "woman", role: "actor" },
      { bytes: await solid(2, 2, 2), mediaType: "image/png", name: "card", role: "product", look: "a black graphics card" },
    ], tools, { drawViews: true, viewTools });
    expect(sheet.panels.map((panel) => panel.view)).toEqual(["Front View", "Face Close-up", "Front View", "Clean Front View", "Side View", "Angled View"]);
    expect(calls).toHaveLength(3);
  });
  test("a clean front whose face does not match is dropped and a view that cannot be made is left out", async () => {
    const viewTools = { editView: async (_ref: unknown, instruction: string) => (instruction.includes("profile") ? null : solid(9, 9, 9, 200, 300)), faceMatch: async () => 0.1 };
    const sheet = await makeSheetFromPictures([{ ...(await photo()), name: "woman", role: "actor" }], tools, { drawViews: true, viewTools });
    expect(sheet.panels.map((panel) => panel.view)).toEqual(["Front View", "Face Close-up"]);
  });
  test("a photo of two people is split first: each person is described alone and drawn from their own cut-out, never from the merged photo", async () => {
    const twoFaces: SheetTools = { ...tools, findFaces: async () => [{ x: 60, y: 30, w: 40, h: 50 }, { x: 300, y: 30, w: 40, h: 50 }], describe: (() => { let n = 0; return async () => (n++ === 0 ? { name: "woman in a cream coat", look: "a woman with long dark hair in a cream coat" } : { name: "man in a black jacket", look: "a man with short gray hair in a black jacket" }); })() };
    const references: Array<{ width: number; height: number }> = [];
    const viewTools = { editView: async (ref: { bytes: Uint8Array }) => { const meta = await sharp(Buffer.from(ref.bytes)).metadata(); references.push({ width: meta.width ?? 0, height: meta.height ?? 0 }); return solid(120, 120, 120, 200, 300); }, faceMatch: async () => 0.8 };
    const sheet = await makeSheetFromPictures([{ bytes: await solid(7, 7, 7, 400, 300), mediaType: "image/png", name: "a man and a woman together", role: "actor", look: "a man and a woman side by side" }], twoFaces, { drawViews: true, viewTools });
    expect(sheet.description).toContain("a woman with long dark hair in a cream coat");
    expect(sheet.description).toContain("a man with short gray hair in a black jacket");
    expect(sheet.description).not.toContain("a man and a woman side by side");
    expect(references).toHaveLength(4); // two persons x (clean front, side view), each from that person's own cut-out
    expect(sheet.panels.filter((panel) => panel.name === "woman in a cream coat").length).toBeGreaterThan(1);
    expect(sheet.panels.filter((panel) => panel.name === "man in a black jacket").length).toBeGreaterThan(1);
  });
  test("a person photo the face finder could not read is never drawn from", async () => {
    let calls = 0;
    const noFaces: SheetTools = { ...tools, findFaces: async () => [] };
    const viewTools = { editView: async () => { calls += 1; return solid(9, 9, 9, 200, 300); }, faceMatch: async () => 0.99 };
    const sheet = await makeSheetFromPictures([{ ...(await photo()), name: "pair", role: "actor" }], noFaces, { drawViews: true, viewTools });
    expect(sheet.panels.map((panel) => panel.view)).toEqual(["Front View"]);
    expect(calls).toBe(0);
  });
});

describe("sheet position names match the sheet", () => {
  test("a two-row sheet is named Top and Bottom, never Middle, so a prompt can point at a panel that exists", async () => {
    const pics = await Promise.all([1, 2, 3, 4].map(async (n) => ({ bytes: await solid(n * 20, 5, 5), mediaType: "image/png", name: `thing ${n}`, role: "product" as const, look: `object number ${n}` })));
    const sheet = await makeSheetFromPictures(pics, tools);
    expect(sheet.panels.map((panel) => panel.slot)).toEqual(["Top Left", "Top Right", "Bottom Left", "Bottom Right"]);
    expect(sheet.description).not.toContain("Middle");
  });
});
