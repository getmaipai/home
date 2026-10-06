// IMGSIM-01: the second stage of "is this the same photo": ORB keypoints and
// a RANSAC homography (`@techstark/opencv-js`, Apache-2.0, wasm, no native
// build), then a per-tile check after aligning one picture onto the other.
// Pure: bytes in, numbers out, no network.
//
// Why both: a hash alone merged burst frames (the next frame of the same
// shoot, 5 of 20 real pairs), and missed captions bars, borders and
// off-centre crops. Feature matching aligns the two pictures; then an edited
// copy (caption, watermark, sticker, meme text, border, re-grade) agrees with
// its original almost pixel for pixel outside the overlay, while a burst
// frame differs a little almost everywhere. Measured (ANSWER-IMG-05b,
// 2026-10-06; 15 real Commons photos with 12 overlay variants each, 20 real
// same-shoot pairs, 105 different-photo pairs): a pair is the same photo when
// it has at least 12 RANSAC inliers and at least a quarter of the aligned
// tiles correlate at 0.95 or more. Same photos: 166 of 181 merged. Bursts
// and different photos: 0 of 125 merged (the closest burst had 0.10 of its
// tiles agree). Escapes: scribbles drawn over the whole frame (2 of 15
// merged), one tiled watermark, one low-texture crop.
//
// opencv-js loads lazily, once per process (about 200 ms and 180 MB on the
// laptop it was measured on), and only when a pair needs verifying.
import sharp from "sharp";

const MAX_PIXELS = 40_000_000;
/** Longest side the features are detected on. */
const SIDE = 480;
const FEATURES = 1000;
const RATIO = 0.75;
export const MIN_INLIERS = 12;
const TILE_NCC = 0.95;
export const MIN_AGREEMENT = 0.25;
const TILES_X = 8, TILES_Y = 6;
/** Edge energy ratio below which a copy counts as blurred or degraded. */
const DEGRADED = 0.6;

export type GeometricFeatures = {
  width: number;
  height: number;
  /** The greyscale picture the features were found on (row-major). */
  grey: Uint8Array;
  /** x, y of each keypoint. */
  points: Float32Array;
  /** 32 bytes per keypoint (ORB). */
  descriptors: Uint8Array;
  count: number;
};

export type PairVerdict = {
  same: boolean;
  inliers: number;
  /** Fraction of aligned tiles that agree (0 to 1). */
  agreement: number;
  /** Evidence that side a or b carries something the other does not: tiles
   * where it has clearly more edges (text, strokes, a sticker's outline), or
   * a flat area outside the shared region (a caption bar, a border). */
  overlay: [number, number];
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cv = any;
let cvPromise: Promise<Cv> | null = null;
let loader: () => Promise<Cv> = () => import("@techstark/opencv-js").then(async (mod) => await (mod.default as unknown as Promise<Cv>));
/** Tests swap the loader (a failed load); null restores the real one. */
export function __setOpencvLoaderForTests(load: (() => Promise<Cv>) | null): void {
  loader = load ?? (() => import("@techstark/opencv-js").then(async (mod) => await (mod.default as unknown as Promise<Cv>)));
  cvPromise = null;
}
function opencv(): Promise<Cv> {
  // A failed load is forgotten so the next call asks again. That only helps
  // a load that failed before the module was evaluated: once opencv-js's
  // own wasm start-up has failed, the cached module keeps failing until the
  // hub restarts. Either way every close pair is counted as failed and kept
  // apart, never merged (cluster.ts).
  cvPromise ??= loader().catch((err: unknown) => { cvPromise = null; throw err; });
  return cvPromise;
}

/** Every opencv object made through `track` is deleted in `finally`, even
 * when a later constructor or call throws (wasm memory is not collected). */
function tracker(): { track: <T>(m: T) => T; release: () => void } {
  const made: { delete: () => void }[] = [];
  return {
    track: <T>(m: T) => { made.push(m as unknown as { delete: () => void }); return m; },
    release: () => { for (const m of made.reverse()) { try { m.delete(); } catch { /* already gone */ } } },
  };
}

/** Starts loading opencv-js in the background (a caller that is about to
 * fetch pictures calls this so the load overlaps the network). */
export function warmGeometry(): void {
  void opencv().catch(() => undefined);
}

export async function geometricFeatures(bytes: Uint8Array, opts: { features?: number } = {}): Promise<GeometricFeatures> {
  const { data, info } = await sharp(bytes, { limitInputPixels: MAX_PIXELS }).rotate().removeAlpha().resize(SIDE, SIDE, { fit: "inside", withoutEnlargement: true }).toColourspace("b-w").raw().toBuffer({ resolveWithObject: true });
  const cv = await opencv();
  const grey = new Uint8Array(data);
  const { track, release } = tracker();
  try {
    const mat = track(new cv.Mat(info.height, info.width, cv.CV_8UC1));
    const orb = track(new cv.ORB(opts.features ?? FEATURES)), keypoints = track(new cv.KeyPointVector()), descriptors = track(new cv.Mat()), mask = track(new cv.Mat());
    mat.data.set(grey);
    orb.detectAndCompute(mat, mask, keypoints, descriptors);
    const count = descriptors.rows as number;
    const points = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const pt = keypoints.get(i).pt;
      points[i * 2] = pt.x;
      points[i * 2 + 1] = pt.y;
    }
    return { width: info.width, height: info.height, grey, points, descriptors: new Uint8Array(descriptors.data), count };
  } finally {
    release();
  }
}

