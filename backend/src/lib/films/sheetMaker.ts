// FILM-REAL-09: makes the reference sheet a clip is built from, from the pictures a person attached, with no hand work. The sheet follows the layout the LTX
// Ingredients adapter was trained on: every person and object is cut out onto its own clean white panel (a person also gets a face close-up when the
// photo shows more than a head), every place is one clean full-height panel, panels sit edge to edge on a 768x448 canvas with no text, and the sheet comes with
// the "Reference sheet:" description that names each panel by its position. Pixels are the person's own pictures (cut out and scaled, never redrawn).
import sharp, { type OverlayOptions } from "sharp";
import type { PictureRole } from "@/lib/pictures/roles";
import { runPictureTool } from "@/lib/pictures/people";

export interface SheetPicture { bytes: Uint8Array; mediaType: string; name: string; role: PictureRole; look: string }
export interface SheetTools {
  /** The picture with its background removed: a PNG with transparency. */
  removeBackground(bytes: Uint8Array, mediaType: string): Promise<Uint8Array>;
  /** Boxes of the people in the picture, in its own pixels. */
  findPeople(bytes: Uint8Array, mediaType: string): Promise<Array<{ x: number; y: number; w: number; h: number }>>;
}
export interface MadeSheet { png: Uint8Array; description: string; panels: Array<{ name: string; view: string; slot: string }> }

export const SHEET_W = 768, SHEET_H = 448, PLACE_W = 288, GAP = 2, MAX_PLACES = 2;
const realTools: SheetTools = {
  async removeBackground(bytes, mediaType) { return (await runPictureTool("remove_background", bytes, mediaType, {})).png; },
  async findPeople(bytes, mediaType) {
    const found = (await runPictureTool("find_people", bytes, mediaType, {})).people ?? [];
    // The finder answers in fractions of the picture (0 to 1); the sheet works in pixels.
    const meta = await sharp(Buffer.from(bytes)).metadata();
    const [width, height] = [meta.width ?? 1, meta.height ?? 1];
    return found.map((box) => box.x <= 1 && box.y <= 1 && box.w <= 1 && box.h <= 1 ? { x: Math.round(box.x * width), y: Math.round(box.y * height), w: Math.round(box.w * width), h: Math.round(box.h * height) } : { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h) });
  },
};

type Panel = { kind: "subject" | "place"; name: string; view: string; role: PictureRole; look: string; image: Buffer; onWhite: boolean };
const white = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: "white" } });

/** Cuts the subject out of its photo and trims the empty margin; the photo itself comes back when no cut-out can be made. */
async function cutOut(picture: SheetPicture, tools: SheetTools, box?: { x: number; y: number; w: number; h: number }): Promise<Buffer> {
  let source = Buffer.from(picture.bytes);
  if (box) {
    const meta = await sharp(source).metadata();
    const padX = Math.round(box.w * 0.06), padY = Math.round(box.h * 0.04);
    const left = Math.max(0, box.x - padX), top = Math.max(0, box.y - padY);
    source = await sharp(source).extract({ left, top, width: Math.min(meta.width! - left, box.w + padX * 2), height: Math.min(meta.height! - top, box.h + padY * 2) }).png().toBuffer();
  }
  try {
    const cut = Buffer.from(await tools.removeBackground(new Uint8Array(source), box ? "image/png" : picture.mediaType));
    return await sharp(cut).trim({ threshold: 5 }).png().toBuffer();
  } catch { return sharp(source).png().toBuffer(); }
}

async function onWhite(image: Buffer, w: number, h: number, pad = 10): Promise<Buffer> {
  const fitted = await sharp(image).resize(w - pad * 2, h - pad * 2, { fit: "inside" }).png().toBuffer();
  return white(w, h).composite([{ input: fitted, gravity: "centre" }]).png().toBuffer();
}

