import { describe, expect, mock, test } from "bun:test";
import { createFrameLogger, logEnrollmentSummary } from "@/lib/vision/faceCaptureDiagnostics";
import type { BucketStatus } from "@/lib/vision/enrollmentSession";

const frame = { sharpness: 61.2345, boxFrac: 0.0871234, brightness: 118.5, yawDeg: 1.234, pitchDeg: -0.5, color: "yellow", reason: "blurry" } as const;

describe("createFrameLogger", () => {
  test("logs the judged frame's numbers at most about once a second", () => {
    const sink = mock(() => {});
    let now = 10_000;
    const log = createFrameLogger(sink, () => now);
    log(frame);
    now += 400;
    log(frame);
    now += 400;
    log(frame);
    expect(sink).toHaveBeenCalledTimes(1);
    now += 400;
    log(frame);
    expect(sink).toHaveBeenCalledTimes(2);
  });

  test("the line carries sharpness, boxFrac, brightness, pose, color and reason", () => {
    const sink = mock((..._args: unknown[]) => {});
    createFrameLogger(sink, () => 1)(frame);
    const [label, payload] = sink.mock.calls[0]!;
    expect(String(label)).toContain("face capture");
    expect(payload).toEqual({ sharpness: 61.2, boxFrac: 0.087, brightness: 118.5, yawDeg: 1.2, pitchDeg: -0.5, color: "yellow", reason: "blurry" });
  });
});

describe("logEnrollmentSummary", () => {
  test("one line per pose with the average and minimum of the accepted shots", () => {
    const sink = mock((..._args: unknown[]) => {});
    const buckets: BucketStatus[] = [
      { pose: "frontal", count: 1, needed: 1, avgSharpness: 120, avgBoxFrac: 0.2, minSharpness: 120, minBoxFrac: 0.2 },
      { pose: "left", count: 1, needed: 1, avgSharpness: 95.5, avgBoxFrac: 0.15, minSharpness: 95.5, minBoxFrac: 0.15 },
    ];
    logEnrollmentSummary(buckets, sink);
    expect(sink).toHaveBeenCalledTimes(2);
    expect(sink.mock.calls[1]![1]).toEqual({ pose: "left", shots: 1, avgSharpness: 95.5, minSharpness: 95.5, avgBoxFrac: 0.15, minBoxFrac: 0.15 });
  });
});
