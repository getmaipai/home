import { afterEach, describe, expect, test } from "bun:test";
import { setSessionFactory, type OnnxInferenceSession, type OnnxTensor, type SessionFactory } from "@/lib/onnx/session-runtime";
import { CROP_SIZE } from "@/lib/vision/faceAlign";
import { runSfaceEmbedding, toEmbedBlob } from "@/lib/vision/faceEmbedRuntime";

class FakeFactory implements SessionFactory {
  tensor(data: Float32Array, dims: readonly number[]): OnnxTensor { return { data, dims }; }
  async create(): Promise<OnnxInferenceSession> { throw new Error("unused"); }
}

afterEach(() => setSessionFactory(null));

describe("SFace browser preprocessing", () => {
  test("converts an aligned RGBA crop to raw RGB NCHW values", () => {
    // At pixel (0,0), RGBA [10,20,30,255] becomes R=10,G=20,B=30 at each CHW plane start.
    const rgba = new Uint8ClampedArray(CROP_SIZE * CROP_SIZE * 4);
    rgba.set([10, 20, 30, 255]);
    const blob = toEmbedBlob(rgba);
    const plane = CROP_SIZE * CROP_SIZE;
    expect([blob[0], blob[plane], blob[plane * 2]]).toEqual([10, 20, 30]);
  });

  test("feeds verified SFace names and returns its 128-value embedding", async () => {
    setSessionFactory(new FakeFactory());
    let feed: Record<string, OnnxTensor> | undefined;
    const values = Float32Array.from({ length: 128 }, (_, i) => i / 10);
    const session: OnnxInferenceSession = { run: async (feeds) => { feed = feeds; return { fc1: { data: values, dims: [1, 128] } }; } };
    const rgba = new Uint8ClampedArray(CROP_SIZE * CROP_SIZE * 4);
    rgba.set([10, 20, 30, 255]);
    const result = await runSfaceEmbedding(session, rgba);
    expect(Object.keys(feed ?? {})).toEqual(["data"]);
    expect(feed!.data!.dims).toEqual([1, 3, CROP_SIZE, CROP_SIZE]);
    const plane = CROP_SIZE * CROP_SIZE;
    expect([feed!.data!.data[0], feed!.data!.data[plane], feed!.data!.data[plane * 2]]).toEqual([10, 20, 30]);
    expect(result).toEqual(values);
  });
});