/** 3x3 box blur, so one picture's resampling softness never reads as the
 * other's overlay (text and strokes are wider than that and survive). */
function blur3(img: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(img.length);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    out[i] = (img[i - w - 1]! + img[i - w]! + img[i - w + 1]! + img[i - 1]! + img[i]! + img[i + 1]! + img[i + w - 1]! + img[i + w]! + img[i + w + 1]!) / 9;
  }
  return out;
}

/** Warps `src` onto `dst`'s frame with `H`; returns the warped pixels and
 * which of them came from inside `src`. */
function warp(cv: Cv, src: GeometricFeatures, dst: GeometricFeatures, H: Cv): { pixels: Uint8Array; valid: Uint8Array } {
  const { track, release } = tracker();
  try {
    const from = track(new cv.Mat(src.height, src.width, cv.CV_8UC1)), ones = track(new cv.Mat(src.height, src.width, cv.CV_8UC1, new cv.Scalar(255)));
    const out = track(new cv.Mat()), mask = track(new cv.Mat());
    from.data.set(src.grey);
    cv.warpPerspective(from, out, H, new cv.Size(dst.width, dst.height), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(0));
    cv.warpPerspective(ones, mask, H, new cv.Size(dst.width, dst.height), cv.INTER_NEAREST, cv.BORDER_CONSTANT, new cv.Scalar(0));
    return { pixels: new Uint8Array(out.data), valid: new Uint8Array(mask.data) };
  } finally {
    release();
  }
}

/** In `a`'s frame, against `b` warped onto it: how many aligned tiles
 * agree, and the evidence that `a` or `b` carries something the other does
 * not. Evidence (pixels): after a global gain and offset fit (a re-grade is
 * not an overlay), the pixels that still differ are the overlay's; whichever
 * side has the sharper edges at those pixels drew it (text, strokes, a
 * sticker's outline, a logo). And a strip of `a` outside the shared region
 * that is mostly one shade is a border or a caption bar `a` added. */