async function panelsFor(picture: SheetPicture, tools: SheetTools): Promise<Panel[]> {
  const base = { name: picture.name, role: picture.role, look: picture.look };
  if (picture.role === "set" || picture.role === "end_shot" || picture.role === "other") return [{ ...base, kind: "place", view: "Setting", image: Buffer.from(picture.bytes), onWhite: false }];
  if (picture.role === "actor") {
    const people = await tools.findPeople(picture.bytes, picture.mediaType).catch(() => []);
    const biggest = [...people].sort((a, b) => b.w * b.h - a.w * a.h)[0];
    const cut = await cutOut(picture, tools, biggest);
    const meta = await sharp(cut).metadata();
    const panels: Panel[] = [{ ...base, kind: "subject", view: "Front View", image: cut, onWhite: true }];
    // A photo that shows more than a head and shoulders also gets a face close-up: the top of the cut-out, wide enough to keep the whole head.
    if ((meta.height ?? 0) / Math.max(1, meta.width ?? 1) > 0.8) {
      const top = Math.round(meta.height! * (meta.height! / Math.max(1, meta.width!) > 1.25 ? 0.4 : 0.55)), left = Math.round(meta.width! * 0.1);
      panels.push({ ...base, kind: "subject", view: "Face Close-up", image: await sharp(cut).extract({ left, top: 0, width: Math.round(meta.width! * 0.8), height: top }).png().toBuffer(), onWhite: true });
    }
    return panels;
  }
  return [{ ...base, kind: "subject", view: "Front View", image: await cutOut(picture, tools), onWhite: true }];
}

const ROW = ["Top", "Middle", "Bottom"], COL = ["Left", "Middle", "Right"];
const kindWord = (role: PictureRole) => role === "actor" ? "Character" : "Prop";

/** One sheet from the attached pictures: people and objects as white cut-out panels on the left, places as full-height panels on the right. */
export async function makeSheetFromPictures(pictures: ReadonlyArray<SheetPicture>, tools: SheetTools = realTools): Promise<MadeSheet> {
  if (!pictures.length) throw new Error("A sheet needs at least one picture.");
  const all = (await Promise.all(pictures.map((picture) => panelsFor(picture, tools)))).flat();
  const subjects = all.filter((panel) => panel.kind === "subject").slice(0, 6), places = all.filter((panel) => panel.kind === "place").slice(0, MAX_PLACES);
  const leftW = subjects.length ? SHEET_W - (places.length ? PLACE_W : 0) : 0, layers: OverlayOptions[] = [], described: string[] = [], panels: MadeSheet["panels"] = [];
  if (subjects.length) {
    const n = subjects.length, cols = n <= 2 ? n : n <= 4 ? 2 : 3, rows = Math.ceil(n / cols);
    const cellW = Math.floor(leftW / cols), cellH = Math.floor(SHEET_H / rows);
    for (const [i, panel] of subjects.entries()) {
      const c = i % cols, r = Math.floor(i / cols);
      layers.push({ input: await onWhite(panel.image, cellW - GAP, cellH - GAP), left: c * cellW, top: r * cellH });
      const colName = COL[cols === 2 ? (c === 0 ? 0 : 2) : c] ?? "Left", label = rows === 1 ? colName : `${ROW[Math.min(r, 2)]} ${colName}`;
      described.push(`${label} (${kindWord(panel.role)}, ${panel.view}): ${panel.look}`);
      panels.push({ name: panel.name, view: panel.view, slot: label });
    }
  }
  // Places stack in one column on the right: a lone place fills it, two places share it, so a wide photo loses as little of its sides (and its signs) as possible.
  const placeNames = places.length === 2 ? ["Top Right", "Bottom Right"] : ["Far Right"];
  const placeX = subjects.length ? leftW : 0, placeW = subjects.length ? PLACE_W : SHEET_W, placeH = Math.floor(SHEET_H / Math.max(1, places.length));
  for (const [i, panel] of places.entries()) {
    const image = await sharp(panel.image).resize(placeW - GAP, placeH - (places.length > 1 ? GAP : 0), { fit: "cover" }).png().toBuffer();
    layers.push({ input: image, left: placeX, top: i * placeH });
    described.push(`${placeNames[i]} (Setting): ${panel.look}`);
    panels.push({ name: panel.name, view: "Setting", slot: placeNames[i] ?? "Far Right" });
  }
  const png = await white(SHEET_W, SHEET_H).composite(layers).png().toBuffer();
  return { png: new Uint8Array(png), description: `Reference sheet: ${described.join(" ")}`, panels };
}
