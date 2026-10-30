import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import sharp from "sharp";
import { z } from "zod";
import media from "@maipai/spec/vocab/companion-media.json";
import { householdCompanionFolder } from "@/lib/householdCompanions";
import { chatModelReadsPictures } from "@/lib/chatPictures";
import { markChatReaderUnusable, pictureReader } from "@/lib/pictures/ageCheck";
import { complete } from "@/lib/llm";
import { lookStylePhrase, type LookStyleChoice } from "@/lib/companionLookStyles";
import { preparePicture } from "@/lib/imaging/prepare";
import { imagingTargets } from "@/lib/imaging/targets";

const Source = z.enum(["upload", "generated", "edit"]);
const Version = z.object({ id: z.string().regex(/^v-[0-9]+$/), created_at: z.string().datetime(), source: Source, label: z.string().max(80), width: z.number().int().positive(), height: z.number().int().positive(), from: z.string().nullable(), style: z.string().optional(), steps: z.array(z.string()).optional(), clipped: z.array(z.enum(["left", "right", "top", "bottom"])).optional(), has_original: z.boolean().optional(), model: z.string().nullable().optional(), quality: z.enum(["quick", "detailed"]).nullable().optional(), prompt_hash: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(), model_reported: z.string().nullable().optional() });
const Sheet = z.object({ views: z.object({ left: z.string().nullable(), right: z.string().nullable(), mouth: z.string().nullable() }), card: z.object({ text: z.string().max(600), colours: z.array(z.string().regex(/^#[0-9A-F]{6}$/)).max(8), species: z.string().max(60) }).nullable(), key: z.enum([media.key.default, media.key.alternate]), state: z.enum(["empty", "making", "needs_review", "approved"]), approved_by: z.string().nullable(), approved_at: z.string().datetime().nullable() });
export const LookSchema = z.object({ version: z.literal(1), versions: z.array(Version), rest: z.string().nullable(), key: z.enum([media.key.default, media.key.alternate]), sheet: Sheet.nullable().optional() });
export type LookVersion = z.infer<typeof Version>;
export type CompanionLook = z.infer<typeof LookSchema>;
export type CompanionSheet = z.infer<typeof Sheet>;
export const EMPTY_LOOK: CompanionLook = { version: 1, versions: [], rest: null, key: media.key.default, sheet: null };
/** The longest description of a character Home accepts and sends on; the picture engine itself reads about this much and no more. */
export const PROMPT_MAX_CHARS = 20_000;
export const LOOK_LIMIT_LINE = "This companion already has 60 pictures. Delete some before adding another.";

/** The generated character stays isolated on the companion's chosen key colour until Home removes it. */
export function lookPromptFor(lookPrompt: string, keyHex: string, style?: LookStyleChoice, customStyle?: string): string {
  const keyName = keyHex.toUpperCase() === "#FF00FF" ? "magenta" : "green";
  const subject = lookPrompt.trim().slice(0, PROMPT_MAX_CHARS);
  const phrase = lookStylePhrase(style, customStyle);
  return `${subject}. A single character, full body, centred in the frame, standing in a relaxed neutral pose, facing the viewer, mouth closed, arms down.${phrase ? ` ${phrase}` : ""} Plain solid ${keyName} background, no shadow, no ground, no text, no other objects.`;
}

export const KEY_ALPHA_START = 5;
export const KEY_ALPHA_END = 245;
export const KEY_DESPILL_TOLERANCE = 8;
export const KEY_HUE_DESPILL_TOLERANCE = 6;
export const KEY_BACKGROUND_RING = 2;
export const KEY_HUE_MIN = 30;
export const KEY_PURE_MIN = 200;
export const KEY_HUE_LOW_THRESHOLD = 12;
export const KEY_HUE_THRESHOLD_MIN = 28;
export const KEY_HUE_THRESHOLD_MAX = 44;
export const KEY_HUE_THRESHOLD_SCALE = 0.75;
const KEY_BYTES: Record<string, [number, number, number]> = { "#00FF00": [0, 255, 0], "#FF00FF": [255, 0, 255] };

export const GREEN_HUE_MIN = 70;
export const GREEN_HUE_MAX = 170;
export const GREEN_SATURATION_MIN = 0.25;
export const GREEN_VALUE_MIN = 0.2;
export const GREEN_PIXEL_FRACTION_MIN = 0.03;

export async function chooseKeyColour(png: Uint8Array): Promise<"#00FF00" | "#FF00FF"> {
  const { data } = await sharp(png, { failOn: "error", limitInputPixels: 40_000_000 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let opaque = 0, green = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! !== 255) continue;
    opaque++;
    const r = data[i]! / 255, g = data[i + 1]! / 255, b = data[i + 2]! / 255;
    const hi = Math.max(r, g, b), lo = Math.min(r, g, b), d = hi - lo;
    let hue = 0;
    if (d) hue = hi === r ? 60 * (((g - b) / d) % 6) : hi === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
    if (hue < 0) hue += 360;
    const saturation = hi === 0 ? 0 : d / hi;
    if (hue >= GREEN_HUE_MIN && hue <= GREEN_HUE_MAX && saturation > GREEN_SATURATION_MIN && hi > GREEN_VALUE_MIN) green++;
  }
  return opaque && green / opaque > GREEN_PIXEL_FRACTION_MIN ? "#FF00FF" : "#00FF00";
}

export async function dominantColours(png: Uint8Array, max = 6): Promise<string[]> {
  const { data } = await sharp(png, { failOn: "error", limitInputPixels: 40_000_000 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const counts = new Map<string, number>(); let opaque = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! !== 255) continue;
    opaque++;
    const rgb = [data[i]!, data[i + 1]!, data[i + 2]!].map((v) => Math.min(255, Math.floor(v / 16) * 16));
    const key = `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([colour, count]) => {
    const [r, g, b] = [1, 3, 5].map((offset) => Number.parseInt(colour.slice(offset, offset + 2), 16));
    const nearWhiteOrBlack = (r! >= 240 && g! >= 240 && b! >= 240) || (r! < 32 && g! < 32 && b! < 32);
    return !nearWhiteOrBlack || count / Math.max(opaque, 1) >= 0.02;
  }).sort((a, b) => b[1] - a[1]).slice(0, Math.max(0, max)).map(([colour]) => colour);
}

let characterCompletion = complete;
export function __setCharacterCompletionForTests(fn: typeof complete | undefined): void { characterCompletion = fn ?? complete; }
export function __setCharacterPictureCapabilityForTests(value: { imageParts: boolean; pictureTokensMax: number | null } | null): void { characterCapabilityOverride = value; }
let characterCapabilityOverride: { imageParts: boolean; pictureTokensMax: number | null } | null = null;
export async function describeCharacter(png: Uint8Array, lookPrompt: string): Promise<{ card: { text: string; colours: string[]; species: string }; card_source: "model" | "look_prompt" }> {
  const colours = await dominantColours(png);
  try {
    const override = characterCapabilityOverride;
    const capability = override ?? await chatModelReadsPictures();
    // The Stack's chat row can claim picture input while the running chat server is language-only; the vision role reads then
    // (the same fallback the picture safety check uses).
    let role: "chat" | "vision" | null = override ? "chat" : await pictureReader();
    if (!role || (role === "chat" && (!capability.imageParts || !capability.pictureTokensMax))) role = override ? null : await pictureReader();
    if (!role) throw new Error("Picture reading is unavailable.");
    const jpeg = await sharp(png, { failOn: "error", limitInputPixels: 40_000_000 }).flatten({ background: "white" }).resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
    const schema = { name: "character_description", strict: true, schema: { type: "object", additionalProperties: false, required: ["species", "description"], properties: { species: { type: "string" }, description: { type: "string" } } } } as const;
    const prompt = "Describe only what is visible; do not name a real person. Write one factual paragraph of at most 90 words naming the species, body build, face and nose, fur or skin colours, clothing and accessories. Say nothing about mood.";
    const ask = async (reader: "chat" | "vision") => characterCompletion(reader, [{ role: "user", content: prompt, images: [{ id: "companion-look", name: "character picture", url: `data:image/jpeg;base64,${jpeg.toString("base64")}`, reservedTokens: reader === "chat" ? (capability.pictureTokensMax ?? 2560) : 2560 }] }], { temperature: 0, max_tokens: 180, thinking: false, dropReasoning: true, response_format: { type: "json_schema", json_schema: schema } });
    let result = await ask(role);
    if (!result.ok && role === "chat" && !override) {
      markChatReaderUnusable();
      const next = await pictureReader();
      if (next && next !== "chat") result = await ask(next);
    }
    if (!result.ok) throw new Error("The picture description could not be read.");
    const parsed = JSON.parse(result.value.text) as { species?: unknown; description?: unknown };
    if (typeof parsed.species !== "string" || typeof parsed.description !== "string" || !parsed.description.trim()) throw new Error("The picture description was incomplete.");
    return { card: { text: parsed.description.trim().slice(0, 600), colours, species: parsed.species.trim().slice(0, 60) }, card_source: "model" };
  } catch {
    // Never block a picture the person chose: with no typed look prompt and no reader, the card says to draw exactly what the picture shows.
    const typed = lookPrompt.trim().slice(0, 600);
    return { card: { text: typed || "The character shown in the starting picture, drawn exactly as it appears there, with the same face, colours and clothing.", colours, species: "" }, card_source: "look_prompt" };
  }
}

function saveLook(id: string, look: CompanionLook): void { const path = manifestPath(id); if (!path) throw new Error("That household companion could not be found."); const dir = lookFolder(id)!; mkdirSync(dir, { recursive: true }); atomicJson(path, look); }
export function updateSheet(id: string, sheet: CompanionSheet | null): void { saveLook(id, { ...readLook(id), ...(sheet ? { key: sheet.key } : {}), sheet }); }
export function setSheetCard(id: string, card: { text: string; species?: string }): void { const look = readLook(id); if (!look.sheet) throw new Error("Make the character sheet before editing its card. Start the sheet job, then try again."); const nextCard = { text: card.text, species: card.species ?? look.sheet.card?.species ?? "", colours: look.sheet.card?.colours ?? [] }; saveLook(id, { ...look, sheet: { ...look.sheet, card: nextCard, state: "needs_review", approved_by: null, approved_at: null } }); }
export function setSheetKey(id: string, key: "#00FF00" | "#FF00FF"): void { const look = readLook(id); if (!look.sheet) throw new Error("Make the character sheet before changing its key colour. Start the sheet job, then try again."); saveLook(id, { ...look, key, sheet: { ...look.sheet, key, state: "needs_review", approved_by: null, approved_at: null } }); }
export function approveSheet(id: string, displayName: string): CompanionSheet {
  const look = readLook(id), sheet = look.sheet;
  if (!look.rest) throw new Error("Choose a rest picture before approving the character sheet.");
  if (!sheet?.card) throw new Error("Add a description card before approving the character sheet. Make the sheet or write the card first.");
  const approved = { ...sheet, state: "approved" as const, approved_by: displayName, approved_at: new Date().toISOString() };
  saveLook(id, { ...look, sheet: approved }); return approved;
}
export function unapproveSheet(id: string): CompanionSheet {
  const look = readLook(id); if (!look.sheet) throw new Error("Make the character sheet before asking for another review.");
  const sheet = { ...look.sheet, state: "needs_review" as const, approved_by: null, approved_at: null }; saveLook(id, { ...look, sheet }); return sheet;
}

export function keyRgb(keyHex: string): [number, number, number] {
  const rgb = KEY_BYTES[keyHex.toUpperCase()];
  if (!rgb) throw new Error("Choose green or magenta as the background key.");
  return rgb;
}

/** Replaces key-colour pixels with transparency and removes the key tint from antialiased edges. */
export async function keyOut(png: Uint8Array, keyHex: string): Promise<Uint8Array> {
  const key = keyRgb(keyHex);
  const decoded = await sharp(png, { limitInputPixels: 40_000_000, failOn: "error" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = keyOutRgbaBuffer(decoded.data, decoded.info.width, decoded.info.height, keyHex);
  return new Uint8Array(await sharp(pixels, { raw: decoded.info }).png().toBuffer());
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
function keyness(r: number, g: number, b: number, greenKey: boolean): number { return greenKey ? g - Math.max(r, b) : Math.min(r, b) - g; }
function pureKeyAlpha(r: number, g: number, b: number, key: [number, number, number]): number {
  const coverage = key[1] === 255 ? Math.min(g, 255 - r, 255 - b) / 255 : Math.min(r, b, 255 - g) / 255;
  const rawAlpha = clamp(1 - coverage, 0, 1) * 255;
  return Math.round(clamp((rawAlpha - KEY_ALPHA_START) / (KEY_ALPHA_END - KEY_ALPHA_START), 0, 1) * 255);
}
export function keyOutRgbaBuffer(pixels: Uint8Array, width: number, height: number, keyHex: string): Uint8Array {
  const key = keyRgb(keyHex), greenKey = key[1] === 255, samples: [number[], number[], number[]] = [[], [], []];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (x >= KEY_BACKGROUND_RING && x < width - KEY_BACKGROUND_RING && y >= KEY_BACKGROUND_RING && y < height - KEY_BACKGROUND_RING) continue;
    const offset = (y * width + x) * 4;
    if ((y * width + x) % 2 !== 0) continue;
    for (let channel = 0; channel < 3; channel++) samples[channel]!.push(pixels[offset + channel]!);
  }
  const background = samples.map((values) => { values.sort((a, b) => a - b); return values[Math.floor(values.length / 2)] ?? 0; }) as [number, number, number];
  const bgKeyness = keyness(...background, greenKey);
  const hueRegime = bgKeyness >= KEY_HUE_MIN && bgKeyness < KEY_PURE_MIN;
  const threshold = clamp(bgKeyness * KEY_HUE_THRESHOLD_SCALE, KEY_HUE_THRESHOLD_MIN, KEY_HUE_THRESHOLD_MAX);
  for (let offset = 0; offset + 3 < pixels.length; offset += 4) {
    const r = pixels[offset]!, g = pixels[offset + 1]!, b = pixels[offset + 2]!, incoming = pixels[offset + 3]!;
    let alpha: number;
    if (hueRegime) {
      const amount = clamp(1 - (keyness(r, g, b, greenKey) - KEY_HUE_LOW_THRESHOLD) / (threshold - KEY_HUE_LOW_THRESHOLD), 0, 1);
      alpha = Math.round(amount * 255);
      if (amount > 0 && amount < 1) {
        const channels = [r, g, b];
        for (let channel = 0; channel < 3; channel++) pixels[offset + channel] = clamp(Math.round((channels[channel]! - background[channel]! * (1 - amount)) / amount), 0, 255);
        if (greenKey) pixels[offset + 1] = Math.min(pixels[offset + 1]!, Math.max(pixels[offset]!, pixels[offset + 2]!) + KEY_HUE_DESPILL_TOLERANCE);
      }
    } else {
      alpha = pureKeyAlpha(r, g, b, key);
      if (alpha > 0 && alpha < 255) {
        const coverage = alpha / 255, channels = [r, g, b];
        for (let channel = 0; channel < 3; channel++) pixels[offset + channel] = clamp(Math.round((channels[channel]! - key[channel]! * (1 - coverage)) / coverage), 0, 255);
        if (greenKey) pixels[offset + 1] = Math.min(pixels[offset + 1]!, Math.max(pixels[offset]!, pixels[offset + 2]!) + KEY_DESPILL_TOLERANCE);
      }
    }
    pixels[offset + 3] = Math.min(incoming, alpha);
  }
  return pixels;
}

/** Makes a transparent look picture opaque on the selected key for a reference edit. */
export async function compositeOnKey(png: Uint8Array, keyHex: string): Promise<Uint8Array> {
  const [r, g, b] = keyRgb(keyHex);
  return new Uint8Array(await sharp(png, { limitInputPixels: 40_000_000, failOn: "error" }).flatten({ background: { r, g, b } }).png().toBuffer());
}

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

export function versionOriginalPath(id: string, versionId: string): string | null {
  if (!/^v-[0-9]+$/.test(versionId)) return null;
  const dir = lookFolder(id);
  const path = dir ? join(dir, `${versionId}.orig.png`) : null;
  return path && existsSync(path) ? path : null;
}

export function addVersion(id: string, png: Uint8Array, meta: Omit<LookVersion, "id" | "created_at" | "width" | "height" | "has_original"> & { width: number; height: number }, original?: Uint8Array): LookVersion {
  const dir = lookFolder(id), path = manifestPath(id), seqPath = sequencePath(id);
  if (!dir || !path || !seqPath) throw new Error("That household companion could not be found.");
  const look = readLook(id);
  if (look.versions.length >= 60) throw new Error(LOOK_LIMIT_LINE);
  mkdirSync(dir, { recursive: true });
  const prior = Number(readFileSyncSafe(seqPath));
  const idNum = Math.max(Number.isSafeInteger(prior) ? prior : 0, ...look.versions.map((v) => Number(v.id.slice(2)))) + 1;
  const version: LookVersion = { id: `v-${idNum}`, created_at: new Date().toISOString(), source: meta.source, label: meta.label.slice(0, 80), width: meta.width, height: meta.height, from: meta.from, ...(meta.style !== undefined ? { style: meta.style } : {}), ...(meta.steps !== undefined ? { steps: meta.steps } : {}), ...(meta.clipped !== undefined ? { clipped: meta.clipped } : {}), ...(meta.model !== undefined ? { model: meta.model } : {}), ...(meta.quality !== undefined ? { quality: meta.quality } : {}), ...(meta.prompt_hash !== undefined ? { prompt_hash: meta.prompt_hash } : {}), ...(meta.model_reported !== undefined ? { model_reported: meta.model_reported } : {}), ...(original ? { has_original: true } : {}) };
  const filePath = versionPath(id, version.id)!;
  const temp = `${filePath}.${crypto.randomUUID()}.tmp`;
  try {
    writeFileSync(seqPath, String(idNum), "utf8");
    writeFileSync(temp, png, { flag: "wx" });
    renameSync(temp, filePath);
    if (original) writeFileSync(join(dir, `${version.id}.orig.png`), original, { flag: "wx" });
    const next = { ...look, versions: [...look.versions, version], rest: look.rest ?? version.id };
    atomicJson(path, next);
    return version;
  } catch (error) { rmSync(temp, { force: true }); rmSync(filePath, { force: true }); rmSync(join(dir, `${version.id}.orig.png`), { force: true }); throw error; }
}
function readFileSyncSafe(path: string): string { try { return readFileSync(path, "utf8"); } catch { return "0"; } }

export function deleteVersion(id: string, versionId: string): boolean {
  const path = manifestPath(id), image = versionPath(id, versionId);
  if (!path || !image) throw new Error("That picture ID is not valid.");
  const look = readLook(id);
  if (look.rest === versionId) throw new Error("That picture is the approved starting picture. Pick another one first.");
  if (!look.versions.some((item) => item.id === versionId)) return false;
  const sheet = look.sheet ? { ...look.sheet, views: { left: look.sheet.views.left === versionId ? null : look.sheet.views.left, right: look.sheet.views.right === versionId ? null : look.sheet.views.right, mouth: look.sheet.views.mouth === versionId ? null : look.sheet.views.mouth }, ...(look.sheet.state === "approved" && Object.values(look.sheet.views).includes(versionId) ? { state: "needs_review" as const, approved_by: null, approved_at: null } : {}) } : null;
  const next = { ...look, versions: look.versions.filter((item) => item.id !== versionId), sheet };
  atomicJson(path, next);
  rmSync(image, { force: true });
  rmSync(join(lookFolder(id)!, `${versionId}.orig.png`), { force: true });
  return true;
}
export function setRest(id: string, versionId: string): boolean {
  const path = manifestPath(id);
  if (!path) throw new Error("That household companion could not be found.");
  const look = readLook(id);
  if (!look.versions.some((item) => item.id === versionId)) return false;
  atomicJson(path, { ...look, rest: versionId, ...(look.rest !== versionId ? { sheet: null } : {}) });
  return true;
}
export function deleteLook(id: string): void { const dir = lookFolder(id); if (dir) rmSync(dir, { recursive: true, force: true }); }

export type BackgroundRemover = (bytes: Uint8Array) => Promise<Uint8Array>;
export type PictureUpscaler = (bytes: Uint8Array) => Promise<Uint8Array>;
/** A sentence that came from a picture tool (the background remover, the upscaler). It reaches the person exactly as written. */
class PictureToolFailure extends Error {}
/** The largest side kept for preparing a picture; the frame is 1024, so a bigger picture only costs memory. */
const PREPARE_MAX_SIDE = 4096;
const READ_FAILURE_LINE = "That picture could not be read. Use a PNG, JPEG or WebP picture and try again.";
const NOTHING_FOUND_LINE = "I couldn't find anything in that picture. Try a different picture.";
const asToolFailure = (tool: (bytes: Uint8Array) => Promise<Uint8Array>) => async (bytes: Uint8Array): Promise<Uint8Array> => {
  try { return await tool(bytes); }
  catch (error) { throw new PictureToolFailure(error instanceof Error && error.message ? error.message : "The picture tools could not finish. Try again in a moment."); }
};
export async function normalizePicture(bytes: Uint8Array, options: { removeBackground: BackgroundRemover; upscale?: PictureUpscaler }): Promise<Uint8Array> {
  let source: Uint8Array;
  try {
    // Shrink on load: a 48 megapixel phone photo must not fail the pixel limit or fill memory for a 1024 pixel frame.
    source = new Uint8Array(await sharp(bytes, { limitInputPixels: 268_402_689, failOn: "error" }).rotate().resize({ width: PREPARE_MAX_SIDE, height: PREPARE_MAX_SIDE, fit: "inside", withoutEnlargement: true }).png().toBuffer());
  } catch { throw new Error(READ_FAILURE_LINE); }
  const localUpscale = async (image: Uint8Array) => new Uint8Array(await sharp(image, { limitInputPixels: 40_000_000, failOn: "error" }).resize(imagingTargets.portrait.size, imagingTargets.portrait.size, { fit: "inside" }).png().toBuffer());
  try {
    const result = await preparePicture(source, { ...imagingTargets.portrait, upscaleBelowShortSide: imagingTargets.portrait.size, removeBackground: asToolFailure(options.removeBackground), upscale: options.upscale ? asToolFailure(options.upscale) : localUpscale });
    return result.bytes;
  } catch (error) {
    if (error instanceof PictureToolFailure) throw new Error(error.message);
    if (error instanceof Error && error.message === "That picture has no visible subject.") throw new Error(NOTHING_FOUND_LINE);
    // The missing-tool sentences preparePicture itself throws already say what to install.
    if (error instanceof Error && (error.message.startsWith("The background remover") || error.message.startsWith("The upscaler"))) throw error;
    throw new Error("That picture could not be prepared. Try a different picture, or a smaller one.");
  }
}

export function uploadLabel(fileName: string): string {
  const base = basename(fileName).replace(/\.[^.]*$/, "").trim().slice(0, 80);
  return base || "Uploaded picture";
}
