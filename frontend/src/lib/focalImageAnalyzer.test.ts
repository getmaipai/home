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
});
