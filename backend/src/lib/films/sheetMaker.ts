// FILM-REAL-09: makes the reference sheet a clip is built from, from the pictures a person attached, with no hand work. The sheet follows the layout the LTX
// Ingredients adapter was trained on: every person and object is cut out onto its own clean white panel (a person also gets a face close-up when the
// photo shows more than a head), every place is one clean full-height panel, panels sit edge to edge on a 768x448 canvas with no text, and the sheet comes with
// the "Reference sheet:" description that names each panel by its position. Pixels are the person's own pictures (cut out and scaled, never redrawn).
import sharp, { type OverlayOptions } from "sharp";
import type { PictureRole } from "@/lib/pictures/roles";
import { runPictureTool } from "@/lib/pictures/people";
import { readPictureRoles } from "@/lib/pictures/roles";
import { detectFaces } from "@/lib/pictures/likeness/faces";
import { drawViews, type ViewTools } from "./sheetViews";

/** Whether the two pinned face models are installed. They are installed from the install wizard and Settings, AI & models, never silently by a feature; without them a
 *  photo of several people cannot be split, and the sheet says so. A dynamic import keeps the face code off the chat picture path. */
async function faceModelsInstalled(): Promise<boolean> {
  try { return (await import("@/lib/visionAssets")).areVisionAssetsInstalled(); } catch { return false; }
}

export interface SheetPicture { bytes: Uint8Array; mediaType: string; name: string; role: PictureRole; look: string }
export interface SheetTools {
  /** The picture with its background removed: a PNG with transparency. */
  removeBackground(bytes: Uint8Array, mediaType: string): Promise<Uint8Array>;
  /** Boxes of the faces in the picture, in its own pixels (empty when none is found or the finder is unavailable). */
  findFaces(bytes: Uint8Array, mediaType: string): Promise<Array<{ x: number; y: number; w: number; h: number }>>;
  /** Optional: a plain name and look for one picture (used for each person of a split photo, so every panel says who is in it). */
  describe?(bytes: Uint8Array, mediaType: string): Promise<{ name: string; look: string } | null>;
}
export interface MadeSheet { png: Uint8Array; description: string; panels: Array<{ name: string; view: string; slot: string }>; /** Plain sentences for the person about what the sheet could not do (for example, the face models are not installed). */ notes: string[] }

export const SHEET_W = 768, SHEET_H = 448, PLACE_W = 288, GAP = 2, MAX_PLACES = 2;
const realTools: SheetTools = {
  async removeBackground(bytes, mediaType) { return (await runPictureTool("remove_background", bytes, mediaType, {})).png; },
  async describe(bytes) {
    const read = await readPictureRoles([bytes]);
    const first = read.ok ? read.readings[0] : undefined;
    return first ? { name: first.name, look: first.look } : null;
  },
  async findFaces(bytes) {
    const png = new Uint8Array(await sharp(Buffer.from(bytes)).png().toBuffer());
    const found = await detectFaces(png);
    return found.ok ? found.value.map((face) => ({ x: Math.round(face.bbox[0]), y: Math.round(face.bbox[1]), w: Math.round(face.bbox[2]), h: Math.round(face.bbox[3]) })) : [];
  },
};

type Panel = { kind: "subject" | "place"; /** Known to hold exactly one person (found by the face finder and cut to that face's share): the only kind of person panel a view is ever drawn from. */ single?: boolean; name: string; view: string; role: PictureRole; look: string; image: Buffer; onWhite: boolean };
const white = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: "white" } });

/** Cuts the subject out of its photo and trims the empty margin; the photo itself comes back when no cut-out can be made. */
/** Pause before the first retry of a cut-out (tests set it to 0). */
export const cutOutPause = { ms: 1500 };
let fellBack: string[] | null = null;
async function cutOut(picture: SheetPicture, tools: SheetTools, box?: { x: number; y: number; w: number; h: number }): Promise<Buffer> {
  let source = Buffer.from(picture.bytes);
  if (box) {
    const meta = await sharp(source).metadata();
    const padX = Math.round(box.w * 0.06), padY = Math.round(box.h * 0.04);
    const left = Math.max(0, box.x - padX), top = Math.max(0, box.y - padY);
    source = await sharp(source).extract({ left, top, width: Math.min(meta.width! - left, box.w + padX * 2), height: Math.min(meta.height! - top, box.h + padY * 2) }).png().toBuffer();
  }
  // Up to four tries with growing pauses: the background remover is shared with video work and refuses a request while that runs (a live sheet kept two plain photos
  // because one retry was not enough). Cut-outs are made one at a time (see makeSheetFromPictures) so a sheet does not flood it itself.
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const cut = Buffer.from(await tools.removeBackground(new Uint8Array(source), box ? "image/png" : picture.mediaType));
      return await sharp(cut).trim({ threshold: 5 }).png().toBuffer();
    } catch { if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, cutOutPause.ms * 2 ** attempt)); }
  }
  fellBack?.push(picture.name);
  return sharp(source).png().toBuffer();
}

