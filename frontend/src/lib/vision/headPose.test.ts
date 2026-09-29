import { describe, expect, test } from "bun:test";
import { bucketPose, DEFAULT_QUALITY_CONFIG } from "@/lib/vision/enrollmentSession";
import { estimateHeadPose } from "@/lib/vision/headPose";
import type { DetectedFace } from "@/lib/vision/faceDetect";
import { TEMPLATE } from "@/lib/vision/faceAlign";

// SFace's frontal five-point template from faceAlign.ts.
const frontalFace: DetectedFace = {
  bbox: [0, 0, 112, 112],
  rightEye: TEMPLATE[0],
  leftEye: TEMPLATE[1],
  nose: TEMPLATE[2],
  rightMouth: TEMPLATE[3],
  leftMouth: TEMPLATE[4],
};

describe("estimateHeadPose", () => {
  test("places the SFace frontal template near zero yaw and pitch", () => {
    const pose = estimateHeadPose(frontalFace);
    expect(pose.yawDeg).toBeCloseTo(0, 0);
    expect(pose.pitchDeg).toBeCloseTo(0, 5);
  });

  test("maps a nose toward the anatomical right eye to the right bucket", () => {
    const turned = { ...frontalFace, nose: [44, frontalFace.nose[1]] as [number, number] };
    const pose = estimateHeadPose(turned);
    expect(pose.yawDeg).toBeLessThan(0);
    expect(bucketPose(pose.yawDeg, pose.pitchDeg, DEFAULT_QUALITY_CONFIG)).toBe("right");
  });

  test("maps a nose toward the anatomical left eye to the left bucket", () => {
    const turned = { ...frontalFace, nose: [68, frontalFace.nose[1]] as [number, number] };
    const pose = estimateHeadPose(turned);
    expect(pose.yawDeg).toBeGreaterThan(0);
    expect(bucketPose(pose.yawDeg, pose.pitchDeg, DEFAULT_QUALITY_CONFIG)).toBe("left");
  });

  test("maps an upward nose displacement to the up bucket", () => {
    const tilted = { ...frontalFace, nose: [frontalFace.nose[0], frontalFace.nose[1] - 12] as [number, number] };
    const pose = estimateHeadPose(tilted);
    expect(pose.pitchDeg).toBeGreaterThan(0);
    expect(bucketPose(pose.yawDeg, pose.pitchDeg, DEFAULT_QUALITY_CONFIG)).toBe("up");
  });

  test("maps a downward nose displacement to the down bucket", () => {
    const tilted = { ...frontalFace, nose: [frontalFace.nose[0], frontalFace.nose[1] + 12] as [number, number] };
    const pose = estimateHeadPose(tilted);
    expect(pose.pitchDeg).toBeLessThan(0);
    expect(bucketPose(pose.yawDeg, pose.pitchDeg, DEFAULT_QUALITY_CONFIG)).toBe("down");
  });

  test("throws a clear error for eye spacing below the minimum", () => {
    const degenerate = { ...frontalFace, rightEye: [56, 52] as [number, number], leftEye: [56, 52] as [number, number] };
    expect(() => estimateHeadPose(degenerate)).toThrow("degenerate interEyeDist");
  });

  test("throws a clear error for eye spacing below the minimum during a near-profile turn", () => {
    const nearProfile = { ...frontalFace, rightEye: [55.75, 52] as [number, number], leftEye: [56.25, 52] as [number, number] };
    expect(() => estimateHeadPose(nearProfile)).toThrow("degenerate interEyeDist");
  });

  test("throws a clear error for a zero eye-to-mouth span", () => {
    const degenerate = {
      ...frontalFace,
      rightMouth: [frontalFace.rightMouth[0], 51.59885] as [number, number],
      leftMouth: [frontalFace.leftMouth[0], 51.59885] as [number, number],
    };
    expect(() => estimateHeadPose(degenerate)).toThrow("degenerate eyeToMouth");
  });

  test("throws a clear error for a negative eye-to-mouth span", () => {
    const degenerate = {
      ...frontalFace,
      rightMouth: [frontalFace.rightMouth[0], 40] as [number, number],
      leftMouth: [frontalFace.leftMouth[0], 40] as [number, number],
    };
    expect(() => estimateHeadPose(degenerate)).toThrow("degenerate eyeToMouth");
  });
});
