import { describe, expect, it } from "bun:test";
import { bucketPose, DEFAULT_QUALITY_CONFIG } from "@/lib/vision/enrollmentSession";
import { estimateHeadPose } from "@/lib/vision/headPose";
import type { DetectedFace } from "@/lib/vision/faceDetect";

// SFace's frontal five-point template from faceAlign.ts.
const frontalFace: DetectedFace = {
  bbox: [0, 0, 112, 112],
  rightEye: [38.2946, 51.6963],
  leftEye: [73.5318, 51.5014],
  nose: [56.0252, 71.7366],
  rightMouth: [41.5493, 92.3655],
  leftMouth: [70.7299, 92.2041],
};

describe("estimateHeadPose", () => {
  it("places the SFace frontal template near zero yaw and pitch", () => {
    const pose = estimateHeadPose(frontalFace);
    expect(pose.yawDeg).toBeCloseTo(0, 0);
    expect(pose.pitchDeg).toBeCloseTo(0, 5);
  });

  it("maps a nose toward the anatomical right eye to the right bucket", () => {
    const turned = { ...frontalFace, nose: [44, frontalFace.nose[1]] as [number, number] };
    const pose = estimateHeadPose(turned);
    expect(pose.yawDeg).toBeLessThan(0);
    expect(bucketPose(pose.yawDeg, pose.pitchDeg, DEFAULT_QUALITY_CONFIG)).toBe("right");
  });

  it("maps a nose toward the anatomical left eye to the left bucket", () => {
    const turned = { ...frontalFace, nose: [68, frontalFace.nose[1]] as [number, number] };
    const pose = estimateHeadPose(turned);
    expect(pose.yawDeg).toBeGreaterThan(0);
    expect(bucketPose(pose.yawDeg, pose.pitchDeg, DEFAULT_QUALITY_CONFIG)).toBe("left");
  });

  it("maps an upward nose displacement to the up bucket", () => {
    const tilted = { ...frontalFace, nose: [frontalFace.nose[0], frontalFace.nose[1] - 12] as [number, number] };
    const pose = estimateHeadPose(tilted);
    expect(pose.pitchDeg).toBeGreaterThan(0);
    expect(bucketPose(pose.yawDeg, pose.pitchDeg, DEFAULT_QUALITY_CONFIG)).toBe("up");
  });

  it("maps a downward nose displacement to the down bucket", () => {
    const tilted = { ...frontalFace, nose: [frontalFace.nose[0], frontalFace.nose[1] + 12] as [number, number] };
    const pose = estimateHeadPose(tilted);
    expect(pose.pitchDeg).toBeLessThan(0);
    expect(bucketPose(pose.yawDeg, pose.pitchDeg, DEFAULT_QUALITY_CONFIG)).toBe("down");
  });

  it("throws a clear error for degenerate eye spacing", () => {
    const degenerate = { ...frontalFace, rightEye: [56, 52] as [number, number], leftEye: [56, 52] as [number, number] };
    expect(() => estimateHeadPose(degenerate)).toThrow("degenerate interEyeDist");
  });

  it("throws a clear error for a zero eye-to-mouth span", () => {
    const degenerate = {
      ...frontalFace,
      rightMouth: [frontalFace.rightMouth[0], 51.59885] as [number, number],
      leftMouth: [frontalFace.leftMouth[0], 51.59885] as [number, number],
    };
    expect(() => estimateHeadPose(degenerate)).toThrow("degenerate eyeToMouth");
  });
});