function compareFrames(a: GeometricFeatures, warped: { pixels: Uint8Array; valid: Uint8Array }): { tiles: number; agree: number; evidenceA: number; evidenceB: number; energyA: number; energyB: number; extraContent: number } {
  const w = a.width, h = a.height, A = a.grey, Bw = warped.pixels, V = warped.valid;
  let tiles = 0, agree = 0;
  for (let ty = 0; ty < TILES_Y; ty++) for (let tx = 0; tx < TILES_X; tx++) {
    const x0 = Math.floor((tx * w) / TILES_X), x1 = Math.floor(((tx + 1) * w) / TILES_X);
    const y0 = Math.floor((ty * h) / TILES_Y), y1 = Math.floor(((ty + 1) * h) / TILES_Y);
    let n = 0, inside = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
      n++;
      const i = y * w + x;
      if (!V[i]) continue;
      inside++;
      const va = A[i]!, vb = Bw[i]!;
      sa += va; sb += vb; saa += va * va; sbb += vb * vb; sab += va * vb;
    }
    if (inside === 0 || inside < n * 0.9) continue;
    tiles++;
    const c = inside;
    const cov = sab / c - (sa / c) * (sb / c), varA = saa / c - (sa / c) ** 2, varB = sbb / c - (sb / c) ** 2;
    const ncc = varA < 4 && varB < 4 ? (Math.abs(sa / c - sb / c) < 6 ? 1 : 0) : cov / Math.sqrt(Math.max(1e-9, varA * varB));
    if (ncc >= TILE_NCC) agree++;
  }
  // Global fit b' = gain * b + offset over the shared region (inner pixels).
  let n = 0, sa = 0, sb = 0, sbb = 0, sab = 0;
  for (let y = 1; y < h - 1; y += 2) for (let x = 1; x < w - 1; x += 2) {
    const i = y * w + x;
    if (!V[i]) continue;
    n++; sa += A[i]!; sb += Bw[i]!; sbb += Bw[i]! * Bw[i]!; sab += A[i]! * Bw[i]!;
  }
  const varB = n ? sbb / n - (sb / n) ** 2 : 0;
  const gain = varB > 1 ? (sab / n - (sa / n) * (sb / n)) / varB : 1;
  const offset = n ? sa / n - gain * (sb / n) : 0;
  let evidenceA = 0, evidenceB = 0, outside = 0, total = 0;
  // Two passes: a 5x5 softening, so a smaller copy scaled up to this frame
  // does not read as "fewer edges" next to its sharper original.
  const Ab = blur3(blur3(A, w, h), w, h), Bb = blur3(blur3(Bw, w, h), w, h);
  const hist = new Uint32Array(32);
  // Where the two still differ after the fit.
  const diff = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    total++;
    if (!V[i] || !V[i + 1] || !V[i + w]) {
      if (!V[i]) { outside++; hist[A[i]! >> 3]!++; }
      continue;
    }
    if (Math.abs(A[i]! - (gain * Bw[i]! + offset)) >= 30) diff[i] = 1;
  }
  // 7x7 density of the difference: inside a large differing area (a filled
  // sticker, a bubble, a banner) the flat side is the fill; along a thin one
  // (text, strokes, a logo's outline) the sharper side drew it.
  const sat = new Uint32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += diff[y * w + x]!; sat[(y + 1) * (w + 1) + x + 1] = sat[y * (w + 1) + x + 1]! + row; } }
  const boxSum = (x0: number, y0: number, x1: number, y1: number) => sat[y1 * (w + 1) + x1]! - sat[y0 * (w + 1) + x1]! - sat[y1 * (w + 1) + x0]! + sat[y0 * (w + 1) + x0]!;
  let energyA = 0, energyB = 0;
  for (let y = 4; y < h - 4; y++) for (let x = 4; x < w - 4; x++) {
    const i = y * w + x;
    if (V[i] && V[i + 1] && V[i + w]) {
      energyA += Math.abs(A[i]! - A[i + 1]!) + Math.abs(A[i]! - A[i + w]!);
      energyB += Math.abs(Bw[i]! - Bw[i + 1]!) + Math.abs(Bw[i]! - Bw[i + w]!);
    }
    if (!diff[i]) continue;
    const ga = Math.abs(Ab[i]! - Ab[i + 1]!) + Math.abs(Ab[i]! - Ab[i + w]!);
    const gb = gain * (Math.abs(Bb[i]! - Bb[i + 1]!) + Math.abs(Bb[i]! - Bb[i + w]!));
    if (boxSum(x - 3, y - 3, x + 4, y + 4) >= 45) {
      if (ga < 3 && gb > 8) evidenceA++;
      else if (gb < 3 && ga > 8) evidenceB++;
    } else if (ga > gb + 12) evidenceA++;
    else if (gb > ga + 12) evidenceB++;
  }
  // A strip outside the shared region, at least 2 percent of the frame and
  // at least 70 percent one shade (within two histogram bins): a border or
  // a caption bar. Its area counts against `a`.
  // Real content there instead (not one shade) means `a` shows more of the
  // scene: the uncropped original, when the shared region is still at least
  // half of `a` (a collage, where it is less, never counts).
  let extraContent = 0;
  if (outside > total * 0.02) {
    let peak = 0;
    for (let k = 0; k < 32; k++) peak = Math.max(peak, hist[k]! + (hist[k + 1] ?? 0));
    if (peak >= outside * 0.7) evidenceA += outside;
    else if (outside <= total * 0.5) extraContent = outside / total;
  }
  return { tiles, agree, evidenceA, evidenceB, energyA, energyB, extraContent };
}

