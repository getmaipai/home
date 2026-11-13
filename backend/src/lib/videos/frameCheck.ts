// IVY-QC-01: a quick, measured check of a finished clip from the frames Home already takes for the safety check (3 to 5 stills, so it
// finds only what is visible at that spacing: a black picture, a clip that barely moves, a stretch that is much softer than the rest).
// No model, no network, no word of the prompt. A fuller frame-by-frame check (hard jumps, face drift) needs the whole clip and lives
// with the Stack; this module has grown to evaluate that series too, and never says a clip is fine, only what it saw.
import sharp from "sharp";

export type ClipFinding = { code: "black" | "frozen" | "soft" | "jump" | "camera_not_seen" | "loop_seam"; level: "serious" | "warning"; message: string; at_s?: number };
export type ClipCheck = { checked: boolean; frames: number; findings: ClipFinding[] };

export type ClipSeries = { fps: number; duration_s?: number; frames?: number; luma: number[]; diff: number[]; sharpness: number[]; flow?: Array<{ at_s: number; dx: number; dy: number; zoom: number }> };
export type ClipEvaluationOptions = { loop?: boolean; cameraMove?: "none" | "move"; seamSsim?: number | null };

/** All thresholds for whole-clip series evaluation live here. */
export const CLIP_RULES = {
  blackLuma: 12, blackSeconds: 0.3,
  frozenDiff: 0.35, frozenSeconds: 1,
  jumpFloor: 28, jumpMedianMultiplier: 8,
  softMedianRatio: 0.35, softWarningSeconds: 0.5, softSeriousSeconds: 1.5, softMedianMinimum: 20,
  cameraMotionPerSecond: 8,
  loopSeamSsim: 0.9,
} as const;

const frozenMessage = "Nothing seems to move in this clip. Make it again, or describe the movement.";
const medianOf = (values: number[]): number => { const sorted = [...values].sort((a, b) => a - b); const m = sorted.length >> 1; return sorted.length % 2 ? sorted[m]! : ((sorted[m - 1] ?? 0) + sorted[m]!) / 2; };
function longestRun(values: number[], matches: (value: number) => boolean): { count: number; start: number } {
  let best = { count: 0, start: 0 }, run = 0, start = 0;
  values.forEach((value, index) => { if (matches(value)) { if (!run) start = index; run++; if (run > best.count) best = { count: run, start }; } else run = 0; });
  return best;
}

/** Applies Home's one rule table to Stack's per-frame measurements. */
export function evaluateClipSeries(series: ClipSeries, opts: ClipEvaluationOptions = {}): ClipCheck {
  const fps = Number.isFinite(series.fps) && series.fps > 0 ? series.fps : 0;
  const findings: ClipFinding[] = [];
  if (!fps) return { checked: false, frames: 0, findings };
  const black = longestRun(series.luma, (value) => value < CLIP_RULES.blackLuma);
  if (black.count / fps >= CLIP_RULES.blackSeconds) findings.push({ code: "black", level: "serious", message: "Part of the clip is black. Make it again.", at_s: black.start / fps });
  const frozen = longestRun(series.diff, (value) => value < CLIP_RULES.frozenDiff);
  if (frozen.count / fps >= CLIP_RULES.frozenSeconds) findings.push({ code: "frozen", level: "serious", message: frozenMessage, at_s: frozen.start / fps });
  const diffMedian = medianOf(series.diff);
  const jumpAt = series.diff.findIndex((value) => value > Math.max(CLIP_RULES.jumpFloor, CLIP_RULES.jumpMedianMultiplier * diffMedian));
  if (jumpAt >= 0) findings.push({ code: "jump", level: "serious", message: `The picture jumps at about ${Math.round(jumpAt / fps)} seconds.`, at_s: jumpAt / fps });
  const sharpMedian = medianOf(series.sharpness);
  if (sharpMedian > CLIP_RULES.softMedianMinimum) {
    const soft = longestRun(series.sharpness, (value) => value < sharpMedian * CLIP_RULES.softMedianRatio);
    const duration = soft.count / fps;
    if (duration >= CLIP_RULES.softWarningSeconds) findings.push({ code: "soft", level: duration >= CLIP_RULES.softSeriousSeconds ? "serious" : "warning", message: "Part of the clip is much softer than the rest. It may look blurry.", at_s: soft.start / fps });
  }
  if (opts.cameraMove === "move") {
    const total = (series.flow ?? []).reduce((sum, entry) => sum + Math.abs(entry.dx) + Math.abs(entry.dy) + Math.abs(entry.zoom) * 50, 0);
    const duration = series.duration_s && series.duration_s > 0 ? series.duration_s : Math.max(series.luma.length, series.diff.length) / fps;
    if (total / Math.max(duration, 1 / fps) < CLIP_RULES.cameraMotionPerSecond) findings.push({ code: "camera_not_seen", level: "warning", message: "The camera does not seem to move as asked." });
  }
  if (opts.loop && typeof opts.seamSsim === "number" && opts.seamSsim < CLIP_RULES.loopSeamSsim) findings.push({ code: "loop_seam", level: "warning", message: "The loop seam may be visible." });
  return { checked: true, frames: series.frames ?? Math.max(series.luma.length, series.diff.length, series.sharpness.length), findings };
}

export function clipWeight(findings: ClipFinding[]): number { return findings.filter((finding) => finding.level === "serious").length * 10 + findings.length; }
export function keepBetter(first: ClipFinding[], second: ClipFinding[]): "first" | "second" { return clipWeight(first) < clipWeight(second) ? "first" : "second"; }
export function shouldRetake(input: { findings: ClipFinding[]; isRetake: boolean }): boolean { return !input.isRetake && input.findings.some((finding) => finding.level === "serious"); }

const SIDE = 96;
const BLACK_LUMA = CLIP_RULES.blackLuma;
const FROZEN_DIFF = CLIP_RULES.frozenDiff;
const SOFT_RATIO = CLIP_RULES.softMedianRatio;

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
    if (diffs.every((d) => d < FROZEN_DIFF)) findings.push({ code: "frozen", level: "serious", message: frozenMessage });
  }
  const sharp = px.map((p) => sharpness(p));
  const mid = median(sharp);
  if (mid > CLIP_RULES.softMedianMinimum && sharp.some((s) => s < mid * SOFT_RATIO)) findings.push({ code: "soft", level: "warning", message: "Part of the clip is much softer than the rest. It may look blurry." });
  return { checked: true, frames: frames.length, findings };
}
