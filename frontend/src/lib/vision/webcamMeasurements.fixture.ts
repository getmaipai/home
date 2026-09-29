// FACE-02K: 46 judged frames from one real enrollment on a laptop webcam
// (browser page, 4:3 request), logged by FACE-02J's console.debug from the
// tail of the run, after the frontal, left and right steps had passed. One
// camera, one person: the numbers the quality bar was set from. Rows are
// in capture order. `color` and `reason` are what the FACE-02J bar said
// (sharpness 40, boxFrac 0.10, absolute pitch), kept for the record.
export interface WebcamRow {
  sharpness: number;
  boxFrac: number;
  brightness: number;
  yawDeg: number;
  pitchDeg: number;
  color: string;
  reason: string;
}

export const WEBCAM_ROWS: readonly WebcamRow[] = [
  { sharpness: 370.7, boxFrac: 0.054, brightness: 101.1, yawDeg: -1.5, pitchDeg: -16, color: "yellow", reason: "too_far" },
  { sharpness: 228.4, boxFrac: 0.05, brightness: 111.2, yawDeg: -3.8, pitchDeg: -11, color: "yellow", reason: "too_far" },
  { sharpness: 410.6, boxFrac: 0.094, brightness: 132.1, yawDeg: -2.8, pitchDeg: -15.5, color: "yellow", reason: "too_far" },
  { sharpness: 606.5, boxFrac: 0.111, brightness: 137.3, yawDeg: -1.2, pitchDeg: -13.4, color: "yellow", reason: "off_target" },
  { sharpness: 582.3, boxFrac: 0.109, brightness: 137.7, yawDeg: -1.3, pitchDeg: -21.1, color: "yellow", reason: "off_target" },
  { sharpness: 724.8, boxFrac: 0.109, brightness: 139.2, yawDeg: -4.6, pitchDeg: -16.1, color: "yellow", reason: "off_target" },
  { sharpness: 681.5, boxFrac: 0.11, brightness: 139.1, yawDeg: -4.5, pitchDeg: -17.5, color: "yellow", reason: "off_target" },
  { sharpness: 518.7, boxFrac: 0.114, brightness: 144.7, yawDeg: 22.8, pitchDeg: -7.7, color: "green", reason: "ok" },
  { sharpness: 668.9, boxFrac: 0.122, brightness: 142.2, yawDeg: 53.8, pitchDeg: 1, color: "yellow", reason: "off_target" },
  { sharpness: 561.8, boxFrac: 0.124, brightness: 139.2, yawDeg: 21.9, pitchDeg: -21.3, color: "yellow", reason: "off_target" },
  { sharpness: 703.4, boxFrac: 0.115, brightness: 136.2, yawDeg: -8.7, pitchDeg: -10.3, color: "yellow", reason: "off_target" },
  { sharpness: 496.5, boxFrac: 0.095, brightness: 145.5, yawDeg: -649.9, pitchDeg: -7.8, color: "yellow", reason: "too_far" },
  { sharpness: 448.4, boxFrac: 0.093, brightness: 142.7, yawDeg: -208.6, pitchDeg: -9.5, color: "yellow", reason: "too_far" },
  { sharpness: 389.5, boxFrac: 0.096, brightness: 139.7, yawDeg: -347, pitchDeg: -9.5, color: "yellow", reason: "too_far" },
  { sharpness: 603.4, boxFrac: 0.104, brightness: 130.9, yawDeg: -5.1, pitchDeg: -21, color: "yellow", reason: "off_target" },
  { sharpness: 496.2, boxFrac: 0.083, brightness: 138.3, yawDeg: -3.5, pitchDeg: -6.1, color: "yellow", reason: "too_far" },
  { sharpness: 602.1, boxFrac: 0.076, brightness: 141.6, yawDeg: -4.7, pitchDeg: -0.8, color: "yellow", reason: "too_far" },
  { sharpness: 623.3, boxFrac: 0.096, brightness: 139, yawDeg: -0.6, pitchDeg: -7.7, color: "yellow", reason: "too_far" },
  { sharpness: 586.5, boxFrac: 0.091, brightness: 141, yawDeg: -3.6, pitchDeg: -2.7, color: "yellow", reason: "too_far" },
  { sharpness: 684.4, boxFrac: 0.114, brightness: 146.8, yawDeg: 0.6, pitchDeg: -4.4, color: "yellow", reason: "off_target" },
  { sharpness: 646.7, boxFrac: 0.133, brightness: 143.7, yawDeg: 1.4, pitchDeg: -2.8, color: "yellow", reason: "off_target" },
  { sharpness: 822, boxFrac: 0.179, brightness: 135.6, yawDeg: 1.7, pitchDeg: -10.2, color: "yellow", reason: "off_target" },
  { sharpness: 302.3, boxFrac: 0.074, brightness: 127.2, yawDeg: -4.9, pitchDeg: -10.4, color: "yellow", reason: "too_far" },
  { sharpness: 250.3, boxFrac: 0.064, brightness: 117.6, yawDeg: -2.6, pitchDeg: -12.8, color: "yellow", reason: "too_far" },
  { sharpness: 623.9, boxFrac: 0.126, brightness: 132.4, yawDeg: -0.2, pitchDeg: -27.6, color: "yellow", reason: "off_target" },
  { sharpness: 658.1, boxFrac: 0.113, brightness: 140.2, yawDeg: -1.1, pitchDeg: -15.1, color: "yellow", reason: "off_target" },
  { sharpness: 715.3, boxFrac: 0.094, brightness: 142, yawDeg: -2.4, pitchDeg: -7.8, color: "yellow", reason: "too_far" },
  { sharpness: 641.9, boxFrac: 0.097, brightness: 141.5, yawDeg: -4, pitchDeg: -5.7, color: "yellow", reason: "too_far" },
  { sharpness: 703.3, boxFrac: 0.11, brightness: 135.1, yawDeg: 3.5, pitchDeg: -12.6, color: "yellow", reason: "off_target" },
  { sharpness: 567.4, boxFrac: 0.091, brightness: 143.4, yawDeg: -3.2, pitchDeg: -7.9, color: "yellow", reason: "too_far" },
  { sharpness: 673.7, boxFrac: 0.09, brightness: 144, yawDeg: -1.5, pitchDeg: -8.9, color: "yellow", reason: "too_far" },
  { sharpness: 582, boxFrac: 0.093, brightness: 142.6, yawDeg: -2.4, pitchDeg: -8.6, color: "yellow", reason: "too_far" },
  { sharpness: 647.1, boxFrac: 0.118, brightness: 134.9, yawDeg: -1, pitchDeg: -14.1, color: "yellow", reason: "off_target" },
  { sharpness: 626.7, boxFrac: 0.087, brightness: 144.3, yawDeg: -1.4, pitchDeg: -3.5, color: "yellow", reason: "too_far" },
  { sharpness: 679.1, boxFrac: 0.09, brightness: 144, yawDeg: -1.1, pitchDeg: -4.8, color: "yellow", reason: "too_far" },
  { sharpness: 575.5, boxFrac: 0.107, brightness: 133.4, yawDeg: 2.7, pitchDeg: -12.3, color: "yellow", reason: "off_target" },
  { sharpness: 381.7, boxFrac: 0.064, brightness: 126.4, yawDeg: -4.5, pitchDeg: -15.2, color: "yellow", reason: "too_far" },
  { sharpness: 425.1, boxFrac: 0.058, brightness: 115.8, yawDeg: -3.2, pitchDeg: -18.3, color: "yellow", reason: "too_far" },
  { sharpness: 445.4, boxFrac: 0.053, brightness: 112.3, yawDeg: -0.8, pitchDeg: -11.9, color: "yellow", reason: "too_far" },
  { sharpness: 448.3, boxFrac: 0.054, brightness: 113, yawDeg: -3.3, pitchDeg: -10, color: "yellow", reason: "too_far" },
  { sharpness: 441.4, boxFrac: 0.055, brightness: 113.7, yawDeg: -4, pitchDeg: -7.5, color: "yellow", reason: "too_far" },
  { sharpness: 471.1, boxFrac: 0.054, brightness: 113.7, yawDeg: -4, pitchDeg: -6.9, color: "yellow", reason: "too_far" },
  { sharpness: 458.4, boxFrac: 0.054, brightness: 113.9, yawDeg: -4.3, pitchDeg: -12.9, color: "yellow", reason: "too_far" },
  { sharpness: 401.6, boxFrac: 0.057, brightness: 113.1, yawDeg: 0.8, pitchDeg: -15.2, color: "yellow", reason: "too_far" },
  { sharpness: 478.1, boxFrac: 0.054, brightness: 112.7, yawDeg: -3.6, pitchDeg: -12.6, color: "yellow", reason: "too_far" },
  { sharpness: 441.1, boxFrac: 0.051, brightness: 112.8, yawDeg: -4.8, pitchDeg: -11.3, color: "yellow", reason: "too_far" },
];
