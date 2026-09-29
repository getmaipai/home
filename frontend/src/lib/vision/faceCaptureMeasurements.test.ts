import { describe, expect, test } from "bun:test";
import { computeBoxFraction, computeBrightness, computeSharpness } from "@/lib/vision/faceCaptureMeasurements";

function solidCrop(gray: number, size = 112): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    rgba[i * 4] = gray;
    rgba[i * 4 + 1] = gray;
    rgba[i * 4 + 2] = gray;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

function checkerboardCrop(size = 112): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const gray = (x + y) % 2 === 0 ? 0 : 255;
      const offset = (y * size + x) * 4;
      rgba[offset] = gray;
      rgba[offset + 1] = gray;
      rgba[offset + 2] = gray;
      rgba[offset + 3] = 255;
    }
  }
  return rgba;
}

describe("computeBoxFraction", () => {
  test("a face bbox covering a quarter of the frame reports 0.25", () => {
    expect(computeBoxFraction([0, 0, 50, 50], 100, 100)).toBeCloseTo(0.25, 6);
  });

  test("clamps to 1 for a bbox that overruns the frame", () => {
    expect(computeBoxFraction([0, 0, 200, 200], 100, 100)).toBe(1);
  });

  test("throws for a non-positive frame dimension", () => {
    expect(() => computeBoxFraction([0, 0, 10, 10], 0, 100)).toThrow();
  });
});

describe("computeBrightness", () => {
  test("a flat mid-gray crop reports its own gray value", () => {
    expect(computeBrightness(solidCrop(128))).toBeCloseTo(128, 6);
  });

  test("a black crop reports 0 and a white crop reports 255", () => {
    expect(computeBrightness(solidCrop(0))).toBe(0);
    expect(computeBrightness(solidCrop(255))).toBeCloseTo(255, 6);
  });

  test("throws for a wrongly sized buffer", () => {
    expect(() => computeBrightness(new Uint8ClampedArray(10))).toThrow();
  });
});

describe("computeSharpness", () => {
  test("a flat crop has zero variance in its Laplacian response", () => {
    expect(computeSharpness(solidCrop(128))).toBeCloseTo(0, 6);
  });

  test("a checkerboard crop scores far higher than a flat one", () => {
    const flat = computeSharpness(solidCrop(128));
    const sharp = computeSharpness(checkerboardCrop());
    expect(sharp).toBeGreaterThan(flat + 1000);
  });
});
