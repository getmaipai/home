import { createHash } from "node:crypto";
import sharp, { type Metadata, type Stats } from "sharp";
import { fileTypeFromBuffer } from "file-type";
import phash from "sharp-phash";
import fingerprints from "./fingerprints.json";

// Dependency evidence checked 2026-10-06: sharp 0.35.5 (2026-09 release,
// 133.7M npm downloads/week) loaded and decoded a PNG under Bun; file-type
// 22.1.1 (2026-09 release, 69.4M/week) loaded as ESM under Bun; sharp-phash
// 2.2.0 (MIT, no dependencies, peer sharp >= 0.32) gives the 64-bit DCT
// pHash under Bun (IMGQ-01: it replaced imghash, whose hashRaw is a 256-bit
// blockhash that was being judged against a 64-bit threshold). Versions are
// package-manager managed, never vendored.

export type AnswerImageCandidate = { id: string; bytes: Uint8Array; contentType: string; leadImage?: boolean; sourceHost?: string };
/** Each hash is 64 "0"/"1" characters: `d` dHash, `p` DCT pHash. */
export type PerceptualHashes = { full: { d: string; p: string }; others: { d: string; p: string }[] };
export type ValidatedAnswerImage = { id: string; tile: Uint8Array; full: Uint8Array; width: number; height: number; leadImage: boolean; sharpness: number; hash: PerceptualHashes };
export type QualityDropReason = "not_image" | "unsupported_format" | "animated_image" | "decode_error" | "too_small" | "bad_aspect_ratio" | "known_placeholder" | "flat_or_text" | "low_bytes_per_pixel" | "mostly_transparent" | "stock_preview" | "screenshot" | "duplicate";
export type QualityResult = { images: ValidatedAnswerImage[]; dropped_by_quality: Partial<Record<QualityDropReason, number>> };

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
// IMGQ-01 (design: data-scratch/research/image-quality-design.md section 4,
// measured on the 58 live tiles of ANSWER-IMG-05 and generated variants):
// two pictures are the same when either 64-bit hash (DCT pHash or dHash) of
// one's full frame is within 10 bits of the other's full frame, centre crop
// or mirror. Every tolerated edit (rescale to 200 px, JPEG 35, tone,
// greyscale, a watermark, a 6 percent border, centre crops to 60 percent)
// lands at or under 10 on one hash; the closest different pair of 1,653 was
// 16 bits apart in the design's run. Measured again on this code with the
// 69 distinct live tiles of ANSWER-IMG-05 run 3: see the regression test.
const HAMMING_THRESHOLD = 10;
/** Centre crops each picture is also hashed at. */
const CROPS = [0.9, 0.8, 0.7, 0.6];
/** The one decode every hash is taken from: greyscale, this many pixels a side. */
const HASH_BASE = 256;
// A PNG at exactly one of these sizes with no camera record is a screen
// capture (a teen's red panda set showed a desktop screenshot). Commons serves
// 1280 px wide thumbnails, so the 1280 px renders of the larger sizes are here.
const SCREEN_SIZES = new Set(["1024x768", "1280x720", "1280x800", "1280x1024", "1366x768", "1440x900", "1536x864", "1600x900", "1680x1050", "1920x1080", "1920x1200", "2560x1440", "2560x1600", "2880x1800", "3840x2160", "3024x1964", "3456x2234"]);
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const MIME_BY_EXT: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", avif: "image/avif" };

function hamming(a: string, b: string): number {
  let n = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) n++;
  return n + Math.abs(a.length - b.length);
}

type Raw = { data: Buffer; width: number; height: number };

function dhashOf(raw: Raw): Promise<string> {
  return sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 1 } }).resize(9, 8, { fit: "fill" }).toColourspace("b-w").raw().toBuffer().then((g) => {
    let bits = "";
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += g[y * 9 + x]! > g[y * 9 + x + 1]! ? "1" : "0";
    return bits;
  });
}

async function variantHashes(raw: Raw): Promise<{ d: string; p: string }> {
  const [d, p] = await Promise.all([dhashOf(raw), phash(raw.data, { raw: { width: raw.width, height: raw.height, channels: 1 } })]);
  return { d, p };
}

