import type { DetectedFace } from "@/lib/vision/faceDetect";
import { TEMPLATE } from "@/lib/vision/faceAlign";

/**
 * Estimate yaw and pitch from YuNet's five pixel-space landmarks.
 *
 * These scale constants are uncalibrated starting values for UI guidance,
 * not a calibrated 3D pose solve. They need tuning with a live camera and a
 * real face. This estimate does not correct head roll. Pose does not
 * participate in identity matching, which uses only the face embedding.
 */
// A normalized displacement near one is a near-profile cue, so 70 degrees
// puts it inside the expected 60–90 degree neighborhood as a starting point.
const YAW_SCALE_DEG = 70;
const PITCH_SCALE_DEG = 70;

// YuNet landmarks closer than a few pixels are too noisy for stable
// normalization, especially during near-profile turns.
const MIN_INTER_EYE_DIST_PX = 3;
const MIN_EYE_TO_MOUTH_PX = 3;

// Derive the frontal nose ratio directly from faceAlign.ts's SFace template.
// Keep the sign used by (eyeMidY - nose.y), so the template gives zero pitch.
const templateEyeMidY = (TEMPLATE[0][1] + TEMPLATE[1][1]) / 2;
const templateMouthMidY = (TEMPLATE[3][1] + TEMPLATE[4][1]) / 2;
const FRONTAL_NOSE_RATIO = (templateEyeMidY - TEMPLATE[2][1]) / (templateMouthMidY - templateEyeMidY);

/** Return heuristic yaw/pitch degrees for the detected face landmarks. */
export function estimateHeadPose(face: DetectedFace): { yawDeg: number; pitchDeg: number } {
  const points = [face.rightEye, face.leftEye, face.nose, face.rightMouth, face.leftMouth];
  if (points.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) {
    throw new Error("head pose landmarks must have finite coordinates");
  }

  const eyeMidX = (face.rightEye[0] + face.leftEye[0]) / 2;
  const eyeMidY = (face.rightEye[1] + face.leftEye[1]) / 2;
  const interEyeDist = Math.hypot(
    face.rightEye[0] - face.leftEye[0],
    face.rightEye[1] - face.leftEye[1],
  );
  if (interEyeDist < MIN_INTER_EYE_DIST_PX) {
    throw new Error("degenerate interEyeDist: eye landmarks must be distinct");
  }

  const mouthMidY = (face.rightMouth[1] + face.leftMouth[1]) / 2;
  const eyeToMouth = mouthMidY - eyeMidY;
  if (!Number.isFinite(eyeToMouth) || eyeToMouth < MIN_EYE_TO_MOUTH_PX) {
    throw new Error("degenerate eyeToMouth: eye and mouth lines must have a positive vertical span");
  }

  const yawRatio = (face.nose[0] - eyeMidX) / interEyeDist;
  const pitchRatio = (eyeMidY - face.nose[1]) / eyeToMouth - FRONTAL_NOSE_RATIO;
  return {
    yawDeg: yawRatio * YAW_SCALE_DEG,
    pitchDeg: pitchRatio * PITCH_SCALE_DEG,
  };
}
