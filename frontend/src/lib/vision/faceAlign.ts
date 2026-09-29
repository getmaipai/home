export const CROP_SIZE = 112;

// OpenCV's fixed SFace destination template and precomputed mean.
const TEMPLATE: [number, number][] = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];
const TEMPLATE_MEAN: [number, number] = [56.0262, 71.9008];

/** Return the 2x3 Umeyama matrix that maps five points to SFace's template. */
export function similarityTransform(points: [number, number][]): number[][] {
  if (points.length !== 5 || points.some((point) => point.length !== 2)) {
    throw new Error(`expected 5 (x, y) points, got ${points.length}`);
  }
  const sourceMean: [number, number] = [
    points.reduce((sum, point) => sum + point[0], 0) / 5,
    points.reduce((sum, point) => sum + point[1], 0) / 5,
  ];
  const src = points.map(([x, y]) => [x - sourceMean[0], y - sourceMean[1]] as const);
  const dst = TEMPLATE.map(([x, y]) => [x - TEMPLATE_MEAN[0], y - TEMPLATE_MEAN[1]] as const);

  // A = dst_demean.T @ src_demean / 5, in the same index order as OpenCV.
  const a00 = dst.reduce((sum, point, i) => sum + point[0] * src[i]![0], 0) / 5;
  const a01 = dst.reduce((sum, point, i) => sum + point[0] * src[i]![1], 0) / 5;
  const a10 = dst.reduce((sum, point, i) => sum + point[1] * src[i]![0], 0) / 5;
  const a11 = dst.reduce((sum, point, i) => sum + point[1] * src[i]![1], 0) / 5;

  // Closed form of the 2x2 SVD's orientation-preserving factor U D V^T.
  // It is the rotation [c,-s;s,c] maximizing trace(R^T A), including when
  // det(A) is negative (where D supplies the reflection correction).
  const detA = a00 * a11 - a01 * a10;
  const cRaw = a00 + a11;
  const sRaw = a10 - a01;
  const norm = Math.hypot(cRaw, sRaw);
  const c = norm === 0 ? 1 : cRaw / norm;
  const s = norm === 0 ? 0 : sRaw / norm;
  const t00 = c;
  const t01 = -s;
  const t10 = s;
  const t11 = c;

  const frobeniusSquared = a00 * a00 + a01 * a01 + a10 * a10 + a11 * a11;
  const singularSum = Math.sqrt(Math.max(0, frobeniusSquared + 2 * Math.abs(detA)));
  const singularDifference = Math.sqrt(Math.max(0, frobeniusSquared - 2 * Math.abs(detA)));
  const signedSingularSum = detA < 0 ? singularDifference : singularSum;
  const sourceVariance = src.reduce((sum, [x, y]) => sum + x * x + y * y, 0) / 5;
  if (!Number.isFinite(sourceVariance) || sourceVariance === 0) {
    throw new Error("degenerate or collinear input points: source variance must be finite and non-zero");
  }
  const scale = signedSingularSum / sourceVariance;
  const r00 = t00 * scale;
  const r01 = t01 * scale;
  const r10 = t10 * scale;
  const r11 = t11 * scale;
  return [
    [r00, r01, TEMPLATE_MEAN[0] - (r00 * sourceMean[0] + r01 * sourceMean[1])],
    [r10, r11, TEMPLATE_MEAN[1] - (r10 * sourceMean[0] + r11 * sourceMean[1])],
  ];
}

/**
 * Warp RGBA ImageData pixels into SFace's 112x112 crop. The geometry is
 * channel-order agnostic; each channel is bilinearly blended independently.
 */
export function alignCrop(
  frameRgba: Uint8ClampedArray,
  frameWidth: number,
  frameHeight: number,
  fivePoints: [number, number][],
): Uint8ClampedArray {
  if (frameRgba.length !== frameWidth * frameHeight * 4) {
    throw new Error("frameRgba must contain frameWidth * frameHeight * 4 values");
  }
  const matrix = similarityTransform(fivePoints);
  const a = matrix[0]![0]!;
  const b = matrix[0]![1]!;
  const tx = matrix[0]![2]!;
  const c = matrix[1]![0]!;
  const d = matrix[1]![1]!;
  const ty = matrix[1]![2]!;
  const determinant = a * d - b * c;
  const inv00 = d / determinant;
  const inv01 = -b / determinant;
  const inv10 = -c / determinant;
  const inv11 = a / determinant;
  const offsetX = -(inv00 * tx + inv01 * ty);
  const offsetY = -(inv10 * tx + inv11 * ty);
  const output = new Uint8ClampedArray(CROP_SIZE * CROP_SIZE * 4);
  const sample = (sx: number, sy: number, channel: number): number => {
    if (sx < 0 || sx >= frameWidth || sy < 0 || sy >= frameHeight) return 0;
    return frameRgba[(sy * frameWidth + sx) * 4 + channel]!;
  };

  for (let y = 0; y < CROP_SIZE; y += 1) {
    for (let x = 0; x < CROP_SIZE; x += 1) {
      const sourceX = x * inv00 + y * inv01 + offsetX;
      const sourceY = x * inv10 + y * inv11 + offsetY;
      const x0 = Math.floor(sourceX);
      const y0 = Math.floor(sourceY);
      const fx = sourceX - x0;
      const fy = sourceY - y0;
      const outOffset = (y * CROP_SIZE + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const blended =
          sample(x0, y0, channel) * (1 - fx) * (1 - fy) +
          sample(x0 + 1, y0, channel) * fx * (1 - fy) +
          sample(x0, y0 + 1, channel) * (1 - fx) * fy +
          sample(x0 + 1, y0 + 1, channel) * fx * fy;
        // Python's uint8 cast truncates the bilinear result.
        output[outOffset + channel] = Math.trunc(Math.min(255, Math.max(0, blended)));
      }
    }
  }
  return output;
}
