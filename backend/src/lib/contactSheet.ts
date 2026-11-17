// CONTACT-SHEET-01: one sheet builder for any pictures and video clips in the Library (any model, any folder, any selection).
// The layout is a list of sections. A section is a caption (for example the prompt) and a row of tiles that wraps at `columns`.
//   grid    : one section, every picture or frame a tile.
//   video   : each clip becomes a tile per frame (the clip's name is its caption).
//   compare : one section per prompt, one tile per model, so two models on the same prompts read side by side.
// Pure pixels live in `composeContactSheet` (sharp and SVG text, no database); `makeContactSheet` reads Library files and saves the result.
import sharp, { type OverlayOptions } from "sharp";
import { readAttachment, storeFile } from "@/lib/attachments";
import { lockItemOfProvenance, lockState } from "@/lib/adultLock";
import { fileAudience } from "@/lib/access";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { eq } from "drizzle-orm";
import { libraryProvenance } from "@/lib/libraryProvenance";
import { extractKeyframes } from "@/lib/pictures/keyframes";
import type { PersonRow } from "@/types";

export interface SheetTile { bytes: Uint8Array; label?: string; sub?: string }
export interface SheetSection { caption?: string; tiles: SheetTile[] }
export interface ComposeOptions { columns?: number; cell?: number; title?: string }

export const SHEET_MAX_TILES = 48, SHEET_MAX_FILES = 24, SHEET_MAX_FRAMES = 8, SHEET_MAX_WIDTH = 4096;
const GAP = 12, PAD = 20, LABEL_H = 38, CAPTION_H = 34, TITLE_H = 54;

const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fit = (value: string, limit: number) => (value.length > limit ? `${value.slice(0, Math.max(1, limit - 1)).trimEnd()}…` : value);

