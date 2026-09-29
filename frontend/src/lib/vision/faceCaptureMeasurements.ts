// FACE-02: the three FaceSample measurements the guided capture flow has
// to derive itself from a live camera frame - enrollmentSession.ts's own
// FaceSample fields (yawDeg/pitchDeg come from headPose.ts instead), but
// nothing upstream computes boxFrac/sharpness/brightness for a real
// frame, so this is that logic, kept pure and unit-testable rather than
// inlined into the capture loop's React effect.
//
// DEFAULT_QUALITY_CONFIG's own numbers (minBrightness: 40, maxBrightness:
// 220, minSharpness: 40) are 0-255-scale brightness
// and OpenCV's familiar `cv2.Laplacian(gray, CV2_64F).var()` blur measure
// - the standard "variance of the Laplacian" sharpness metric most
// blur-detection tutorials use, and the measure legacy's own enrollment
// gate was built against (FACE-02A's port comment: "rebuilt not
// copied"). Both are computed here on the aligned 112x112 SFace crop
// (faceAlign.ts's own CROP_SIZE), not the raw frame: it's already
// face-cropped and already computed for the embedding, so reusing it
// costs nothing extra and measures the face itself, not the background.

/** Standard ITU-R BT.601 luma weights - same formula canvas 2D's own
 * grayscale conversions use, applied by hand since alignCrop returns raw
 * RGBA, not a canvas ImageData this file can hand to a browser API. */
function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function toGrayscale(rgba: Uint8ClampedArray, size: number): Float64Array {
  if (rgba.length !== size * size * 4) throw new Error(`expected a ${size}x${size} RGBA buffer`);
  const gray = new Float64Array(size * size);
  for (let pixel = 0; pixel < size * size; pixel += 1) {
    const src = pixel * 4;
    gray[pixel] = luma(rgba[src]!, rgba[src + 1]!, rgba[src + 2]!);
  }
  return gray;
}

/** The fraction of the frame's area a detected face's bounding box
 * covers - `enrollmentSession.ts`'s own quality gate uses this as a
 * "move closer" proxy (minBoxFrac), so a face far from the
 * camera scores low without needing real depth. Clamped to [0, 1]: a
 * box that straddles the frame edge can otherwise report slightly over
 * 100% of it. */
export function computeBoxFraction(
  bbox: readonly [x: number, y: number, width: number, height: number],
  frameWidth: number,
  frameHeight: number,
): number {
  if (frameWidth <= 0 || frameHeight <= 0) throw new Error("frame dimensions must be positive");
  const [, , width, height] = bbox;
  const fraction = (Math.max(0, width) * Math.max(0, height)) / (frameWidth * frameHeight);
  return Math.min(1, Math.max(0, fraction));
}

/** Mean grayscale intensity of the aligned face crop, 0-255 - the same
 * scale DEFAULT_QUALITY_CONFIG's minBrightness/maxBrightness already
 * assume. */
export function computeBrightness(alignedRgba: Uint8ClampedArray, size = 112): number {
  const gray = toGrayscale(alignedRgba, size);
  let sum = 0;
  for (let i = 0; i < gray.length; i += 1) sum += gray[i]!;
  return sum / gray.length;
}

/** Variance of the discrete Laplacian over the aligned face crop's
 * grayscale values - the standard "blur detection" measure (a sharp
 * image has strong, varied edge responses; a blurred one flattens
 * them). Computed only over interior pixels (a 1px border is skipped
 * rather than zero-padded, so an edge artifact from alignCrop's own
 * out-of-frame sampling never counts as a real edge). */
export function computeSharpness(alignedRgba: Uint8ClampedArray, size = 112): number {
  const gray = toGrayscale(alignedRgba, size);
  const at = (x: number, y: number) => gray[y * size + x]!;
  let sum = 0;
  let sumSquares = 0;
  let count = 0;
  for (let y = 1; y < size - 1; y += 1) {
    for (let x = 1; x < size - 1; x += 1) {
      const laplacian = 4 * at(x, y) - at(x - 1, y) - at(x + 1, y) - at(x, y - 1) - at(x, y + 1);
      sum += laplacian;
      sumSquares += laplacian * laplacian;
      count += 1;
    }
  }
  const mean = sum / count;
  return sumSquares / count - mean * mean;
}