async function onWhite(image: Buffer, w: number, h: number, pad = 10): Promise<Buffer> {
  const fitted = await sharp(image).resize(w - pad * 2, h - pad * 2, { fit: "inside" }).png().toBuffer();
  return white(w, h).composite([{ input: fitted, gravity: "centre" }]).png().toBuffer();
}

/** Model-free split of a cut-out that holds two people side by side: the columns of the background remover's mask are counted, and a clear valley between two heavy
 *  halves is the seam. Returns the two trimmed halves, or null when the figure does not split cleanly (one person, or two overlapping). */
export async function splitCutOutByMask(cut: Buffer): Promise<Buffer[] | null> {
  const meta = await sharp(cut).metadata();
  if (!meta.width || !meta.height || meta.width < 80) return null;
  const small = await sharp(cut).ensureAlpha().resize({ width: Math.min(400, meta.width) }).raw().toBuffer({ resolveWithObject: true });
  const { data, info } = small, columns = new Array<number>(info.width).fill(0);
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) if (data[(y * info.width + x) * info.channels + 3]! > 128) columns[x]! += 1;
  const total = columns.reduce((sum, value) => sum + value, 0);
  if (total === 0) return null;
  const smooth = columns.map((_, x) => { let sum = 0, n = 0; for (let k = -3; k <= 3; k++) { const v = columns[x + k]; if (v !== undefined) { sum += v; n++; } } return sum / n; });
  const lo = Math.floor(info.width * 0.25), hi = Math.ceil(info.width * 0.75);
  let seam = lo; for (let x = lo; x <= hi; x++) if (smooth[x]! < smooth[seam]!) seam = x;
  const left = smooth.slice(0, seam), right = smooth.slice(seam);
  const leftMass = left.reduce((sum, value) => sum + value, 0), rightMass = right.reduce((sum, value) => sum + value, 0);
  const leftPeak = Math.max(...left), rightPeak = Math.max(...right);
  if (leftMass < total * 0.25 || rightMass < total * 0.25 || smooth[seam]! > 0.35 * Math.min(leftPeak, rightPeak)) return null;
  const cutAt = Math.round((seam / info.width) * meta.width);
  // Extract first, trim second (sharp runs trim before extract inside one pipeline, which would put the extract area outside the trimmed image).
  const halves: Buffer[] = [];
  for (const [from, width] of [[0, cutAt], [cutAt, meta.width - cutAt]] as const) {
    try {
      const part = await sharp(cut).extract({ left: from, top: 0, width, height: meta.height }).png().toBuffer();
      halves.push(await sharp(part).trim({ threshold: 5 }).png().toBuffer());
    } catch { return null; }
  }
  return halves;
}

async function panelsFor(picture: SheetPicture, tools: SheetTools): Promise<Panel[]> {
  const base = { name: picture.name, role: picture.role, look: picture.look };
  if (picture.role === "set" || picture.role === "end_shot" || picture.role === "other") return [{ ...base, kind: "place", view: "Setting", image: Buffer.from(picture.bytes), onWhite: false }];
  if (picture.role === "actor") {
    const meta = await sharp(Buffer.from(picture.bytes)).metadata();
    const [width, height] = [meta.width ?? 1, meta.height ?? 1];
    const faces = (await tools.findFaces(picture.bytes, picture.mediaType).catch(() => [])).filter((face) => face.w * face.h > 0).sort((a, b) => a.x - b.x).slice(0, 3);
    if (!faces.length) {
      // No face finder (its models are not installed): the cut-out itself is split when it holds two people side by side. These panels are not known to be one person each, so nothing is drawn from them.
      const whole = await cutOut(picture, tools);
      const halves = await splitCutOutByMask(whole).catch(() => null);
      return halves ? halves.map((image, index) => ({ ...base, name: `${picture.name} ${index + 1}`, kind: "subject" as const, view: "Front View", image, onWhite: true })) : [{ ...base, kind: "subject", view: "Front View", image: whole, onWhite: true }];
    }
    const panels: Panel[] = [];
    for (const [index, face] of faces.entries()) {
      const name = faces.length > 1 ? `${picture.name} ${index + 1}` : picture.name;
      // One person's share of the picture: halfway to the neighbouring faces, or a few face-widths out on the open side, from above the hair to the bottom edge.
      const centre = face.x + face.w / 2, prev = faces[index - 1], next = faces[index + 1];
      const left = prev ? Math.round((centre + prev.x + prev.w / 2) / 2) : Math.max(0, Math.round(centre - face.w * 2.4));
      const right = next ? Math.round((centre + next.x + next.w / 2) / 2) : Math.min(width, Math.round(centre + face.w * 2.4));
      const top = Math.max(0, Math.round(face.y - face.h * 0.9));
      const box = { x: left, y: top, w: Math.max(8, right - left), h: Math.max(8, height - top) };
      const image = await cutOut(picture, tools, box);
      // A photo of several people: each person is described on their own cut-out, so a panel never says "a man and a woman".
      const own = faces.length > 1 ? await tools.describe?.(new Uint8Array(image), "image/png").catch(() => null) ?? null : null;
      panels.push({ ...base, name: own?.name ? `${own.name}` : name, look: own?.look ?? base.look, kind: "subject", single: true, view: "Front View", image, onWhite: true });
      // A face that already fills the picture needs no close-up; a smaller one gets its own, cut from the original with room for the whole head.
      if (face.w / box.w < 0.3) {
        const fx = Math.max(0, Math.round(face.x - face.w * 0.7)), fy = Math.max(0, Math.round(face.y - face.h * 0.8));
        const faceBox = { x: fx, y: fy, w: Math.min(width - fx, Math.round(face.w * 2.4)), h: Math.min(height - fy, Math.round(face.h * 2.3)) };
        panels.push({ ...base, name: panels[panels.length - 1]!.name, look: panels[panels.length - 1]!.look, kind: "subject", single: true, view: "Face Close-up", image: await cutOut(picture, tools, faceBox), onWhite: true });
      }
    }
    return panels;
  }
  return [{ ...base, kind: "subject", view: "Front View", image: await cutOut(picture, tools), onWhite: true }];
}

