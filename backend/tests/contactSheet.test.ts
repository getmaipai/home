// CONTACT-SHEET-01: one sheet for any Library pictures and clips (grid, video frames, compare), saved as a new Library picture.
import { beforeEach, describe, expect, test } from "bun:test";
import sharp from "sharp";
import { storeFile, readAttachment } from "@/lib/attachments";
import { composeContactSheet, makeContactSheet, __setSheetFramesForTests, SheetError, SHEET_MAX_FILES } from "@/lib/contactSheet";
import { resetDb } from "./reset-db";
import { owner, child } from "./support/testAuth";
import type { PersonRow } from "@/types";

const solid = async (r: number, g: number, b: number, w = 200, h = 120) => new Uint8Array(await sharp({ create: { width: w, height: h, channels: 3, background: { r, g, b } } }).png().toBuffer());
function put(actor: PersonRow, bytes: Uint8Array, mediaType: string, name: string, provenance = "library:upload"): string {
  const stored = storeFile(actor, { conversationId: null, turnId: null, mediaType, bytes, provenance, retention: "kept", name, deduplicate: false });
  if (!stored.ok) throw new Error(stored.error);
  return stored.value.id;
}

beforeEach(() => { resetDb(); __setSheetFramesForTests(null); });

describe("composeContactSheet", () => {
  test("lays tiles out in columns with a title and captions", async () => {
    const a = await solid(200, 30, 30), b = await solid(30, 200, 30);
    const made = await composeContactSheet([{ caption: "a red fox", tiles: [{ bytes: a, label: "FLUX 3", sub: "1024x1024 · 18 s" }, { bytes: b, label: "H3-Image" }] }], { columns: 2, cell: 200, title: "FLUX 3 vs H3" });
    const meta = await sharp(Buffer.from(made.png)).metadata();
    expect(meta.width).toBe(20 * 2 + 2 * 200 + 12);
    expect(meta.height).toBe(made.height);
    expect(made.tiles).toBe(2);
    expect(made.height).toBeGreaterThan(200 + 54 + 34);
  });
  test("refuses an empty sheet in plain words", async () => {
    await expect(composeContactSheet([{ tiles: [] }])).rejects.toThrow("Choose at least one picture or clip");
  });
});

describe("makeContactSheet", () => {
  test("a grid of library pictures becomes one new kept picture", async () => {
    const { row } = await owner();
    const ids = [put(row, await solid(250, 0, 0), "image/png", "one.png"), put(row, await solid(0, 250, 0), "image/png", "two.png"), put(row, await solid(0, 0, 250), "image/png", "three.png")];
    const made = await makeContactSheet(row, { ids, columns: 3, title: "Three" });
    expect(made.tiles).toBe(3);
    const read = readAttachment(row, made.id);
    expect(read.ok && read.value.record.media_type).toBe("image/png");
    expect(read.ok && read.value.record.retention).toBe("kept");
    expect(ids).not.toContain(made.id);
  });
  test("a clip contributes frames, with its name as the caption", async () => {
    const { row } = await owner();
    __setSheetFramesForTests(async (_mp4, _s, count) => Promise.all(Array.from({ length: count ?? 3 }, (_, i) => solid(40 * i, 90, 160))));
    const clip = put(row, new Uint8Array([0, 0, 0, 24]), "video/mp4", "fox.mp4");
    const made = await makeContactSheet(row, { ids: [clip], perClip: 4 });
    expect(made.tiles).toBe(4);
    expect(made.files).toBe(1);
  });
  test("compare mode puts one file per model beside each prompt", async () => {
    const { row } = await owner();
    const f1 = put(row, await solid(1, 2, 3), "image/png", "flux-fox.png"), h1 = put(row, await solid(4, 5, 6), "image/png", "h3-fox.png");
    const f2 = put(row, await solid(7, 8, 9), "image/png", "flux-sign.png"), h2 = put(row, await solid(9, 8, 7), "image/png", "h3-sign.png");
    const made = await makeContactSheet(row, { sections: [{ caption: "a red fox", ids: [f1, h1] }, { caption: "a sign that says OPEN", ids: [f2, h2] }], columns: 2, labels: "details" });
    expect(made.tiles).toBe(4);
    expect(made.height).toBeGreaterThan(2 * 320);
  });
  test("refuses nothing chosen, too many, unreadable ids, other people's files and non-media", async () => {
    const { row, client } = await owner();
    await expect(makeContactSheet(row, { ids: [] })).rejects.toBeInstanceOf(SheetError);
    await expect(makeContactSheet(row, { ids: Array.from({ length: SHEET_MAX_FILES + 1 }, (_, i) => `f${i}`) })).rejects.toThrow("up to 24");
    await expect(makeContactSheet(row, { ids: ["nope"] })).rejects.toThrow("isn't in your Library any more");
    const doc = put(row, new Uint8Array([1, 2, 3]), "text/plain", "n.txt");
    await expect(makeContactSheet(row, { ids: [doc] })).rejects.toThrow("pictures and video clips only");
    const kid = (await child(client)).row;
    const mine = put(row, await solid(9, 9, 9), "image/png", "mine.png");
    await expect(makeContactSheet(kid, { ids: [mine] })).rejects.toThrow("isn't in your Library any more");
  });
});