/** `full`: the whole frame; `others`: its centre crops, then its mirror last. */
export async function hashes(input: Uint8Array): Promise<PerceptualHashes> {
  const base = await sharp(input, { limitInputPixels: MAX_PIXELS }).rotate().removeAlpha().toColourspace("b-w").resize(HASH_BASE, HASH_BASE, { fit: "fill" }).raw().toBuffer();
  const full: Raw = { data: base, width: HASH_BASE, height: HASH_BASE };
  const crops = await Promise.all(CROPS.map(async (r) => {
    const side = Math.max(8, Math.round(HASH_BASE * r));
    const off = Math.floor((HASH_BASE - side) / 2);
    const data = await sharp(base, { raw: { width: HASH_BASE, height: HASH_BASE, channels: 1 } }).extract({ left: off, top: off, width: side, height: side }).toColourspace("b-w").raw().toBuffer();
    return { data, width: side, height: side };
  }));
  const mirror: Raw = { data: await sharp(base, { raw: { width: HASH_BASE, height: HASH_BASE, channels: 1 } }).flop().toColourspace("b-w").raw().toBuffer(), width: HASH_BASE, height: HASH_BASE };
  const [f, ...rest] = await Promise.all([full, ...crops, mirror].map(variantHashes));
  return { full: f!, others: rest };
}

/** The smallest distance between one picture's full frame and the other's
 * full frame or centre crops (either hash), or its mirror (pHash only: a
 * mirrored dHash came within 11 bits of an unrelated picture in the live
 * tiles, a portrait against a beach), either way round. */
export function nearestDistance(a: PerceptualHashes, b: PerceptualHashes): number {
  let min = 64;
  for (const [x, y] of [[a, b], [b, a]] as const) {
    const crops = y.others.slice(0, -1);
    const mirror = y.others.at(-1)!;
    for (const z of [y.full, ...crops]) min = Math.min(min, hamming(x.full.d, z.d), hamming(x.full.p, z.p));
    min = Math.min(min, hamming(x.full.p, mirror.p));
  }
  return min;
}

/** One candidate's checks, in order: the first failing check's reason, or
 * the validated picture. */
