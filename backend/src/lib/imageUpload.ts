import sharp, { type Metadata } from "sharp";
import { fileTypeFromBuffer } from "file-type";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { MAX_CHAT_IMAGE_BYTES, CHAT_IMAGE_REFUSAL } from "@/wire";

const run = promisify(execFile);

export const MAX_CHAT_IMAGE_PIXELS = 40_000_000;
/** The longest edge a stored picture keeps. The Stack bounds one picture
 * at 2,560 tokens (about a 2,000 pixel photo, measured: VISION-03), so a
 * larger photo only costs upload bytes and storage. Smaller pictures are
 * never enlarged. */
export const MAX_CHAT_IMAGE_EDGE = 2000;
const HEIC_MIMES = ["image/heic", "image/heif"];

/** HEIC (an iPhone's default) is not in the bundled image library's
 * decoder, so on a Mac it is converted by the system's own `sips` (local,
 * built in). Anywhere else the person gets a plain next step. */
async function heicToJpeg(input: Uint8Array): Promise<Uint8Array> {
  if (process.platform !== "darwin") throw new Error("This computer cannot open HEIC pictures. Save it as a JPEG or PNG and add it again.");
  const dir = await mkdtemp(join(tmpdir(), "maipai-heic-"));
  try {
    const source = join(dir, "in.heic");
    const target = join(dir, "out.jpg");
    await writeFile(source, input, { mode: 0o600 });
    await run("/usr/bin/sips", ["-s", "format", "jpeg", source, "--out", target], { timeout: 20_000 });
    return new Uint8Array(await readFile(target));
  } catch {
    throw new Error("That HEIC picture could not be read. Save it as a JPEG or PNG and add it again.");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export interface CleanedChatImage {
  bytes: Uint8Array;
  mediaType: "image/jpeg";
  width: number;
  height: number;
}

export async function cleanChatImage(original: Uint8Array): Promise<CleanedChatImage> {
  if (original.byteLength > MAX_CHAT_IMAGE_BYTES) throw new Error(CHAT_IMAGE_REFUSAL);
  const detected = await fileTypeFromBuffer(original);
  if (!detected || !["image/jpeg", "image/png", "image/webp", "image/gif", ...HEIC_MIMES].includes(detected.mime)) {
    throw new Error("That file is not a supported picture.");
  }
  // sips keeps the EXIF orientation in the JPEG it writes, so the rotate below still applies it.
  const input = HEIC_MIMES.includes(detected.mime) ? await heicToJpeg(original) : original;
  const pipeline = await cleanedImagePipeline(input);
  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  return { bytes: new Uint8Array(data), mediaType: "image/jpeg", width: info.width, height: info.height };
}

export async function chatImageThumbnail(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await sharp(bytes).rotate().resize(512, 512, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer());
}

/** Shared disk-input picture cleaning for Library streams. Never materializes the original file in JS memory. */
export async function cleanChatImageFile(path: string, mediaType: string, target: string): Promise<void> {
  if (Bun.file(path).size > MAX_CHAT_IMAGE_BYTES) throw new Error(CHAT_IMAGE_REFUSAL);
  const converted = `${target}.converted`;
  try {
    let input = path;
    if (HEIC_MIMES.includes(mediaType)) {
      if (process.platform !== "darwin") throw new Error("This computer cannot open HEIC pictures. Save it as a JPEG or PNG and add it again.");
      await run("/usr/bin/sips", ["-s", "format", "jpeg", path, "--out", converted], { timeout: 20_000 });
      input = converted;
    }
    await (await cleanedImagePipeline(input)).toFile(target);
  } finally { await rm(converted, { force: true }); }
}

async function cleanedImagePipeline(input: Uint8Array | string) {
  const pipeline = sharp(input, { limitInputPixels: MAX_CHAT_IMAGE_PIXELS, failOn: "error" });
  let metadata: Metadata;
  try {
    metadata = await pipeline.metadata();
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes("pixel limit")) throw new Error("That picture is too large to process.");
    throw new Error("That picture could not be read.");
  }
  if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_CHAT_IMAGE_PIXELS) {
    throw new Error("That picture is too large to process.");
  }
  // EXIF orientation is applied, then every tag (GPS, camera, time) is dropped: sharp writes none unless asked.
  return pipeline.rotate().resize({ width: MAX_CHAT_IMAGE_EDGE, height: MAX_CHAT_IMAGE_EDGE, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88, mozjpeg: true });
}
