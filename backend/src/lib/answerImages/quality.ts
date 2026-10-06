import { createHash } from "node:crypto";
import sharp, { type Metadata, type Stats } from "sharp";
import { fileTypeFromBuffer } from "file-type";
import imghash from "imghash";
import fingerprints from "./fingerprints.json";

// Dependency evidence checked 2026-10-06: sharp 0.35.5 (2026-09 release,
// 133.7M npm downloads/week) loaded and decoded a PNG under Bun; file-type
// 22.1.1 (2026-09 release, 69.4M/week) loaded as ESM under Bun; imghash
// 1.1.4 (2026-04-25, 94.4K/week) exports hashRaw under Bun. Versions are
// package-manager managed, never vendored.

export type AnswerImageCandidate = { id: string; bytes: Uint8Array; contentType: string; leadImage?: boolean; sourceHost?: string };
export type PerceptualHashes = { dhash: string[]; phash: string[] };
export type ValidatedAnswerImage = { id: string; tile: Uint8Array; full: Uint8Array; width: number; height: number; leadImage: boolean; sharpness: number; hash: PerceptualHashes };
export type QualityDropReason = "not_image" | "unsupported_format" | "animated_image" | "decode_error" | "too_small" | "bad_aspect_ratio" | "known_placeholder" | "flat_or_text" | "low_bytes_per_pixel" | "mostly_transparent" | "stock_preview" | "duplicate";
export type QualityResult = { images: ValidatedAnswerImage[]; dropped_by_quality: Partial<Record<QualityDropReason, number>> };

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
// Fixture calibration (720x540 photo, 480/320/600 px encodes, two crops, and
// an unrelated synthetic shot), using each image's full, centre-80%, and
// centre-60% dHash/pHash: duplicate pairs' nearest distance is at most 5/64;
// the different shot is at least 24/64 away. Threshold 10/64 separates them.
const HAMMING_THRESHOLD = 10;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const MIME_BY_EXT: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", avif: "image/avif" };

function hamming(a: string, b: string): number {
  if (a.length === 64 && b.length === 64 && /^[01]+$/.test(a) && /^[01]+$/.test(b)) {
    return [...a].reduce((n, bit, i) => n + Number(bit !== b[i]), 0);
  }
  let n = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    let v = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    while (v) { n += v & 1; v >>>= 1; }
  }
  return n;
}

async function hashes(input: Uint8Array): Promise<PerceptualHashes> {
  const meta = await sharp(input, { limitInputPixels: MAX_PIXELS, animated: false }).metadata();
  const width = meta.width!, height = meta.height!;
  const crops = [1, 0.8, 0.6].map(r => {
    const w = Math.max(1, Math.floor(width * r)), h = Math.max(1, Math.floor(height * r));
    return { left: Math.floor((width - w) / 2), top: Math.floor((height - h) / 2), w, h };
  });
  const dhash: string[] = [];
  const phash: string[] = [];
  for (const crop of crops) {
    const { data: gray, info: gi } = await sharp(input, { limitInputPixels: MAX_PIXELS }).extract({ left: crop.left, top: crop.top, width: crop.w, height: crop.h }).resize(9, 8, { fit: "fill" }).greyscale().raw().toBuffer({ resolveWithObject: true });
    let differenceHash = "";
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) differenceHash += gray[y * gi.width + x]! > gray[y * gi.width + x + 1]! ? "1" : "0";
    dhash.push(differenceHash);
    const { data: pixels, info: pi } = await sharp(input, { limitInputPixels: MAX_PIXELS }).extract({ left: crop.left, top: crop.top, width: crop.w, height: crop.h }).resize(32, 32, { fit: "fill" }).greyscale().raw().toBuffer({ resolveWithObject: true });
    phash.push(imghash.hashRaw({ width: pi.width, height: pi.height, data: pixels }, 16));
  }
  return { dhash, phash };
}

function nearestDistance(a: PerceptualHashes, b: PerceptualHashes): number {
  let min = 64;
  for (const x of a.dhash) for (const y of b.dhash) min = Math.min(min, hamming(x, y));
  for (const x of a.phash) for (const y of b.phash) min = Math.min(min, hamming(x, y));
  return min;
}