async function checkOne(candidate: AnswerImageCandidate): Promise<ValidatedAnswerImage | QualityDropReason> {
  if (candidate.bytes.byteLength > MAX_BYTES) return "decode_error";
  const declared = candidate.contentType.split(";")[0]!.trim().toLowerCase();
  if (declared === "image/gif") return "animated_image";
  const detected = await fileTypeFromBuffer(candidate.bytes).catch(() => undefined);
  if (!detected && declared !== "image/svg+xml") return "not_image";
  if (!ALLOWED.has(declared) || !detected || MIME_BY_EXT[detected.ext] !== declared) return "unsupported_format";
  let metadata: Metadata;
  try { metadata = await sharp(candidate.bytes, { limitInputPixels: MAX_PIXELS, failOn: "error" }).metadata(); }
  catch { return "decode_error"; }
  if ((metadata.pages ?? 1) > 1) return "animated_image";
  if (!metadata.width || !metadata.height) return "decode_error";
  // A PNG at exactly a screen's size with no camera record is a screen
  // capture (IMGQ-02's third screenshot leg; the caption legs are in
  // relevance.ts). A 16:9 photo thumbnailed to 1280 wide is also 1280x720,
  // so the size alone is never enough: a camera's EXIF keeps it.
  if (declared === "image/png" && SCREEN_SIZES.has(`${metadata.width}x${metadata.height}`) && !metadata.exif) return "screenshot";
  const short = Math.min(metadata.width, metadata.height);
  if (short < (candidate.leadImage ? 400 : 200)) return "too_small";
  const ratio = metadata.width / metadata.height;
  if (ratio < 0.4 || ratio > 2.5) return "bad_aspect_ratio";
  const digest = createHash("sha256").update(candidate.bytes).digest("hex");
  if (fingerprints.sha256.includes(digest)) return "known_placeholder";
  // IMGQ-02: at 1 MP and up a photo cannot stay under these sizes; an
  // upscaled blur or a flat synthetic frame cannot reach them.
  const bytesPerPixel = candidate.bytes.byteLength / (metadata.width * metadata.height);
  const bppFloor = declared === "image/jpeg" ? 0.02 : declared === "image/webp" ? 0.015 : declared === "image/png" ? 0.01 : 0;
  if (metadata.width * metadata.height >= 1_000_000 && bytesPerPixel < bppFloor) return "low_bytes_per_pixel";
  let stat: Stats;
  let hs: Awaited<ReturnType<typeof hashes>>;
  try {
    const pipeline = sharp(candidate.bytes, { limitInputPixels: MAX_PIXELS });
    [stat, hs] = await Promise.all([pipeline.stats(), hashes(candidate.bytes)]);
  } catch { return "decode_error"; }
  const raw = await sharp(candidate.bytes, { limitInputPixels: MAX_PIXELS }).resize(64, 64, { fit: "fill" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alphaValues = raw.data.filter((_, i) => i % raw.info.channels === 3);
  if (alphaValues.length && alphaValues.filter(a => a < 128).length / alphaValues.length > 0.3) return "mostly_transparent";
  const gray = stat.channels.slice(0, 3).reduce((sum, channel) => sum + channel.stdev, 0) / 3;
  if (gray < 2) return "known_placeholder";
  if (fingerprints.dhash.some(hash => hamming(hash, hs.full.d) === 0)) return "known_placeholder";
  const colors = new Map<string, number>();
  for (let i = 0; i < raw.data.length; i += raw.info.channels) {
    const key = `${raw.data[i]}:${raw.data[i + 1]}:${raw.data[i + 2]}`;
    colors.set(key, (colors.get(key) ?? 0) + 1);
  }
  const topTwo = [...colors.values()].sort((a, b) => b - a).slice(0, 2).reduce((a, b) => a + b, 0) / (64 * 64);
  // IMGQ-02: greyscale histogram entropy under 3.0 bits is a placeholder,
  // card or flat frame (measured: placeholders at most 0.38, the 58 live
  // tiles at least 4.90).
  if (stat.entropy < 3.0 || gray < 8 || topTwo >= 0.9 || hs.full.d === "0".repeat(64) || hs.full.d === "1".repeat(64)) return "flat_or_text";
  const sourceHost = candidate.sourceHost?.toLowerCase().replace(/\.$/, "");
  if (sourceHost && fingerprints.stock_hosts.some(host => sourceHost === host || sourceHost.endsWith(`.${host}`))) return "stock_preview";
  const full = await sharp(candidate.bytes, { limitInputPixels: MAX_PIXELS }).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 86 }).toBuffer();
  const tile = await sharp(candidate.bytes, { limitInputPixels: MAX_PIXELS }).rotate().resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  return { id: candidate.id, tile: new Uint8Array(tile), full: new Uint8Array(full), width: metadata.width, height: metadata.height, leadImage: candidate.leadImage ?? false, sharpness: stat.sharpness, hash: hs };
}

/** Pictures validated at once; each check decodes the picture several times
 * (about 175 ms for a 1280 px photo), so a set of twelve one after another
 * missed the turn's picture budget (ANSWER-IMG-05, 2026-10-06). */
const VALIDATE_AT_ONCE = 4;

export async function filterAnswerImages(candidates: AnswerImageCandidate[]): Promise<QualityResult> {
  const dropped_by_quality: QualityResult["dropped_by_quality"] = {};
  const drop = (reason: QualityDropReason) => { dropped_by_quality[reason] = (dropped_by_quality[reason] ?? 0) + 1; };
  const outcomes: (ValidatedAnswerImage | QualityDropReason)[] = new Array(candidates.length);
  let next = 0;
  const worker = async () => {
    while (next < candidates.length) {
      const i = next++;
      outcomes[i] = await checkOne(candidates[i]!).catch((): QualityDropReason => "decode_error");
    }
  };
  await Promise.all(Array.from({ length: Math.min(VALIDATE_AT_ONCE, candidates.length) }, worker));
  // Results in the candidates' own order, so the sort below breaks ties as before.
  const valid: ValidatedAnswerImage[] = [];
  for (const outcome of outcomes) {
    if (typeof outcome === "string") drop(outcome);
    else valid.push(outcome);
  }
  valid.sort((a, b) => Number(b.leadImage) - Number(a.leadImage) || b.width * b.height - a.width * a.height || b.sharpness - a.sharpness);
  const chosen: ValidatedAnswerImage[] = [];
  for (const image of valid) {
    if (chosen.some(other => nearestDistance(image.hash, other.hash) <= HAMMING_THRESHOLD)) { drop("duplicate"); continue; }
    chosen.push(image);
  }
  return { images: chosen, dropped_by_quality };
}
