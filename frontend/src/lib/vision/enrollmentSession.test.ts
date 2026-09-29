import { describe, expect, test } from "bun:test";
import { WEBCAM_ROWS } from "@/lib/vision/webcamMeasurements.fixture";
import {
  assessQuality,
  bucketPose,
  createEnrollmentSpec,
  createFaceSample,
  DEFAULT_QUALITY_CONFIG,
  EnrollmentSession,
  FaceGallery,
} from "@/lib/vision/enrollmentSession";

const cfg = DEFAULT_QUALITY_CONFIG;
// FACE-02K: the strict per-step tests are about ordering and the bar, not
// the calibration frames, so they use a one-frame baseline; the calibration
// itself is tested below with the real default.
const spec = (overrides: Parameters<typeof createEnrollmentSpec>[0] = {}) =>
  createEnrollmentSpec({ baselineFrames: 1, ...overrides });
const good = (overrides: Parameters<typeof createFaceSample>[1] = {}) =>
  createFaceSample([1, 0], { boxFrac: 0.2, sharpness: 100, brightness: 128, ...overrides });

describe("bucketPose", () => {
  test("assigns the five guided poses and gives pitch priority over yaw", () => {
    expect(bucketPose(0, 0, cfg)).toBe("frontal");
    expect(bucketPose(20, 0, cfg)).toBe("left");
    expect(bucketPose(-20, 0, cfg)).toBe("right");
    expect(bucketPose(0, 16, cfg)).toBe("up");
    expect(bucketPose(0, -16, cfg)).toBe("down");
    expect(bucketPose(20, -16, cfg)).toBe("down");
  });

  test("leaves the gap between frontal and turn angles unbucketed", () => {
    expect(bucketPose(15, 0, cfg)).toBeNull();
  });
});

describe("assessQuality", () => {
  test("rejects each marginal threshold and accepts a sample on the allowed boundaries", () => {
    expect(assessQuality(good({ boxFrac: cfg.minBoxFrac - 0.001 }), cfg)).toEqual({ ok: false, reason: "too_far" });
    expect(assessQuality(good({ sharpness: cfg.minSharpness - 0.1 }), cfg)).toEqual({ ok: false, reason: "blurry" });
    expect(assessQuality(good({ brightness: 39.9 }), cfg)).toEqual({ ok: false, reason: "too_dark" });
    expect(assessQuality(good({ brightness: 220.1 }), cfg)).toEqual({ ok: false, reason: "too_bright" });
    expect(assessQuality(good({ boxFrac: cfg.minBoxFrac, sharpness: cfg.minSharpness, brightness: 40 }), cfg)).toEqual({ ok: true, reason: "ok" });
    expect(assessQuality(good({ brightness: 220 }), cfg)).toEqual({ ok: true, reason: "ok" });
  });
});