export async function filterAnswerImages(candidates: AnswerImageCandidate[]): Promise<QualityResult> {
  const dropped_by_quality: QualityResult["dropped_by_quality"] = {};
  const drop = (reason: QualityDropReason) => { dropped_by_quality[reason] = (dropped_by_quality[reason] ?? 0) + 1; };
  const valid: ValidatedAnswerImage[] = [];
  for (const candidate of candidates) {
    if (candidate.bytes.byteLength > MAX_BYTES) { drop("decode_error"); continue; }
    const declared = candidate.contentType.split(";")[0]!.trim().toLowerCase();
    if (declared === "image/gif") { drop("animated_image"); continue; }
    const detected = await fileTypeFromBuffer(candidate.bytes).catch(() => undefined);
    if (!detected && declared !== "image/svg+xml") { drop("not_image"); continue; }
    if (!ALLOWED.has(declared) || !detected || MIME_BY_EXT[detected.ext] !== declared) { drop("unsupported_format"); continue; }
    let metadata: Metadata;
    try { metadata = await sharp(candidate.bytes, { limitInputPixels: MAX_PIXELS, failOn: "error" }).metadata(); }
    catch { drop("decode_error"); continue; }
    if ((metadata.pages ?? 1) > 1) { drop("animated_image"); continue; }
    if (!metadata.width || !metadata.height) { drop("decode_error"); continue; }
    const short = Math.min(metadata.width, metadata.height);
    if (short < (candidate.leadImage ? 400 : 200)) { drop("too_small"); continue; }
    const ratio = metadata.width / metadata.height;
    if (ratio < 0.4 || ratio > 2.5) { drop("bad_aspect_ratio"); continue; }
    const digest = createHash("sha256").update(candidate.bytes).digest("hex");
    if (fingerprints.sha256.includes(digest)) { drop("known_placeholder"); continue; }
    if (declared === "image/jpeg" && metadata.width * metadata.height >= 1_000_000 && candidate.bytes.byteLength / (metadata.width * metadata.height) < 0.02) { drop("low_bytes_per_pixel"); continue; }
    let stat: Stats;
    let hs: Awaited<ReturnType<typeof hashes>>;
    try {
      const pipeline = sharp(candidate.bytes, { limitInputPixels: MAX_PIXELS });
      [stat, hs] = await Promise.all([pipeline.stats(), hashes(candidate.bytes)]);
    } catch { drop("decode_error"); continue; }
    const raw = await sharp(candidate.bytes, { limitInputPixels: MAX_PIXELS }).resize(64, 64, { fit: "fill" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alphaValues = raw.data.filter((_, i) => i % raw.info.channels === 3);
    if (alphaValues.length && alphaValues.filter(a => a < 128).length / alphaValues.length > 0.3) { drop("mostly_transparent"); continue; }
    const gray = stat.channels.slice(0, 3).reduce((sum, channel) => sum + channel.stdev, 0) / 3;
    if (gray < 2) { drop("known_placeholder"); continue; }
    if (fingerprints.dhash.some(hash => hs.dhash.some(actual => hamming(hash, actual) === 0))) { drop("known_placeholder"); continue; }
    const colors = new Map<string, number>();
    for (let i = 0; i < raw.data.length; i += raw.info.channels) {
      const key = `${raw.data[i]}:${raw.data[i + 1]}:${raw.data[i + 2]}`;
      colors.set(key, (colors.get(key) ?? 0) + 1);
    }
    const topTwo = [...colors.values()].sort((a, b) => b - a).slice(0, 2).reduce((a, b) => a + b, 0) / (64 * 64);
    if (gray < 8 || topTwo >= 0.9 || hs.dhash.some(hash => hash === "0".repeat(64) || hash === "1".repeat(64))) { drop("flat_or_text"); continue; }
    const sourceHost = candidate.sourceHost?.toLowerCase().replace(/\.$/, "");
    if (sourceHost && fingerprints.stock_hosts.some(host => sourceHost === host || sourceHost.endsWith(`.${host}`))) { drop("stock_preview"); continue; }
    const full = await sharp(candidate.bytes, { limitInputPixels: MAX_PIXELS }).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 86 }).toBuffer();
    const tile = await sharp(candidate.bytes, { limitInputPixels: MAX_PIXELS }).rotate().resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    valid.push({ id: candidate.id, tile: new Uint8Array(tile), full: new Uint8Array(full), width: metadata.width, height: metadata.height, leadImage: candidate.leadImage ?? false, sharpness: stat.sharpness, hash: hs });
  }
  valid.sort((a, b) => Number(b.leadImage) - Number(a.leadImage) || b.width * b.height - a.width * a.height || b.sharpness - a.sharpness);
  const chosen: ValidatedAnswerImage[] = [];
  for (const image of valid) {
    if (chosen.some(other => nearestDistance(image.hash, other.hash) <= HAMMING_THRESHOLD)) { drop("duplicate"); continue; }
    chosen.push(image);
  }
  return { images: chosen, dropped_by_quality };
}
