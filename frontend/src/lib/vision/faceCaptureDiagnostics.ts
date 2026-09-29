// FACE-02J: console-only measurements, so the quality bar can be set from
// what a real browser webcam produces instead of the legacy numbers nobody
// measured (FACE-02K). Nothing here is shown in the UI, sent anywhere or
// stored: it is console.debug / console.info in the person's own browser
// and is gone when the tab closes.
import type { BucketStatus } from "@/lib/vision/enrollmentSession";
import type { CaptureRing } from "@/lib/vision/faceCaptureFeedback";

export interface JudgedFrame {
  sharpness: number;
  boxFrac: number;
  brightness: number;
  yawDeg: number;
  pitchDeg: number;
  color: CaptureRing;
  reason: string;
  /** The person's own straight-ahead pitch once fixed (FACE-02K). */
  pitchBaselineDeg?: number | null;
}

type Sink = (...args: unknown[]) => void;

const FRAME_LOG_INTERVAL_MS = 1000;

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

/** A per-frame logger that emits at most once per second, however often
 * the capture loop judges a frame. */
export function createFrameLogger(sink: Sink = console.debug, now: () => number = Date.now): (frame: JudgedFrame) => void {
  let last = Number.NEGATIVE_INFINITY;
  return (frame) => {
    const at = now();
    if (at - last < FRAME_LOG_INTERVAL_MS) return;
    last = at;
    sink("face capture: judged frame", {
      sharpness: round(frame.sharpness, 1),
      boxFrac: round(frame.boxFrac, 3),
      brightness: round(frame.brightness, 1),
      yawDeg: round(frame.yawDeg, 1),
      pitchDeg: round(frame.pitchDeg, 1),
      color: frame.color,
      reason: frame.reason,
      pitchBaselineDeg: frame.pitchBaselineDeg ?? null,
    });
  };
}

/** One line per pose at the end of a successful enrollment: the average
 * and minimum sharpness and box fraction of the ACCEPTED shots. */
export function logEnrollmentSummary(buckets: readonly BucketStatus[], sink: Sink = console.info): void {
  for (const bucket of buckets) {
    sink("face capture: accepted shots", {
      pose: bucket.pose,
      shots: bucket.count,
      avgSharpness: bucket.avgSharpness,
      minSharpness: bucket.minSharpness,
      avgBoxFrac: bucket.avgBoxFrac,
      minBoxFrac: bucket.minBoxFrac,
    });
  }
}