export async function verifyPair(a: GeometricFeatures, b: GeometricFeatures): Promise<PairVerdict> {
  const none: PairVerdict = { same: false, inliers: 0, agreement: 0, overlay: [0, 0] };
  if (a.count < 8 || b.count < 8) return none;
  const cv = await opencv();
  const A: number[] = [], B: number[] = [];
  {
    const { track, release } = tracker();
    try {
      const da = track(new cv.Mat(a.count, 32, cv.CV_8UC1)), db = track(new cv.Mat(b.count, 32, cv.CV_8UC1));
      da.data.set(a.descriptors);
      db.data.set(b.descriptors);
      const matcher = track(new cv.BFMatcher(cv.NORM_HAMMING, false)), matches = track(new cv.DMatchVectorVector());
      matcher.knnMatch(da, db, matches, 2);
      for (let i = 0; i < matches.size(); i++) {
        // Each get() makes a new vector in wasm memory: deleted at once.
        const m = matches.get(i);
        try {
          if (m.size() < 2) continue;
          const m0 = m.get(0), m1 = m.get(1);
          if (m0.distance < RATIO * m1.distance) {
            A.push(a.points[m0.queryIdx * 2]!, a.points[m0.queryIdx * 2 + 1]!);
            B.push(b.points[m0.trainIdx * 2]!, b.points[m0.trainIdx * 2 + 1]!);
          }
        } finally {
          m.delete();
        }
      }
    } finally {
      release();
    }
  }
  const good = A.length / 2;
  if (good < 8) return none;
  const { track, release } = tracker();
  try {
    const pa = track(cv.matFromArray(good, 1, cv.CV_32FC2, A)), pb = track(cv.matFromArray(good, 1, cv.CV_32FC2, B)), inlierMask = track(new cv.Mat());
    const H = track(cv.findHomography(pb, pa, cv.RANSAC, 4, inlierMask));
    let inliers = 0;
    for (let i = 0; i < inlierMask.rows; i++) inliers += inlierMask.data[i] ? 1 : 0;
    if (inliers < MIN_INLIERS || H.empty()) return { ...none, inliers };
    const Hinv = track(new cv.Mat());
    cv.invert(H, Hinv, cv.DECOMP_LU);
    const onA = compareFrames(a, warp(cv, b, a, H));
    const onB = compareFrames(b, warp(cv, a, b, Hinv));
    const agreement = onA.tiles ? onA.agree / onA.tiles : 0;
    // Evidence is in pixels of each frame; scale b's to a's frame size. When
    // the sizes differ by more than a quarter, only the smaller picture's
    // frame counts: there the larger one is scaled down, so neither looks
    // softer for being resampled.
    const areaA = a.width * a.height, areaB = b.width * b.height;
    const scale = areaA / Math.max(1, areaB);
    let overlay: [number, number] = areaA < areaB * 0.75
      ? [onA.evidenceA, onA.evidenceB]
      : areaB < areaA * 0.75
        ? [onB.evidenceB, onB.evidenceA]
        : [onA.evidenceA + onB.evidenceB * scale, onA.evidenceB + onB.evidenceA * scale];
    // Too little to tell (a few hundred pixels of resampling noise): no vote.
    const frame = Math.min(areaA, areaB);
    const [ea, eb] = overlay;
    if (Math.max(ea, eb) < frame * 0.002 || Math.max(ea, eb) < 2 * Math.min(ea, eb)) overlay = [0, 0];
    // An uncropped original (more real content around the shared part) wins;
    // then a copy whose whole shared region carries far less edge energy, in
    // its own frame and in the other's, is blurred or degraded and loses.
    if (onA.extraContent > 0.04 && onB.extraContent < 0.01) overlay = [0, 1];
    else if (onB.extraContent > 0.04 && onA.extraContent < 0.01) overlay = [1, 0];
    else if (onA.energyB < onA.energyA * DEGRADED && onB.energyA < onB.energyB * DEGRADED) overlay = [0, 1];
    else if (onA.energyA < onA.energyB * DEGRADED && onB.energyB < onB.energyA * DEGRADED) overlay = [1, 0];
    return { same: agreement >= MIN_AGREEMENT, inliers, agreement, overlay };
  } finally {
    release();
  }
}
