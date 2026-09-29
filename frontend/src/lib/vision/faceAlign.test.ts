import { describe, expect, test } from "bun:test";
import { alignCrop, CROP_SIZE, similarityTransform } from "@/lib/vision/faceAlign";

const template: [number, number][] = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];
const rotated: [number, number][] = [
  [50.95044310199252, 39.49415325964648],
  [84.70492829406365, 49.610129696365306],
  [62.04708353391565, 63.84271320832945],
  [42.17240485751549, 79.33788482821944],
  [70.12514021251269, 87.71511900743931],
];

function gradientFrame(): Uint8ClampedArray {
  const frame = new Uint8ClampedArray(128 * 128 * 4);
  for (let y = 0; y < 128; y += 1) {
    for (let x = 0; x < 128; x += 1) {
      const offset = (y * 128 + x) * 4;
      frame[offset] = x;
      frame[offset + 1] = y;
      frame[offset + 2] = (x + y) % 256;
      frame[offset + 3] = 255;
    }
  }
  return frame;
}

describe("similarityTransform", () => {
  test("maps the template points to an identity transform", () => {
    const matrix = similarityTransform(template);
    expect(matrix[0]![0]).toBeCloseTo(1, 12);
    expect(matrix[0]![1]).toBeCloseTo(0, 12);
    expect(matrix[0]![2]).toBeCloseTo(0.00004, 10);
    expect(matrix[1]![0]).toBeCloseTo(0, 12);
    expect(matrix[1]![1]).toBeCloseTo(1, 12);
    expect(matrix[1]![2]).toBeCloseTo(0.00002, 10);
  });

  test("rejects five identical points as degenerate input", () => {
    expect(() => similarityTransform([[3, 4], [3, 4], [3, 4], [3, 4], [3, 4]])).toThrow(/degenerate or collinear/);
  });

  test("matches the Python oracle for the rotated and translated points", () => {
    const matrix = similarityTransform(rotated);
    const expected = [
      [0.956304755963, 0.292371704723, -21.976483971963],
      [-0.292371704723, 0.956304755963, 28.824341311175],
    ];
    for (let row = 0; row < 2; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        expect(matrix[row]![column]).toBeCloseTo(expected[row]![column]!, 9);
      }
    }
  });

  test("matches the Python SVD reflection correction for a negative determinant", () => {
    const matrix = similarityTransform([[0, 0], [1, 1], [2, 0], [3, -1], [4, 0]]);
    const expected = [
      [-0.664666666667, -7.491433333333, 57.355533333333],
      [7.491433333333, -0.664666666667, 56.917933333333],
    ];
    for (let row = 0; row < 2; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        expect(matrix[row]![column]).toBeCloseTo(expected[row]![column]!, 9);
      }
    }
  });
});

describe("alignCrop", () => {
  test("bilinearly samples the RGBA frame into the verified 112x112 crop", () => {
    const crop = alignCrop(gradientFrame(), 128, 128, template);
    expect(crop).toHaveLength(CROP_SIZE * CROP_SIZE * 4);
    expect(Array.from(crop.slice((51 * CROP_SIZE + 38) * 4, (51 * CROP_SIZE + 38) * 4 + 4))).toEqual([
      37, 50, 88, 255,
    ]);
  });
});