describe("EnrollmentSession", () => {
  test("completes after one accepted sample in each pose, on the fifth sample", () => {
    const session = new EnrollmentSession("iris", spec({ shotsPerPose: 1 }));
    const samples = [good(), good({ yawDeg: 20 }), good({ yawDeg: -20 }), good({ pitchDeg: 16 }), good({ pitchDeg: -16 })];
    for (const [index, sample] of samples.entries()) {
      const result = session.offer(sample);
      expect(result.accepted).toBe(true);
      expect(result.complete).toBe(index === 4);
    }
    expect(session.status().coveragePct).toBe(100);
  });

  test("rejected quality and in-between frames do not change coverage", () => {
    const session = new EnrollmentSession("iris", spec({ shotsPerPose: 1 }));
    expect(session.offer(good({ sharpness: 10 })).reason).toBe("blurry");
    expect(session.offer(good({ yawDeg: 15 })).reason).toBe("between_angles");
    expect(session.status().shots).toBe(0);
    expect(session.status().coveragePct).toBe(0);
  });

  test("a pose already captured is rejected as off target without changing its count", () => {
    const session = new EnrollmentSession("iris", spec({ shotsPerPose: 1 }));
    session.offer(good());
    expect(session.offer(good()).reason).toBe("off_target");
    expect(session.status().buckets[0]?.count).toBe(1);
    expect(session.status().shots).toBe(1);
  });

  test("FACE-02I: a frame that swings past another pose while moving is not banked there", () => {
    const session = new EnrollmentSession("iris", spec({ shotsPerPose: 1 }));
    for (const s of [good(), good({ yawDeg: 20 }), good({ yawDeg: -20 })]) expect(session.offer(s).accepted).toBe(true);
    expect(session.currentTarget()).toBe("up");
    const transitional = session.offer(good({ pitchDeg: -16 }));
    expect(transitional).toMatchObject({ accepted: false, reason: "off_target" });
    expect(session.status().buckets.find((b) => b.pose === "down")?.count).toBe(0);
    expect(session.offer(good({ pitchDeg: 16 })).accepted).toBe(true);
    expect(session.offer(good({ pitchDeg: -16 })).accepted).toBe(true);
    expect(session.status().complete).toBe(true);
  });

  test("FACE-02I: an out-of-order pose is not accepted", () => {
    const session = new EnrollmentSession("iris", spec({ shotsPerPose: 1 }));
    expect(session.offer(good({ yawDeg: 20 })).reason).toBe("off_target");
    expect(session.status().coveragePct).toBe(0);
  });

  test("currentTarget walks the poses in order and ends at null", () => {
    const session = new EnrollmentSession("iris", spec({ shotsPerPose: 1 }));
    const seen: Array<string | null> = [];
    for (const s of [good(), good({ yawDeg: 20 }), good({ yawDeg: -20 }), good({ pitchDeg: 16 }), good({ pitchDeg: -16 })]) {
      seen.push(session.currentTarget());
      session.offer(s);
    }
    seen.push(session.currentTarget());
    expect(seen).toEqual(["frontal", "left", "right", "up", "down", null]);
  });

  test("status lists the remaining prompts in order", () => {
    const session = new EnrollmentSession("iris", spec({ shotsPerPose: 1 }));
    expect(session.status().coveragePct).toBe(0);
    expect(session.status().needs).toEqual([
      "look straight at me",
      "slowly turn your head to your left",
      "slowly turn your head to your right",
      "tip your chin up a little",
      "tip your chin down a little",
    ]);
    session.offer(good());
    expect(session.status().coveragePct).toBe(20);
    expect(session.status().needs).toHaveLength(4);
  });

  // FACE-02J: one bar. The old pass/solid pair is gone, so nothing is
  // accepted and then called soft at the end.
  test("FACE-02J: there is one quality bar, no second solid tier and no retake list", () => {
    expect(Object.keys(cfg)).not.toContain("solidSharpness");
    expect(Object.keys(cfg)).not.toContain("solidBoxFrac");
    const session = new EnrollmentSession("iris", spec({ shotsPerPose: 1 }));
    session.offer(good({ sharpness: cfg.minSharpness, boxFrac: cfg.minBoxFrac }));
    expect(Object.keys(session.status())).not.toContain("retake");
    expect(Object.keys(session.status().buckets[0]!)).not.toContain("retake");
  });

  test("FACE-02J: a soft frame is rejected as blurry and never counts toward the pose", () => {
    const session = new EnrollmentSession("iris", spec({ shotsPerPose: 1 }));
    const result = session.offer(good({ sharpness: 30 }));
    expect(result).toMatchObject({ accepted: false, reason: "blurry" });
    expect(session.status().buckets[0]).toMatchObject({ count: 0 });
    expect(session.embeddings()).toEqual([]);
    expect(session.currentTarget()).toBe("frontal");
    expect(session.offer(good({ sharpness: 120 })).accepted).toBe(true);
    expect(session.status().buckets[0]).toMatchObject({ count: 1, avgSharpness: 120, minSharpness: 120 });
  });

  test("FACE-02J: a far frame is rejected as too far", () => {
    const session = new EnrollmentSession("iris", spec({ shotsPerPose: 1 }));
    expect(session.offer(good({ boxFrac: 0.07 }))).toMatchObject({ accepted: false, reason: "too_far" });
  });

  test("FACE-02J: nothing below the bar is ever accepted, across a sweep of sharpness, size and brightness", () => {
    let accepted = 0;
    let rejected = 0;
    for (let sharpness = 0; sharpness <= 200; sharpness += 5) {
      for (let box = 0; box <= 0.3001; box += 0.01) {
        for (const brightness of [0, 39, 40, 128, 220, 221, 255]) {
          const session = new EnrollmentSession("iris", spec({ shotsPerPose: 1 }));
          const result = session.offer(good({ sharpness, boxFrac: box, brightness }));
          const clears = sharpness >= cfg.minSharpness && box >= cfg.minBoxFrac
            && brightness >= cfg.minBrightness && brightness <= cfg.maxBrightness;
          expect(result.accepted).toBe(clears);
          expect(session.embeddings()).toHaveLength(clears ? 1 : 0);
          expect(session.status().shots).toBe(clears ? 1 : 0);
          if (clears) accepted += 1; else rejected += 1;
        }
      }
    }
    expect(accepted).toBeGreaterThan(0);
    expect(rejected).toBeGreaterThan(0);
  });

  test("FACE-02J: a bucket reports the average and minimum of the accepted shots only", () => {
    const session = new EnrollmentSession("iris", spec({ shotsPerPose: 2 }));
    session.offer(good({ sharpness: 50, boxFrac: 0.05 }));
    session.offer(good({ sharpness: 100, boxFrac: 0.2 }));
    session.offer(good({ sharpness: 140, boxFrac: 0.3 }));
    expect(session.status().buckets[0]).toMatchObject({
      count: 2, avgSharpness: 120, minSharpness: 100, avgBoxFrac: 0.25, minBoxFrac: 0.2,
    });
  });
});

