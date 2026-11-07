import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { detectFaces, faceCosine } from "@/lib/pictures/likeness/faces";

describe("likeness faces (measured against OpenCV SFace on 2026-11-07: same person after a whole outfit edit 0.963 vs 0.965, different people about 0.35)", () => {
  test("cosine: identical is 1, orthogonal is 0, a size mismatch or zero vector is 0", () => {
    const a = new Float32Array([1, 2, 3]);
    expect(faceCosine(a, a)).toBeCloseTo(1, 6);
    expect(faceCosine(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBe(0);
    expect(faceCosine(a, new Float32Array([1, 2]))).toBe(0);
    expect(faceCosine(new Float32Array(3), a)).toBe(0);
  });
  test("with the models not installed the answer is a plain sentence, never a path or a throw", async () => {
    const png = new Uint8Array(await sharp({ create: { width: 64, height: 64, channels: 3, background: "#888" } }).png().toBuffer());
    const result = await detectFaces(png);
    if (result.ok) return; // models are installed on this machine: nothing to assert here
    expect(result.kind).toBe("FacesUnavailable");
    expect(result.line).not.toContain("/");
    expect(result.line.length).toBeGreaterThan(20);
  });
});
