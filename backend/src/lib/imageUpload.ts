import sharp, { type Metadata } from "sharp";
import { fileTypeFromBuffer } from "file-type";
import { MAX_CHAT_IMAGE_BYTES, CHAT_IMAGE_REFUSAL } from "@/wire";

export const MAX_CHAT_IMAGE_PIXELS = 40_000_000;

export interface CleanedChatImage {
  bytes: Uint8Array;
  mediaType: "image/jpeg";
  width: number;
  height: number;
}

export async function cleanChatImage(input: Uint8Array): Promise<CleanedChatImage> {
  if (input.byteLength > MAX_CHAT_IMAGE_BYTES) throw new Error(CHAT_IMAGE_REFUSAL);
  const detected = await fileTypeFromBuffer(input);
  if (!detected || !["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"].includes(detected.mime)) {
    throw new Error("That file is not a supported picture.");
  }
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
  const { data, info } = await pipeline.rotate().jpeg({ quality: 88, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  return { bytes: new Uint8Array(data), mediaType: "image/jpeg", width: info.width, height: info.height };
}

export async function chatImageThumbnail(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await sharp(bytes).rotate().resize(512, 512, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer());
}