function textBand(width: number, height: number, lines: Array<{ text: string; size: number; weight?: number; fill: string; y: number }>): Buffer {
  const body = lines.map((line) => `<text x="0" y="${line.y}" font-family="Helvetica, Arial, sans-serif" font-size="${line.size}" font-weight="${line.weight ?? 400}" fill="${line.fill}">${esc(line.text)}</text>`).join("");
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`);
}

/** Lay out the sections as one PNG: a dark board, a title, a caption per section, and each tile fitted inside a square cell with its label under it. */
export async function composeContactSheet(sections: ReadonlyArray<SheetSection>, options: ComposeOptions = {}): Promise<{ png: Uint8Array; width: number; height: number; tiles: number }> {
  const live = sections.map((section) => ({ ...section, tiles: section.tiles.slice(0, SHEET_MAX_TILES) })).filter((section) => section.tiles.length > 0);
  const total = live.reduce((sum, section) => sum + section.tiles.length, 0);
  if (total === 0) throw new Error("There is nothing to put on the sheet. Choose at least one picture or clip.");
  const widest = Math.max(...live.map((section) => section.tiles.length));
  const columns = Math.max(1, Math.min(options.columns ?? Math.min(widest, 4), 8, widest));
  const cell = Math.max(96, Math.min(options.cell ?? 320, Math.floor((SHEET_MAX_WIDTH - PAD * 2 - GAP * (columns - 1)) / columns)));
  const width = PAD * 2 + columns * cell + (columns - 1) * GAP;
  const hasTitle = Boolean(options.title?.trim());
  let y = PAD + (hasTitle ? TITLE_H : 0);
  const layers: OverlayOptions[] = [];
  const sub = (value: string, size: number, fill: string, top: number, weight = 400): OverlayOptions => ({ input: textBand(width - PAD * 2, size + 12, [{ text: value, size, fill, y: size + 2, weight }]), left: PAD, top });
  if (hasTitle) layers.push(sub(fit(options.title!.trim(), 90), 26, "#f4f4f5", PAD - 2, 700));
  for (const section of live) {
    if (section.caption?.trim()) { layers.push(sub(fit(section.caption.trim(), Math.floor(width / 9)), 18, "#d4d4d8", y, 600)); y += CAPTION_H; }
    for (let index = 0; index < section.tiles.length; index += columns) {
      const row = section.tiles.slice(index, index + columns);
      for (const [column, tile] of row.entries()) {
        const left = PAD + column * (cell + GAP);
        const picture = await sharp(Buffer.from(tile.bytes), { failOn: "none" }).rotate().resize(cell, cell, { fit: "contain", background: { r: 24, g: 24, b: 27, alpha: 1 } }).flatten({ background: "#18181b" }).png().toBuffer();
        layers.push({ input: picture, left, top: y });
        const chars = Math.max(8, Math.floor(cell / 7.2));
        const lines = [] as Array<{ text: string; size: number; weight?: number; fill: string; y: number }>;
        if (tile.label) lines.push({ text: fit(tile.label, chars), size: 13, weight: 600, fill: "#e4e4e7", y: 14 });
        if (tile.sub) lines.push({ text: fit(tile.sub, Math.floor(chars * 1.1)), size: 11, fill: "#a1a1aa", y: tile.label ? 30 : 14 });
        if (lines.length) layers.push({ input: textBand(cell, LABEL_H, lines), left, top: y + cell + 4 });
      }
      y += cell + (row.some((tile) => tile.label || tile.sub) ? LABEL_H + 10 : 6) + GAP;
    }
    y += 6;
  }
  const height = y + PAD - GAP;
  const png = await sharp({ create: { width, height, channels: 3, background: "#09090b" } }).composite(layers).png().toBuffer();
  return { png: new Uint8Array(png), width, height, tiles: total };
}

export interface SheetInput {
  /** Flat selection: every file becomes tiles in one section. */
  ids?: ReadonlyArray<string>;
  /** Or named sections (compare mode: one section per prompt, one file per model). */
  sections?: ReadonlyArray<{ caption?: string; ids: ReadonlyArray<string> }>;
  /** Frames taken from each video clip (1 to 8, default 3). */
  perClip?: number;
  columns?: number;
  title?: string;
  /** none: no labels. name: file name. details: name, then model, size and seconds when the file records them. */
  labels?: "none" | "name" | "details";
}

export class SheetError extends Error { constructor(public status: 400 | 403 | 404 | 422, message: string) { super(message); } }
export const SHEET_NEEDS_ONE = "Choose at least one picture or clip from your Library for the sheet.";
export const SHEET_TOO_MANY = `A sheet takes up to ${SHEET_MAX_FILES} pictures or clips at a time. Choose fewer, or make a second sheet.`;

function detailsOf(note: string, mediaType: string, name: string | null): { label: string; sub: string } {
  const info = libraryProvenance(note) as Record<string, unknown>;
  const bits: string[] = [];
  const model = [info.model, info.engine, info.family].find((value): value is string => typeof value === "string" && value !== "");
  if (model) bits.push(model);
  if (typeof info.width === "number" && typeof info.height === "number") bits.push(`${info.width}x${info.height}`);
  const seconds = [info.seconds, info.duration_seconds].find((value): value is number => typeof value === "number");
  if (seconds !== undefined) bits.push(`${Math.round(seconds * 10) / 10} s`);
  return { label: name ?? (mediaType.startsWith("video/") ? "Clip" : "Picture"), sub: bits.join(" · ") };
}

type Loaded = { id: string; bytes: Uint8Array; mediaType: string; name: string | null; note: string; adultOnly: boolean };

function load(actor: PersonRow, id: string): Loaded {
  const read = readAttachment(actor, id);
  const missing = new SheetError(404, "A chosen file isn't in your Library any more. Open the Library and choose it again.");
  if (!read.ok) throw missing;
  const record = read.value.record as unknown as { media_type: string; name?: string | null; provenance?: { note?: string | null }; owner_person_id?: string };
  const note = record.provenance?.note ?? "";
  if (!record.media_type.startsWith("image/") && !record.media_type.startsWith("video/")) throw new SheetError(422, "A sheet holds pictures and video clips only. Choose pictures or clips.");
  const item = lockItemOfProvenance(record.owner_person_id ?? actor.id, note);
  const state = lockState(item, actor);
  if (state === "hidden") throw missing;
  if (state === "locked") throw new SheetError(403, "That is locked. Unlock it with your passcode first, then try again.");
  return { id, bytes: read.value.bytes, mediaType: record.media_type, name: (db.select({ name: attachments.name }).from(attachments).where(eq(attachments.id, id)).get()?.name ?? null)?.replace(/\.[a-z0-9]{2,4}$/i, "") || null, note, adultOnly: fileAudience(note) === "adult-only" };
}

/** Test seam: replaces frame extraction from a video clip. */
let framesForTests: typeof extractKeyframes | null = null;
export function __setSheetFramesForTests(fn: typeof extractKeyframes | null): void { framesForTests = fn; }

async function tilesFor(file: Loaded, perClip: number, labels: NonNullable<SheetInput["labels"]>): Promise<{ caption?: string; tiles: SheetTile[] }> {
  const details = detailsOf(file.note, file.mediaType, file.name);
  const info = libraryProvenance(file.note) as Record<string, unknown>;
  const label = labels === "none" ? undefined : details.label;
  const sub = labels === "details" && details.sub ? details.sub : undefined;
  if (file.mediaType.startsWith("image/")) return { tiles: [{ bytes: file.bytes, ...(label ? { label } : {}), ...(sub ? { sub } : {}) }] };
  const seconds = [info.seconds, info.duration_seconds].find((value): value is number => typeof value === "number") ?? null;
  const frames = await (framesForTests ?? extractKeyframes)(file.bytes, seconds, perClip);
  if (!frames || frames.length === 0) throw new SheetError(422, `One clip could not be read on this computer${file.name ? ` (${file.name})` : ""}. Remove it from the selection and try again.`);
  return { ...(labels === "none" ? {} : { caption: [details.label, sub].filter(Boolean).join("  ·  ") }), tiles: frames.map((bytes, index) => ({ bytes, label: labels === "none" ? undefined : `Frame ${index + 1} of ${frames.length}` })) };
}

/** Read the chosen Library files, build the sheet and save it to the Library as one new picture. */
export async function makeContactSheet(actor: PersonRow, input: SheetInput): Promise<{ id: string; name: string; width: number; height: number; tiles: number; files: number }> {
  const groups = input.sections?.length ? input.sections.map((section) => ({ caption: section.caption, ids: [...section.ids] })) : [{ caption: undefined, ids: [...(input.ids ?? [])] }];
  const ids = groups.flatMap((group) => group.ids).map((id) => id.trim()).filter(Boolean);
  if (ids.length === 0) throw new SheetError(400, SHEET_NEEDS_ONE);
  if (ids.length > SHEET_MAX_FILES) throw new SheetError(400, SHEET_TOO_MANY);
  const labels = input.labels ?? "name";
  const perClip = Math.max(1, Math.min(Math.trunc(input.perClip ?? 3), SHEET_MAX_FRAMES));
  const files = new Map<string, Loaded>();
  for (const id of new Set(ids)) files.set(id, load(actor, id));
  const sections: SheetSection[] = [];
  const flat = !input.sections?.length;
  for (const group of groups) {
    const tiles: SheetTile[] = [];
    let caption = group.caption;
    for (const id of group.ids.map((value) => value.trim()).filter(Boolean)) {
      const made = await tilesFor(files.get(id)!, perClip, labels);
      if (made.caption && flat) sections.push({ caption: made.caption, tiles: made.tiles });
      else { if (made.caption && !caption) caption = made.caption; tiles.push(...made.tiles); }
    }
    if (tiles.length) sections.push({ ...(caption ? { caption } : {}), tiles });
  }
  // A flat selection of pictures shares one section; clips each keep their own.
  const merged = flat ? mergePictureSections(sections) : sections;
  const composed = await composeContactSheet(merged, { ...(input.columns ? { columns: input.columns } : {}), ...(input.title ? { title: input.title } : {}) });
  const adultOnly = [...files.values()].some((file) => file.adultOnly);
  const name = input.title?.trim() ? fit(input.title.trim(), 80) : "Contact sheet";
  const saved = storeFile(actor, { conversationId: null, turnId: null, mediaType: "image/png", bytes: composed.png, provenance: `picture-gen:${JSON.stringify({ v: 1, audience: adultOnly ? "adult-only" : "all-ages", contact_sheet: true, files: files.size, tiles: composed.tiles, width: composed.width, height: composed.height })}`, retention: "kept", name, deduplicate: false });
  if (!saved.ok) throw new SheetError(saved.status === 403 ? 403 : 400, typeof saved.error === "string" ? saved.error : "The sheet could not be saved. Try again.");
  return { id: saved.value.id, name, width: composed.width, height: composed.height, tiles: composed.tiles, files: files.size };
}

function mergePictureSections(sections: SheetSection[]): SheetSection[] {
  const out: SheetSection[] = [];
  let pictures: SheetSection | null = null;
  for (const section of sections) {
    if (section.caption) { out.push(section); pictures = null; continue; }
    if (!pictures) { pictures = { tiles: [] }; out.push(pictures); }
    pictures.tiles.push(...section.tiles);
  }
  return out;
}
