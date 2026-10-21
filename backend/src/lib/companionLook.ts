import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import sharp, { type Metadata } from "sharp";
import { z } from "zod";
import media from "@maipai/spec/vocab/companion-media.json";
import { householdCompanionFolder } from "@/lib/householdCompanions";

const Source = z.enum(["upload", "generated", "edit"]);
const Version = z.object({ id: z.string().regex(/^v-[0-9]+$/), created_at: z.string().datetime(), source: Source, label: z.string().max(80), width: z.number().int().positive(), height: z.number().int().positive(), from: z.string().nullable() });
export const LookSchema = z.object({ version: z.literal(1), versions: z.array(Version), rest: z.string().nullable(), key: z.enum([media.key.default, media.key.alternate]) });
export type LookVersion = z.infer<typeof Version>;
export type CompanionLook = z.infer<typeof LookSchema>;
export const EMPTY_LOOK: CompanionLook = { version: 1, versions: [], rest: null, key: media.key.default };
export const LOOK_LIMIT_LINE = "This companion already has 60 pictures. Delete some before adding another.";
export const SMALL_PICTURE_LINE = `Use a picture that is at least ${media.image.min_upload_short_side} pixels on its short side.`;

function lookFolder(id: string): string | null {
  const folder = householdCompanionFolder(id);
  return folder ? join(folder, "look") : null;
}
function manifestPath(id: string): string | null { const dir = lookFolder(id); return dir ? join(dir, "look.json") : null; }
function sequencePath(id: string): string | null { const dir = lookFolder(id); return dir ? join(dir, ".sequence") : null; }
function atomicJson(path: string, value: unknown): void {
  const temp = `${path}.${crypto.randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  renameSync(temp, path);
}
export function readLook(id: string): CompanionLook {
  const path = manifestPath(id);
  if (!path || !existsSync(path)) return structuredClone(EMPTY_LOOK);
  try { const parsed = LookSchema.safeParse(JSON.parse(readFileSync(path, "utf8"))); return parsed.success ? parsed.data : structuredClone(EMPTY_LOOK); }
  catch { return structuredClone(EMPTY_LOOK); }
}

export function versionPath(id: string, versionId: string): string | null {
  if (!/^v-[0-9]+$/.test(versionId)) return null;
  const dir = lookFolder(id);
  return dir ? join(dir, `${versionId}.png`) : null;
}

export function addVersion(id: string, png: Uint8Array, meta: Omit<LookVersion, "id" | "created_at" | "width" | "height"> & { width: number; height: number }): LookVersion {
  const dir = lookFolder(id), path = manifestPath(id), seqPath = sequencePath(id);
  if (!dir || !path || !seqPath) throw new Error("That household companion could not be found.");
  const look = readLook(id);
  if (look.versions.length >= 60) throw new Error(LOOK_LIMIT_LINE);
  mkdirSync(dir, { recursive: true });
  const prior = Number(readFileSyncSafe(seqPath));
  const idNum = Math.max(Number.isSafeInteger(prior) ? prior : 0, ...look.versions.map((v) => Number(v.id.slice(2)))) + 1;
  const version: LookVersion = { id: `v-${idNum}`, created_at: new Date().toISOString(), source: meta.source, label: meta.label.slice(0, 80), width: meta.width, height: meta.height, from: meta.from };
  const filePath = versionPath(id, version.id)!;
  const temp = `${filePath}.${crypto.randomUUID()}.tmp`;
  try {
    writeFileSync(seqPath, String(idNum), "utf8");
    writeFileSync(temp, png, { flag: "wx" });
    renameSync(temp, filePath);
    const next = { ...look, versions: [...look.versions, version], rest: look.rest ?? version.id };
    atomicJson(path, next);
    return version;
  } catch (error) { rmSync(temp, { force: true }); rmSync(filePath, { force: true }); throw error; }
}
function readFileSyncSafe(path: string): string { try { return readFileSync(path, "utf8"); } catch { return "0"; } }

export function deleteVersion(id: string, versionId: string): boolean {
  const path = manifestPath(id), image = versionPath(id, versionId);
  if (!path || !image) throw new Error("That picture ID is not valid.");
  const look = readLook(id);
  if (look.rest === versionId) throw new Error("That picture is the approved starting picture. Pick another one first.");
  if (!look.versions.some((item) => item.id === versionId)) return false;
  const next = { ...look, versions: look.versions.filter((item) => item.id !== versionId) };
  atomicJson(path, next);
  rmSync(image, { force: true });
  return true;
}
export function setRest(id: string, versionId: string): boolean {
  const path = manifestPath(id);
  if (!path) throw new Error("That household companion could not be found.");
  const look = readLook(id);
  if (!look.versions.some((item) => item.id === versionId)) return false;
  atomicJson(path, { ...look, rest: versionId });
  return true;
}
export function deleteLook(id: string): void { const dir = lookFolder(id); if (dir) rmSync(dir, { recursive: true, force: true }); }

export type BackgroundRemover = (bytes: Uint8Array) => Promise<Uint8Array>;
export async function normalizePicture(bytes: Uint8Array, options: { removeBackground: BackgroundRemover }): Promise<Uint8Array> {
  let source: Uint8Array;
  let metadata: Metadata;
  try { metadata = await sharp(bytes, { limitInputPixels: 40_000_000, failOn: "error" }).metadata(); }
  catch { throw new Error("That picture could not be read. Use a PNG, JPEG or WebP picture and try again."); }
  if (!metadata.width || !metadata.height) throw new Error("That picture could not be read. Use a PNG, JPEG or WebP picture and try again.");
  const oriented = metadata.orientation && metadata.orientation >= 5 && metadata.orientation <= 8 ? { width: metadata.height, height: metadata.width } : { width: metadata.width, height: metadata.height };
  if (Math.min(oriented.width, oriented.height) < media.image.min_upload_short_side) throw new Error(SMALL_PICTURE_LINE);
  try { source = new Uint8Array(await sharp(bytes, { limitInputPixels: 40_000_000, failOn: "error" }).rotate().png().toBuffer()); }
  catch { throw new Error("That picture could not be read. Use a PNG, JPEG or WebP picture and try again."); }
  let transparent = false;
  if (metadata.hasAlpha) {
    try { const stats = await sharp(source, { limitInputPixels: 40_000_000 }).rotate().stats(); transparent = (stats.channels[3]?.min ?? 255) < 255; } catch { /* a malformed alpha channel will be caught by decode below */ }
  }
  if (!transparent) source = await options.removeBackground(source);
  const contentSize = Math.round(media.image.size * (1 - 2 * media.image.margin_percent / 100));
  try {
    const margin = Math.floor((media.image.size - contentSize) / 2);
    return new Uint8Array(await sharp(source, { limitInputPixels: 40_000_000, failOn: "error" }).resize(contentSize, contentSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).extend({ top: margin, bottom: media.image.size - contentSize - margin, left: margin, right: media.image.size - contentSize - margin, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer());
  } catch { throw new Error("That picture could not be prepared. Use a PNG, JPEG or WebP picture and try again."); }
}

export function uploadLabel(fileName: string): string {
  const base = basename(fileName).replace(/\.[^.]*$/, "").trim().slice(0, 80);
  return base || "Uploaded picture";
}