describe("FaceGallery", () => {
  test("identifies an above-threshold person and keeps the real score for a miss", () => {
    const gallery = new FaceGallery();
    gallery.enroll("iris", [[1, 0]]);
    expect(gallery.identify([1, 0])).toMatchObject({ name: "iris", score: 1 });
    expect(gallery.identify([0, 1])).toMatchObject({ name: null, score: 0 });
    const below = gallery.identify([0.2, Math.sqrt(0.96)]);
    expect(below.name).toBeNull();
    expect(below.score).toBe(0.2);
  });

  test("compares the best score per person when reporting the ambiguity margin", () => {
    const gallery = new FaceGallery();
    gallery.enroll("iris", [[1, 0], [0.99, 0.1]]);
    gallery.enroll("sage", [[0.8, 0.6]]);
    expect(gallery.identify([1, 0])).toMatchObject({ name: "iris", margin: 0.2 });
  });
});

// FACE-02K: the bar and the pitch calibration, replayed from real frames
// (webcamMeasurements.fixture.ts: 46 judged frames from a laptop webcam).
const asSample = (row: (typeof WEBCAM_ROWS)[number]) =>
  createFaceSample([1, 0], {
    yawDeg: row.yawDeg, pitchDeg: row.pitchDeg, boxFrac: row.boxFrac, sharpness: row.sharpness, brightness: row.brightness,
  });
const OLD_BAR = { ...cfg, minBoxFrac: 0.1, minSharpness: 40 };
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

