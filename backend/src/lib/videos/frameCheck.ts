// IVY-QC-01: a quick, measured check of a finished clip from the frames Home already takes for the safety check (3 to 5 stills, so it
// finds only what is visible at that spacing: a black picture, a clip that barely moves, a stretch that is much softer than the rest).
// No model, no network, no word of the prompt. A fuller frame-by-frame check (hard jumps, face drift) needs the whole clip and lives
// with the Stack; this one never says a clip is fine, only what it saw.
import sharp from "sharp";

export type ClipFinding = { code: "black" | "frozen" | "soft"; level: "serious" | "warning"; message: string };
export type ClipCheck = { checked: boolean; frames: number; findings: ClipFinding[] };

const SIDE = 96;
const BLACK_LUMA = 12;
const FROZEN_DIFF = 0.35;
const SOFT_RATIO = 0.35;

async function grey(jpeg: Uint8Array): Promise<Uint8Array> {
  const { data } = await sharp(Buffer.from(jpeg)).resize(SIDE, SIDE, { fit: "fill" }).greyscale().raw().toBuffer({ resolveWithObject: true });
  return new Uint8Array(data);
}
const mean = (a: ArrayLike<number>): number => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]!; return a.length ? s / a.length : 0; };
/** Sharpness as the variance of a 4-neighbour Laplacian over the inside pixels. */
export function sharpness(px: Uint8Array, side = SIDE): number {
  const values: number[] = [];
  for (let y = 1; y < side - 1; y++) for (let x = 1; x < side - 1; x++) {
    const i = y * side + x;
    values.push(px[i - 1]! + px[i + 1]! + px[i - side]! + px[i + side]! - 4 * px[i]!);
  }
  const m = mean(values);
  return values.reduce((s, v) => s + (v - m) * (v - m), 0) / Math.max(1, values.length);
}
function meanAbsDiff(a: Uint8Array, b: Uint8Array): number { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i]! - b[i]!); return s / a.length; }
const median = (v: number[]): number => { const s = [...v].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };

export async function checkClipFrames(frames: Uint8Array[] | null, seconds: number | null): Promise<ClipCheck> {
  if (!frames || frames.length < 2) return { checked: false, frames: frames?.length ?? 0, findings: [] };
  const px: Uint8Array[] = [];
  for (const f of frames) { try { px.push(await grey(f)); } catch { return { checked: false, frames: frames.length, findings: [] }; } }
  const findings: ClipFinding[] = [];
  if (px.some((p) => mean(p) < BLACK_LUMA)) findings.push({ code: "black", level: "serious", message: "Part of the clip is black. Make it again." });
  if ((seconds ?? 0) >= 2) {
    const diffs = px.slice(1).map((p, i) => meanAbsDiff(px[i]!, p));
    if (diffs.every((d) => d < FROZEN_DIFF)) findings.push({ code: "frozen", level: "serious", message: "Nothing seems to move in this clip. Make it again, or describe the movement." });
  }
  const sharp = px.map((p) => sharpness(p));
  const mid = median(sharp);
  if (mid > 20 && sharp.some((s) => s < mid * SOFT_RATIO)) findings.push({ code: "soft", level: "warning", message: "Part of the clip is much softer than the rest. It may look blurry." });
  return { checked: true, frames: frames.length, findings };
}
