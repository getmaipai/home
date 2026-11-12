// FILM-REAL-07: a reference sheet built from the person's own photos, never drawn by a model: every photo is placed untouched (only scaled to fit) in its own
// panel on a black canvas, with no text or borders, so each keeps its real faces, signs and shapes. The panels read left to right, top to bottom, in the order
// given, which is the order a prompt refers to them ("the left panel", "the middle panel"). The size defaults to 768x448, the one size the LTX 2.5
// Ingredients adapter was trained at; the same sheet is the preview shown to the person before any video is made.
import sharp from "sharp";

export const SHEET_WIDTH = 768;
export const SHEET_HEIGHT = 448;
export const SHEET_MAX_PANELS = 6;
const GAP = 16;

/** Columns and rows for a panel count: 1 alone, 2 and 3 in a row, 4 as a square of two, 5 and 6 as two rows of three. */
export function sheetGrid(count: number): { columns: number; rows: number } {
  if (count <= 3) return { columns: count, rows: 1 };
  if (count === 4) return { columns: 2, rows: 2 };
  return { columns: 3, rows: 2 };
}

/** One PNG sheet of 1 to 6 photos, each fitted inside its own cell and centred on black; throws on no photos or more than six. */
export async function buildReferenceSheet(photos: ReadonlyArray<Uint8Array>, size: { width: number; height: number } = { width: SHEET_WIDTH, height: SHEET_HEIGHT }): Promise<Uint8Array> {
  if (!photos.length || photos.length > SHEET_MAX_PANELS) throw new Error("A reference sheet holds one to six pictures.");
  const { columns, rows } = sheetGrid(photos.length);
  const cellWidth = Math.floor((size.width - GAP * (columns + 1)) / columns), cellHeight = Math.floor((size.height - GAP * (rows + 1)) / rows);
  const layers = await Promise.all(photos.map(async (bytes, i) => {
    const panel = await sharp(Buffer.from(bytes), { failOn: "error" }).rotate().resize(cellWidth, cellHeight, { fit: "inside" }).png().toBuffer({ resolveWithObject: true });
    const column = i % columns, row = Math.floor(i / columns);
    return { input: panel.data, left: GAP + column * (cellWidth + GAP) + Math.floor((cellWidth - panel.info.width) / 2), top: GAP + row * (cellHeight + GAP) + Math.floor((cellHeight - panel.info.height) / 2) };
  }));
  const sheet = await sharp({ create: { width: size.width, height: size.height, channels: 3, background: { r: 0, g: 0, b: 0 } } }).composite(layers).png().toBuffer();
  return new Uint8Array(sheet);
}
