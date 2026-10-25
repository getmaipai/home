import { afterEach, describe, expect, test } from "bun:test";
import { setSessionFactory, type OnnxInferenceSession } from "@/lib/onnx/session-runtime";
import { analyzeFocalImage } from "@/lib/focalImageAnalyzer";

afterEach(() => setSessionFactory(null));

describe("News image focal analysis", () => {
  test("runs the local model with the shared image tensor and returns its 64-square importance map", async () => {
    let modelPath = "";
    let dims: readonly number[] = [];
    let data: Float32Array | undefined;
    const map = new Float32Array(64 * 64).fill(0.25);
    const session: OnnxInferenceSession = { run: async (feeds) => {
      dims = feeds.image!.dims;
      data = feeds.image!.data as Float32Array;
      return { importance: { data: map, dims: [1, 1, 64, 64] } };
    } };
    setSessionFactory({
      create: async (path) => { modelPath = path; return session; },
      tensor: (tensorData, tensorDims) => ({ data: tensorData, dims: tensorDims }),
    });
    const input = new Float32Array(3 * 256 * 256);
    const result = await analyzeFocalImage(input);
    expect(modelPath).toBe("/api/vision/model/focalnet.onnx");
    expect(dims).toEqual([1, 3, 256, 256]);
    expect(data).toBe(input);
    expect(result).toBe(map);
  });

  test("serializes crops with a browser yield before each inference", async () => {
    let active = 0;
    let maxActive = 0;
    const session: OnnxInferenceSession = { run: async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active--;
      return { importance: { data: new Float32Array(64 * 64), dims: [1, 1, 64, 64] } };
    } };
    setSessionFactory({
      create: async () => session,
      tensor: (data, dims) => ({ data, dims }),
    });
    await Promise.all([
      analyzeFocalImage(new Float32Array(3 * 256 * 256)),
      analyzeFocalImage(new Float32Array(3 * 256 * 256)),
    ]);
    expect(maxActive).toBe(1);
  });

  test("resolves when requestAnimationFrame never calls back", async () => {
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame;
    setSessionFactory({
      create: async () => ({ run: async () => ({ importance: { data: new Float32Array(64 * 64), dims: [1, 1, 64, 64] } }) }),
      tensor: (data, dims) => ({ data, dims }),
    });
    try {
      const result = await Promise.race([
        analyzeFocalImage(new Float32Array(3 * 256 * 256)),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("analyzer timed out")), 500)),
      ]);
      expect(result).toHaveLength(64 * 64);
    } finally {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    }
  });
});
