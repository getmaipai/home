// FACE-02P: 28 judged frames from Jesse's second real enrollment on the same
// laptop webcam (2026-09-29), the RIGHT step that never registered, kept as
// logged by FACE-02J's console line on the code with FACE-02K's precedence
// (pitch before yaw). One camera, one person. `color`, `reason` and
// `pitchBaselineDeg` are what the shipped code said; the first two rows are
// the calibration frames before the baseline was fixed (null). Yaw is
// negative when turning to the person's right.
export interface RightTurnRow {
  sharpness: number;
  boxFrac: number;
  brightness: number;
  yawDeg: number;
  pitchDeg: number;
  color: string;
  reason: string;
  pitchBaselineDeg: number | null;
}

export const RIGHT_TURN_ROWS: readonly RightTurnRow[] = [
  { sharpness: 646.3, boxFrac: 0.099, brightness: 114.8, yawDeg: -3.3, pitchDeg: -17.7, color: "yellow", reason: "calibrating", pitchBaselineDeg: null },
  { sharpness: 631.6, boxFrac: 0.097, brightness: 120.3, yawDeg: -3, pitchDeg: -13.5, color: "yellow", reason: "calibrating", pitchBaselineDeg: null },
  { sharpness: 574.6, boxFrac: 0.107, brightness: 120.8, yawDeg: -1, pitchDeg: -11.2, color: "yellow", reason: "off_target", pitchBaselineDeg: -14.8 },
  { sharpness: 531.4, boxFrac: 0.11, brightness: 127.8, yawDeg: 9.1, pitchDeg: -14.4, color: "yellow", reason: "off_target", pitchBaselineDeg: -14.8 },
  { sharpness: 398.7, boxFrac: 0.115, brightness: 137.6, yawDeg: 27, pitchDeg: -13, color: "yellow", reason: "off_target", pitchBaselineDeg: -14.8 },
  { sharpness: 651.4, boxFrac: 0.114, brightness: 128.7, yawDeg: -1.7, pitchDeg: -10.2, color: "yellow", reason: "off_target", pitchBaselineDeg: -14.8 },
  { sharpness: 294, boxFrac: 0.081, brightness: 122.9, yawDeg: -168, pitchDeg: 0.3, color: "yellow", reason: "no_pose", pitchBaselineDeg: -14.8 },
  { sharpness: 425.3, boxFrac: 0.082, brightness: 113.6, yawDeg: -383.2, pitchDeg: 2.6, color: "yellow", reason: "no_pose", pitchBaselineDeg: -14.8 },
  { sharpness: 528, boxFrac: 0.121, brightness: 93.5, yawDeg: -15.7, pitchDeg: -6.5, color: "yellow", reason: "between_angles", pitchBaselineDeg: -14.8 },
  { sharpness: 784.1, boxFrac: 0.123, brightness: 113.2, yawDeg: -8, pitchDeg: -3.7, color: "yellow", reason: "off_target", pitchBaselineDeg: -14.8 },
  { sharpness: 503.8, boxFrac: 0.121, brightness: 119.9, yawDeg: -49, pitchDeg: 9.8, color: "yellow", reason: "off_target", pitchBaselineDeg: -14.8 },
  { sharpness: 399.9, boxFrac: 0.094, brightness: 120, yawDeg: -100.6, pitchDeg: 3.8, color: "yellow", reason: "no_pose", pitchBaselineDeg: -14.8 },
  { sharpness: 398.1, boxFrac: 0.09, brightness: 116.4, yawDeg: -229.2, pitchDeg: 6.8, color: "yellow", reason: "no_pose", pitchBaselineDeg: -14.8 },
  { sharpness: 632.8, boxFrac: 0.13, brightness: 100.3, yawDeg: -13.8, pitchDeg: 1.3, color: "yellow", reason: "off_target", pitchBaselineDeg: -14.8 },
  { sharpness: 695, boxFrac: 0.141, brightness: 117.9, yawDeg: -3.4, pitchDeg: -12.1, color: "yellow", reason: "off_target", pitchBaselineDeg: -14.8 },
  { sharpness: 592, boxFrac: 0.149, brightness: 123.2, yawDeg: -23.5, pitchDeg: -0.9, color: "yellow", reason: "off_target", pitchBaselineDeg: -14.8 },
  { sharpness: 273.3, boxFrac: 0.097, brightness: 123.9, yawDeg: -111.4, pitchDeg: 7.5, color: "yellow", reason: "no_pose", pitchBaselineDeg: -14.8 },
  { sharpness: 290.7, boxFrac: 0.107, brightness: 102.6, yawDeg: -31.3, pitchDeg: 6.6, color: "yellow", reason: "off_target", pitchBaselineDeg: -14.8 },
  { sharpness: 525.5, boxFrac: 0.089, brightness: 110.3, yawDeg: -8.1, pitchDeg: -5.6, color: "yellow", reason: "off_target", pitchBaselineDeg: -14.8 },
  { sharpness: 179.5, boxFrac: 0.064, brightness: 121.3, yawDeg: -101.7, pitchDeg: 11.5, color: "yellow", reason: "no_pose", pitchBaselineDeg: -14.8 },
  { sharpness: 226.7, boxFrac: 0.063, brightness: 112.6, yawDeg: -65.1, pitchDeg: -4.7, color: "yellow", reason: "too_far", pitchBaselineDeg: -14.8 },
  { sharpness: 659.1, boxFrac: 0.091, brightness: 100.6, yawDeg: -5.4, pitchDeg: -14.5, color: "yellow", reason: "off_target", pitchBaselineDeg: -14.8 },
  { sharpness: 493.8, boxFrac: 0.092, brightness: 112.2, yawDeg: -36.4, pitchDeg: 14.6, color: "yellow", reason: "off_target", pitchBaselineDeg: -14.8 },
  { sharpness: 303.5, boxFrac: 0.076, brightness: 116.9, yawDeg: -47.2, pitchDeg: 8, color: "yellow", reason: "too_far", pitchBaselineDeg: -14.8 },
  { sharpness: 305, boxFrac: 0.08, brightness: 100.6, yawDeg: -31.8, pitchDeg: 11.7, color: "yellow", reason: "off_target", pitchBaselineDeg: -14.8 },
  { sharpness: 582.2, boxFrac: 0.086, brightness: 101.8, yawDeg: -5.8, pitchDeg: -16.2, color: "yellow", reason: "off_target", pitchBaselineDeg: -14.8 },
  { sharpness: 563.3, boxFrac: 0.089, brightness: 106.7, yawDeg: -10.4, pitchDeg: -14, color: "yellow", reason: "off_target", pitchBaselineDeg: -14.8 },
  { sharpness: 665, boxFrac: 0.083, brightness: 107.2, yawDeg: -9.8, pitchDeg: -13.8, color: "yellow", reason: "off_target", pitchBaselineDeg: -14.8 },
];
