// IMGSIM-01: one picture's fingerprint, the cheap first stage of "is this the
// same photo". Pure: bytes in, a plain JSON-safe record out, no network and
// no answer-image types, so a photo library scan can store it with each file
// record later (versioned by `fingerprint_version`).
//
// Hashes: DCT pHash (`sharp-phash`, MIT) and dHash, 64 bits each, from one
// 256 px greyscale decode, over the full frame, its 0.9 to 0.6 centre crops
// (both hashes) and its mirror (pHash only: a mirrored dHash came within 11
// bits of an unrelated live picture). Design:
// data-scratch/research/image-quality-design.md section 4; library choice:
// data-scratch/research/image-libraries-scout.md.
import sharp from "sharp";
import phash from "sharp-phash";

export const FINGERPRINT_VERSION = 1;
const MAX_PIXELS = 40_000_000;
const BASE = 256;
const CROPS = [0.9, 0.8, 0.7, 0.6] as const;

/** 64 "0"/"1" characters each: `d` dHash, `p` DCT pHash. */
export type HashPair = { d: string; p: string };

export type ImageFingerprint = {
  fingerprint_version: typeof FINGERPRINT_VERSION;
  width: number;
  height: number;
  /** Greyscale histogram entropy in bits (placeholders measured at most
   * 0.38, real photos at least 4.90). */
  entropy: number;
  /** sharp's sharpness estimate (higher is crisper). */
  sharpness: number;
  /** Mean standard deviation of the colour channels (0 is one flat colour). */
  stdev: number;
  hashes: { full: HashPair; crops: HashPair[]; mirror_p: string };
};

export function hamming(a: string, b: string): number {
  let n = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) n++;
  return n + Math.abs(a.length - b.length);
}

type Grey = { data: Buffer; width: number; height: number };
const rawOf = (g: Grey) => ({ raw: { width: g.width, height: g.height, channels: 1 as const } });

/** dHash from a box average of the region into 9x8 cells (plain code on the
 * one decoded buffer: no extra image pipeline per hash). */
function dhash(g: Grey): string {
  const cells = new Float64Array(72);
  for (let cy = 0; cy < 8; cy++) for (let cx = 0; cx < 9; cx++) {
    const x0 = Math.floor((cx * g.width) / 9), x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * g.width) / 9));
    const y0 = Math.floor((cy * g.height) / 8), y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * g.height) / 8));
    let sum = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) sum += g.data[y * g.width + x]!;
    cells[cy * 9 + cx] = sum / ((x1 - x0) * (y1 - y0));
  }
  let d = "";
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) d += cells[y * 9 + x]! > cells[y * 9 + x + 1]! ? "1" : "0";
  return d;
}

function centreCrop(g: Grey, r: number): Grey {
  const side = Math.max(8, Math.round(g.width * r));
  const off = Math.floor((g.width - side) / 2);
  const data = Buffer.alloc(side * side);
  for (let y = 0; y < side; y++) g.data.copy(data, y * side, (y + off) * g.width + off, (y + off) * g.width + off + side);
  return { data, width: side, height: side };
}

function mirrored(g: Grey): Grey {
  const data = Buffer.alloc(g.data.length);
  for (let y = 0; y < g.height; y++) for (let x = 0; x < g.width; x++) data[y * g.width + x] = g.data[y * g.width + (g.width - 1 - x)]!;
  return { data, width: g.width, height: g.height };
}

async function pair(g: Grey): Promise<HashPair> {
  return { d: dhash(g), p: await phash(g.data, rawOf(g)) };
}

/** Throws when the bytes do not decode as a still picture. */
export async function fingerprint(bytes: Uint8Array): Promise<ImageFingerprint> {
  const [meta, stats, base] = await Promise.all([
    sharp(bytes, { limitInputPixels: MAX_PIXELS }).metadata(),
    sharp(bytes, { limitInputPixels: MAX_PIXELS }).stats(),
    sharp(bytes, { limitInputPixels: MAX_PIXELS }).rotate().removeAlpha().toColourspace("b-w").resize(BASE, BASE, { fit: "fill" }).raw().toBuffer(),
  ]);
  const full: Grey = { data: base, width: BASE, height: BASE };
  const [f, cs, m] = await Promise.all([pair(full), Promise.all(CROPS.map((r) => pair(centreCrop(full, r)))), phash(mirrored(full).data, rawOf(full))]);
  return {
    fingerprint_version: FINGERPRINT_VERSION,
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    entropy: stats.entropy,
    sharpness: stats.sharpness,
    stdev: stats.channels.slice(0, 3).reduce((sum, c) => sum + c.stdev, 0) / Math.max(1, Math.min(3, stats.channels.length)),
    hashes: { full: f, crops: cs, mirror_p: m },
  };
}

/** The smallest distance between one picture's full frame and the other's
 * full frame or centre crops (either hash) or mirror (pHash), either way
 * round. 0 is the same pixels; unrelated photos measured 13 and up. */
export function hashDistance(a: ImageFingerprint, b: ImageFingerprint): number {
  let min = 64;
  for (const [x, y] of [[a, b], [b, a]] as const) {
    for (const z of [y.hashes.full, ...y.hashes.crops]) min = Math.min(min, hamming(x.hashes.full.d, z.d), hamming(x.hashes.full.p, z.p));
    min = Math.min(min, hamming(x.hashes.full.p, y.hashes.mirror_p));
  }
  return min;
}
