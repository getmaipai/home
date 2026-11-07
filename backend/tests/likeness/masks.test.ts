import { describe, expect, test } from "bun:test";
import { backgroundMask, faceOval, morphology, outfitMask, smileMask, subtract, union } from "@/lib/pictures/likeness/masks";
const face = { score: 0.9, bbox: [10, 10, 20, 20] as [number, number, number, number], rightEye: [14, 16] as [number, number], leftEye: [25, 16] as [number, number], nose: [20, 21] as [number, number], rightMouth: [16, 26] as [number, number], leftMouth: [24, 26] as [number, number] };
describe("likeness masks", () => {
  test("morphology uses an exact disk neighborhood and union/subtract", () => { const a = new Uint8Array(25); a[12] = 255; expect(morphology(a, 5, 5, 1, "dilate").filter(Boolean)).toHaveLength(5); expect(morphology(union(a, a), 5, 5, 1, "erode")[12]).toBe(0); expect(subtract(a, a)[12]).toBe(0); });
  test("face oval expands and smile ellipse stays centered", async () => { expect(faceOval(face, 0, 50, 50)[20 * 50 + 20]).toBe(255); const smile = await smileMask([face], 50, 50); expect(smile[20 * 50 + 20]).toBe(255); });
  test("outfit excludes head and background protects the eroded silhouette and dilated head", async () => { const sil = new Uint8Array(100 * 100).fill(255), head = new Uint8Array(100 * 100); head[50 * 100 + 50] = 255; expect((await outfitMask(sil, head, 100, 100))[50 * 100 + 50]).toBe(0); const bg = await backgroundMask(sil, head, 100, 100); expect(bg[50 * 100 + 50]).toBe(0); expect(bg[0]).toBe(255); });
});
