import { describe, expect, test } from "bun:test";
import { decodeYunetOutputs } from "@/lib/vision/faceDetect";

function tensors(paddedWidth = 32): Record<string, Float32Array> {
  const result: Record<string, Float32Array> = {};
  for (const stride of [8, 16, 32]) {
    const count = (paddedWidth / stride) ** 2;
    result[`cls_${stride}`] = new Float32Array(count);
    result[`obj_${stride}`] = new Float32Array(count).fill(1);
    result[`bbox_${stride}`] = new Float32Array(count * 4);
    result[`kps_${stride}`] = new Float32Array(count * 10);
  }
  return result;
}

function activate(outputs: Record<string, Float32Array>, stride: number, idx: number, score: number) {
  outputs[`cls_${stride}`]![idx] = score;
}

describe("decodeYunetOutputs", () => {
  test("decodes a detection's box and five landmarks from its grid anchor", () => {
    const outputs = tensors();
    activate(outputs, 8, 5, 0.81);
    outputs.bbox_8!.set([0.5, 0.25, Math.log(2), Math.log(1.5)], 5 * 4);
    outputs.kps_8!.set([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1], 5 * 10);

    const faces = decodeYunetOutputs(outputs, 32, 0.8, 0.3);
    expect(faces).toHaveLength(1);
    const face = faces[0]!;
    const expected = {
      bbox: [4, 4, 16, 12],
      rightEye: [8.8, 9.6],
      leftEye: [10.4, 11.2],
      nose: [12, 12.8],
      rightMouth: [13.6, 14.4],
      leftMouth: [15.2, 16],
    };
    for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
      face[key].forEach((value, index) => expect(value).toBeCloseTo(expected[key][index]!, 5));
    }
  });

  test("filters scores below the threshold", () => {
    const outputs = tensors();
    outputs.cls_8![0] = 0.79;
    outputs.obj_8![0] = 0.79;
    expect(decodeYunetOutputs(outputs, 32, 0.8, 0.3)).toEqual([]);
  });

  test("keeps the highest score when boxes overlap", () => {
    const outputs = tensors();
    activate(outputs, 8, 0, 0.9);
    activate(outputs, 8, 1, 0.8);
    outputs.bbox_8!.set([0.5, 0.5, Math.log(2), Math.log(2)], 0);
    outputs.bbox_8!.set([-0.5, 0.5, Math.log(2), Math.log(2)], 4);
    const faces = decodeYunetOutputs(outputs, 32, 0.5, 0.3);
    expect(faces).toHaveLength(1);
    faces[0]!.bbox.forEach((value, index) => expect(value).toBeCloseTo([-4, -4, 16, 16][index]!, 5));
  });

  test("matches NumPy's reverse insertion order for tied overlapping scores", () => {
    const outputs = tensors();
    activate(outputs, 8, 0, 0.9);
    activate(outputs, 8, 1, 0.9);
    outputs.bbox_8!.set([0.5, 0.5, Math.log(2), Math.log(2)], 0);
    outputs.bbox_8!.set([-0.5, 0.5, Math.log(2), Math.log(2)], 4);
    outputs.kps_8!.set(new Array(10).fill(0.25), 0);
    outputs.kps_8!.set(new Array(10).fill(0.75), 10);
    const faces = decodeYunetOutputs(outputs, 32, 0.5, 0.3);
    expect(faces).toHaveLength(1);
    expect(faces[0]!.rightEye).toEqual([14, 6]);
  });

  test("keeps non-overlapping faces from different strides", () => {
    const outputs = tensors();
    activate(outputs, 8, 0, 0.9);
    activate(outputs, 16, 3, 0.85);
    outputs.bbox_8!.set([0.5, 0.5, 0, 0], 0);
    outputs.bbox_16!.set([0.5, 0.5, 0, 0], 3 * 4);
    expect(decodeYunetOutputs(outputs, 32, 0.5, 0.3)).toHaveLength(2);
  });
});
