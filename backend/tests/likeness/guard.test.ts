import { describe, expect, test } from "bun:test";
import { coverage, faceUntouched, matchFaces, ringDiff, smallFace, ssimGray } from "@/lib/pictures/likeness/guard";
const face = { bbox: [2, 2, 4, 4] as [number, number, number, number] };
describe("likeness guards", () => {
  test("SSIM is one for identical pixels and declines after a change", () => { const a = new Uint8Array(15 * 15).fill(100), b = a.slice(); expect(ssimGray(a, b, 15, 15)).toBeCloseTo(1, 8); b[7 * 15 + 7] = 0; expect(ssimGray(a, b, 15, 15)).toBeLessThan(1); });
  test("faceUntouched uses the clamped face region", () => { const a = new Uint8Array(100).fill(30); expect(faceUntouched(a, a.slice(), face, 10, 10)).toBeCloseTo(1, 8); });
  test("matches nearest face and marks a vanished face removed", () => { expect(matchFaces([face], [{ bbox: [3, 2, 4, 4] }])[0]?.kind).toBe("matched"); expect(matchFaces([face], [])[0]?.kind).toBe("removed"); });
  test("coverage threshold and outside ring difference", () => { const src = new Uint8Array(100).fill(0), out = new Uint8Array(100).fill(0), mask = new Uint8Array(25); mask[12] = 255; out[12 * 4] = 80; expect(coverage(src, out, mask)).toBe(1); expect(ringDiff(src, out, mask, 5, 5, 1)).toBe(0); out[11 * 4] = 40; expect(ringDiff(src, out, mask, 5, 5, 1)).toBeGreaterThan(0); });
  test("small faces use the 60 and 80 pixel cutoffs", () => { expect(smallFace({ bbox: [0, 0, 59, 20] })).toEqual({ under60: true, refuseSmile: true }); expect(smallFace({ bbox: [0, 0, 70, 20] }).refuseSmile).toBe(true); expect(smallFace({ bbox: [0, 0, 80, 20] }).under60).toBe(false); });
});