describe("FACE-02K: the quality bar against real webcam frames", () => {
  test("the old bar failed ordinary seating as too far, and no frame could have been Up", () => {
    const ordinary = WEBCAM_ROWS.filter((row) => row.boxFrac >= 0.083 && row.boxFrac < 0.1);
    expect(ordinary.length).toBeGreaterThanOrEqual(10);
    for (const row of ordinary) expect(assessQuality(asSample(row), OLD_BAR)).toEqual({ ok: false, reason: "too_far" });
    // Absolute pitch: the camera is below eye level, so straight ahead reads
    // negative and the old +15 was unreachable (the largest row is +1).
    expect(Math.max(...WEBCAM_ROWS.map((row) => row.pitchDeg))).toBeLessThan(cfg.updownMinPitch);
    expect(WEBCAM_ROWS.filter((row) => row.pitchDeg >= 15)).toHaveLength(0);
  });

  test("the new bar passes ordinary seating and still fails leaning back", () => {
    for (const row of WEBCAM_ROWS.filter((r) => r.boxFrac >= 0.083 && r.boxFrac <= 0.14 && Math.abs(r.yawDeg) < 90)) {
      expect(assessQuality(asSample(row), cfg).ok).toBe(true);
    }
    for (const row of WEBCAM_ROWS.filter((r) => r.boxFrac <= 0.076)) {
      expect(assessQuality(asSample(row), cfg)).toEqual({ ok: false, reason: "too_far" });
    }
  });

  test("the softness bar is 90, and this camera clears it by more than 2.5x on every frame", () => {
    expect(cfg.minSharpness).toBe(90);
    expect(Math.min(...WEBCAM_ROWS.map((row) => row.sharpness))).toBeGreaterThan(cfg.minSharpness * 2.5);
    expect(assessQuality(good({ sharpness: 89 }), cfg)).toEqual({ ok: false, reason: "blurry" });
  });
});

describe("FACE-02K: junk poses are no pose", () => {
  const junk = WEBCAM_ROWS.filter((row) => Math.abs(row.yawDeg) > 90);

  test("the three absurd-yaw rows are rejected as no_pose and never counted", () => {
    expect(junk).toHaveLength(3);
    const session = new EnrollmentSession("iris", spec({ shotsPerPose: 1 }));
    for (const row of junk) expect(session.offer(asSample({ ...row, boxFrac: 0.12 }))).toMatchObject({ accepted: false, reason: "no_pose" });
    expect(session.status().shots).toBe(0);
    expect(session.status().pitchBaselineDeg).toBeNull();
  });

  test("an absurd pitch, or a non-finite pose, is no pose too", () => {
    const session = new EnrollmentSession("iris", spec());
    expect(session.offer(good({ pitchDeg: 75 })).reason).toBe("no_pose");
    expect(session.offer(good({ pitchDeg: -61 })).reason).toBe("no_pose");
    expect(session.offer(good({ yawDeg: Number.NaN })).reason).toBe("no_pose");
    expect(session.offer(good({ yawDeg: 91 })).reason).toBe("no_pose");
    expect(session.status().shots).toBe(0);
  });

  test("a junk frame never reaches a later step either", () => {
    const session = new EnrollmentSession("iris", spec({ shotsPerPose: 1 }));
    for (const s of [good(), good({ yawDeg: 20 }), good({ yawDeg: -20 })]) session.offer(s);
    expect(session.offer(good({ yawDeg: -347, pitchDeg: 12 })).reason).toBe("no_pose");
    expect(session.currentTarget()).toBe("up");
  });
});

