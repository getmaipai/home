import { afterEach, describe, expect, test } from "bun:test";
import { setSessionFactory, type OnnxInferenceSession, type OnnxTensor, type SessionFactory } from "@/lib/onnx/session-runtime";
import { decodeYunetOutputs } from "@/lib/vision/faceDetect";
import { padToStride, runYunetDetection, toNchwBlob } from "@/lib/vision/faceDetectRuntime";

class FakeFactory implements SessionFactory {
  tensor(data: Float32Array, dims: readonly number[]): OnnxTensor { return { data, dims }; }
  async create(): Promise<OnnxInferenceSession> { throw new Error("unused"); }
}

afterEach(() => setSessionFactory(null));

describe("YuNet browser preprocessing", () => {
  test("pads a non-stride frame without moving its origin and zero-fills the new area", () => {
    const frame = new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8]);
    const result = padToStride(frame, 1, 2);
    expect([result.paddedWidth, result.paddedHeight]).toEqual([32, 32]);
    expect(Array.from(result.padded.slice(0, 4))).toEqual([1, 2, 3, 4]);
    expect(Array.from(result.padded.slice(32 * 4, 32 * 4 + 4))).toEqual([5, 6, 7, 8]);
    expect(result.padded[4]).toBe(0);
    expect(result.padded[8]).toBe(0);
  });

  test("converts known RGBA pixels to raw BGR CHW values", () => {
    // Pixel rows [R,G,B,A] are [1,2,3,255], [4,5,6,255]; [7,8,9,255], [10,11,12,255].
    // YuNet receives three BGR planes in order, with alpha dropped and no scaling.
    const rgba = new Uint8ClampedArray([
      1, 2, 3, 255, 4, 5, 6, 255,
      7, 8, 9, 255, 10, 11, 12, 255,
    ]);
    expect(Array.from(toNchwBlob(rgba, 2, 2))).toEqual([3, 6, 9, 12, 2, 5, 8, 11, 1, 4, 7, 10]);
  });

  test("feeds verified input name and decodes the fixed YuNet output", async () => {
    setSessionFactory(new FakeFactory());
    const output: Record<string, Float32Array> = {};
    for (const stride of [8, 16, 32]) {
      output[`cls_${stride}`] = new Float32Array(1);
      output[`obj_${stride}`] = new Float32Array([1]);
      output[`bbox_${stride}`] = new Float32Array(4);
      output[`kps_${stride}`] = new Float32Array(10);
    }
    output.cls_8![0] = 0.81;
    output.bbox_8!.set([0.5, 0.25, Math.log(2), Math.log(1.5)]);
    output.kps_8!.set([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);
    const tensorOutputs: Record<string, OnnxTensor> = Object.fromEntries(
      Object.entries(output).map(([name, data]) => [name, { data, dims: [] }]),
    );
    let feed: Record<string, OnnxTensor> | undefined;
    const session: OnnxInferenceSession = { run: async (feeds) => { feed = feeds; return tensorOutputs; } };
    const rgba = new Uint8ClampedArray([1, 2, 3, 255]);
    const faces = await runYunetDetection(session, rgba, 1, 1, 0.8, 0.3);
    expect(Object.keys(feed ?? {})).toEqual(["input"]);
    const blob = feed!.input!.data as Float32Array;
    expect([blob[0], blob[1], blob[1024], blob[2048]]).toEqual([3, 0, 2, 1]);
    expect(feed!.input!.dims).toEqual([1, 3, 32, 32]);
    expect(faces).toEqual(decodeYunetOutputs(output, 32, 0.8, 0.3));
    faces[0]!.bbox.forEach((value, i) => expect(value).toBeCloseTo([-4, -4, 16, 12][i]!, 5));
  });
});
