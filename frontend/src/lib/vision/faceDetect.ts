export interface DetectedFace {
  bbox: [x: number, y: number, width: number, height: number];
  rightEye: [number, number];
  leftEye: [number, number];
  nose: [number, number];
  rightMouth: [number, number];
  leftMouth: [number, number];
}

const STRIDES = [8, 16, 32] as const;

/** Decode already-run YuNet output tensors and suppress overlapping boxes. */
export function decodeYunetOutputs(
  outputs: Record<string, Float32Array>,
  paddedWidth: number,
  scoreThreshold: number,
  nmsThreshold: number,
): DetectedFace[] {
  const candidates: Array<{ face: DetectedFace; score: number; order: number }> = [];

  for (const stride of STRIDES) {
    const cls = outputs[`cls_${stride}`];
    const obj = outputs[`obj_${stride}`];
    const bbox = outputs[`bbox_${stride}`];
    const kps = outputs[`kps_${stride}`];
    if (!cls || !obj || !bbox || !kps) {
      throw new Error(`Missing YuNet output for stride ${stride}`);
    }

    const anchorCount = Math.min(cls.length, obj.length, Math.floor(bbox.length / 4), Math.floor(kps.length / 10));
    const cols = Math.floor(paddedWidth / stride);
    for (let idx = 0; idx < anchorCount; idx += 1) {
      const score = Math.fround(
        Math.sqrt(
          Math.fround(
            Math.min(1, Math.max(0, cls[idx]!)) * Math.min(1, Math.max(0, obj[idx]!)),
          ),
        ),
      );
      if (score < scoreThreshold) continue;

      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const boxOffset = idx * 4;
      const kpOffset = idx * 10;
      const cx = (col + bbox[boxOffset]!) * stride;
      const cy = (row + bbox[boxOffset + 1]!) * stride;
      const width = Math.exp(bbox[boxOffset + 2]!) * stride;
      const height = Math.exp(bbox[boxOffset + 3]!) * stride;
      const point = (offset: number): [number, number] => [
        (col + kps[kpOffset + offset]!) * stride,
        (row + kps[kpOffset + offset + 1]!) * stride,
      ];
      candidates.push({
        score,
        order: candidates.length,
        face: {
          bbox: [cx - width / 2, cy - height / 2, width, height],
          rightEye: point(0),
          leftEye: point(2),
          nose: point(4),
          rightMouth: point(6),
          leftMouth: point(8),
        },
      });
    }
  }

  // NumPy argsort followed by [::-1] reverses candidate order for ties.
  candidates.sort((a, b) => b.score - a.score || b.order - a.order);
  const kept: typeof candidates = [];
  for (const candidate of candidates) {
    const [x, y, width, height] = candidate.face.bbox;
    const area = width * height;
    const suppressed = kept.some(({ face }) => {
      const [otherX, otherY, otherWidth, otherHeight] = face.bbox;
      const intersectionWidth = Math.max(0, Math.min(x + width, otherX + otherWidth) - Math.max(x, otherX));
      const intersectionHeight = Math.max(0, Math.min(y + height, otherY + otherHeight) - Math.max(y, otherY));
      const intersection = intersectionWidth * intersectionHeight;
      const union = area + otherWidth * otherHeight - intersection;
      return intersection / union > nmsThreshold;
    });
    if (!suppressed) kept.push(candidate);
  }
  return kept.map(({ face }) => face);
}