describe("FACE-02K: up and down are judged against the person's own straight ahead", () => {
  // Replay the real rows in capture order until the frontal step completes.
  const calibrate = () => {
    const session = new EnrollmentSession("iris", createEnrollmentSpec({ shotsPerPose: 1 }));
    const reasons: string[] = [];
    for (const row of WEBCAM_ROWS) {
      reasons.push(session.offer(asSample(row)).reason);
      if (session.currentTarget() !== "frontal") break;
    }
    return { session, reasons };
  };
  const frontalRows = WEBCAM_ROWS.filter((row) => Math.abs(row.yawDeg) <= 12 && assessQuality(asSample(row), cfg).ok);

  test("real straight-ahead frames (pitch -6 to -21) complete the frontal step, not off_target", () => {
    const { session, reasons } = calibrate();
    expect(session.currentTarget()).toBe("left");
    expect(reasons.filter((r) => r === "calibrating")).toHaveLength(4);
    expect(reasons.at(-1)).toBe("ok");
    expect(session.status().buckets[0]).toMatchObject({ pose: "frontal", count: 1 });
  });

  test("the baseline is the median of the first five frontal frames that cleared the bar, and never moves after", () => {
    const { session } = calibrate();
    const expected = median(frontalRows.slice(0, 5).map((row) => row.pitchDeg));
    expect(expected).toBeLessThan(-10);
    expect(session.status().pitchBaselineDeg).toBe(Math.round(expected * 10) / 10);
    const fixed = session.status().pitchBaselineDeg;
    for (const pitch of [-40, 20, -5]) session.offer(good({ pitchDeg: pitch }));
    expect(session.status().pitchBaselineDeg).toBe(fixed);
  });

  test("frames that fail the bar, or are turned, are never baseline samples", () => {
    const session = new EnrollmentSession("iris", createEnrollmentSpec({ shotsPerPose: 1 }));
    session.offer(good({ boxFrac: 0.05, pitchDeg: -30 }));
    session.offer(good({ sharpness: 20, pitchDeg: -30 }));
    session.offer(good({ yawDeg: 25, pitchDeg: -30 }));
    for (let i = 0; i < 5; i += 1) session.offer(good({ pitchDeg: -10 }));
    expect(session.status().pitchBaselineDeg).toBe(-10);
  });

  test("a +11 degree tilt over the measured baseline registers Up; the baseline pose does not", () => {
    const { session } = calibrate();
    const base = session.status().pitchBaselineDeg!;
    expect(session.offer(asSample({ ...WEBCAM_ROWS[7]!, boxFrac: 0.11 })).accepted).toBe(true);
    expect(session.offer(good({ yawDeg: -20, pitchDeg: base })).accepted).toBe(true);
    expect(session.currentTarget()).toBe("up");
    expect(session.offer(good({ yawDeg: 0, pitchDeg: base })).reason).toBe("off_target");
    expect(session.offer(good({ yawDeg: 0, pitchDeg: base + 9 })).reason).toBe("off_target");
    expect(session.offer(good({ yawDeg: 0, pitchDeg: base + 11 }))).toMatchObject({ accepted: true, reason: "ok" });
    expect(session.currentTarget()).toBe("down");
    expect(session.offer(good({ pitchDeg: base - 11 })).accepted).toBe(true);
    expect(session.status().complete).toBe(true);
  });

  test("every real straight-ahead row stays out of Up once the baseline is known", () => {
    const { session } = calibrate();
    const base = session.status().pitchBaselineDeg!;
    for (const row of frontalRows) {
      // Ordinary sitting scatters about 6 degrees around its median; 11 is well clear of it.
      expect(row.pitchDeg - base).toBeLessThan(cfg.updownMinPitch + 5);
    }
    expect(cfg.updownMinPitch).toBe(11);
  });

  test("a different camera height gives a different baseline and the same +11", () => {
    for (const height of [-25, 0, 18]) {
      const session = new EnrollmentSession("iris", createEnrollmentSpec({ shotsPerPose: 1 }));
      for (let i = 0; i < 5; i += 1) session.offer(good({ pitchDeg: height }));
      for (const s of [good({ yawDeg: 20, pitchDeg: height }), good({ yawDeg: -20, pitchDeg: height })]) session.offer(s);
      expect(session.offer(good({ pitchDeg: height + 10 })).accepted).toBe(false);
      expect(session.offer(good({ pitchDeg: height + 12 })).accepted).toBe(true);
    }
  });
});