const ROW = ["Top", "Middle", "Bottom"], COL = ["Left", "Middle", "Right"];
const kindWord = (role: PictureRole) => role === "actor" ? "Character" : "Prop";

/** One sheet from the attached pictures: people and objects as white cut-out panels on the left, places as full-height panels on the right. */
export async function makeSheetFromPictures(pictures: ReadonlyArray<SheetPicture>, tools: SheetTools = realTools, options: { drawViews?: boolean; viewTools?: ViewTools; /** REFVIDEO-STEPS-01: called after each picture is cut out and after each picture's missing views are drawn, so a caller can show progress. */ onStep?: (step: { phase: "cut" | "draw"; done: number; total: number }) => void } = {}): Promise<MadeSheet> {
  if (!pictures.length) throw new Error("A sheet needs at least one picture.");
  // One picture at a time: all the cut-outs at once flooded the shared background remover and some were refused.
  const all: Panel[] = [];
  const fallbacks: string[] = [];
  fellBack = fallbacks;
  try {
    for (const [index, picture] of pictures.entries()) {
      all.push(...await panelsFor(picture, tools));
      options.onStep?.({ phase: "cut", done: index + 1, total: pictures.length });
    }
  } finally { fellBack = null; }
  // Views the photos do not show (a side view, a clean front, an angled object) are drawn from the person's own cut-out and added after the originals.
  if (options.drawViews) {
    // One panel at a time: a person is drawn only from a panel that holds exactly one person (never from a photo the face finder could not split).
    const sources = all.filter((panel) => panel.kind === "subject" && panel.view === "Front View" && (panel.role !== "actor" || panel.single === true));
    for (const [index, original] of sources.entries()) {
      options.onStep?.({ phase: "draw", done: index, total: sources.length });
      const drawn = await drawViews(original.role, { bytes: new Uint8Array(original.image), mediaType: "image/png" }, options.viewTools).catch(() => []);
      for (const view of drawn) all.push({ kind: "subject", single: original.single, name: original.name, view: view.view, role: original.role, look: original.look, image: Buffer.from(view.image), onWhite: true });
    }
  }
  const subjects = all.filter((panel) => panel.kind === "subject").slice(0, 8), places = all.filter((panel) => panel.kind === "place").slice(0, MAX_PLACES);
  const leftW = subjects.length ? SHEET_W - (places.length ? PLACE_W : 0) : 0, layers: OverlayOptions[] = [], described: string[] = [], panels: MadeSheet["panels"] = [];
  if (subjects.length) {
    const n = subjects.length, cols = n <= 2 ? n : n <= 4 ? 2 : n <= 6 ? 3 : 4, rows = Math.ceil(n / cols);
    const cellW = Math.floor(leftW / cols), cellH = Math.floor(SHEET_H / rows);
    for (const [i, panel] of subjects.entries()) {
      const c = i % cols, r = Math.floor(i / cols);
      layers.push({ input: await onWhite(panel.image, cellW - GAP, cellH - GAP), left: c * cellW, top: r * cellH });
      const colName = COL[cols === 2 ? (c === 0 ? 0 : 2) : c] ?? "Left", rowName = rows === 2 ? (r === 0 ? "Top" : "Bottom") : ROW[Math.min(r, 2)], label = rows === 1 ? colName : `${rowName} ${colName}`;
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
  const notes: string[] = [];
  if (fallbacks.length) notes.push(`The background could not be removed from ${[...new Set(fallbacks)].join(", ")}, so ${fallbacks.length === 1 ? "it is" : "they are"} on the sheet as ${fallbacks.length === 1 ? "it was" : "they were"} sent. Try again in a minute.`);
  if (pictures.some((picture) => picture.role === "actor") && !subjects.some((panel) => panel.role === "actor" && panel.single) && !(await faceModelsInstalled())) {
    notes.push("The face models are not installed, so photos of several people could not be split into one panel each and no views were drawn of people. An admin can install them in Settings, AI and models.");
  }
  return { png: new Uint8Array(png), description: `Reference sheet: ${described.join(" ")}`, panels, notes };
}
