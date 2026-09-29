import { describe, expect, test } from "bun:test";
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
    const session = new EnrollmentSession("iris", createEnrollmentSpec({ shotsPerPose: 1 }));
    const samples = [good(), good({ yawDeg: 20 }), good({ yawDeg: -20 }), good({ pitchDeg: 16 }), good({ pitchDeg: -16 })];
    for (const [index, sample] of samples.entries()) {
      const result = session.offer(sample);
      expect(result.accepted).toBe(true);
      expect(result.complete).toBe(index === 4);
    }
    expect(session.status().coveragePct).toBe(100);
  });

  test("rejected quality and in-between frames do not change coverage", () => {
    const session = new EnrollmentSession("iris", createEnrollmentSpec({ shotsPerPose: 1 }));
    expect(session.offer(good({ sharpness: 10 })).reason).toBe("blurry");
    expect(session.offer(good({ yawDeg: 15 })).reason).toBe("between_angles");
    expect(session.status().shots).toBe(0);
    expect(session.status().coveragePct).toBe(0);
  });

  test("a pose already captured is rejected as off target without changing its count", () => {
    const session = new EnrollmentSession("iris", createEnrollmentSpec({ shotsPerPose: 1 }));
    session.offer(good());
    expect(session.offer(good()).reason).toBe("off_target");
    expect(session.status().buckets[0]?.count).toBe(1);
    expect(session.status().shots).toBe(1);
  });

  test("FACE-02I: a frame that swings past another pose while moving is not banked there", () => {
    const session = new EnrollmentSession("iris", createEnrollmentSpec({ shotsPerPose: 1 }));
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
    const session = new EnrollmentSession("iris", createEnrollmentSpec({ shotsPerPose: 1 }));
    expect(session.offer(good({ yawDeg: 20 })).reason).toBe("off_target");
    expect(session.status().coveragePct).toBe(0);
  });

  test("currentTarget walks the poses in order and ends at null", () => {
    const session = new EnrollmentSession("iris", createEnrollmentSpec({ shotsPerPose: 1 }));
    const seen: Array<string | null> = [];
    for (const s of [good(), good({ yawDeg: 20 }), good({ yawDeg: -20 }), good({ pitchDeg: 16 }), good({ pitchDeg: -16 })]) {
      seen.push(session.currentTarget());
      session.offer(s);
    }
    seen.push(session.currentTarget());
    expect(seen).toEqual(["frontal", "left", "right", "up", "down", null]);
  });

  test("status lists the remaining prompts in order", () => {
    const session = new EnrollmentSession("iris", createEnrollmentSpec({ shotsPerPose: 1 }));
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
    const session = new EnrollmentSession("iris", createEnrollmentSpec({ shotsPerPose: 1 }));
    session.offer(good({ sharpness: cfg.minSharpness, boxFrac: cfg.minBoxFrac }));
    expect(Object.keys(session.status())).not.toContain("retake");
    expect(Object.keys(session.status().buckets[0]!)).not.toContain("retake");
  });

  test("FACE-02J: a soft frame is rejected as blurry and never counts toward the pose", () => {
    const session = new EnrollmentSession("iris", createEnrollmentSpec({ shotsPerPose: 1 }));
    const result = session.offer(good({ sharpness: 30 }));
    expect(result).toMatchObject({ accepted: false, reason: "blurry" });
    expect(session.status().buckets[0]).toMatchObject({ count: 0 });
    expect(session.embeddings()).toEqual([]);
    expect(session.currentTarget()).toBe("frontal");
    expect(session.offer(good({ sharpness: 120 })).accepted).toBe(true);
    expect(session.status().buckets[0]).toMatchObject({ count: 1, avgSharpness: 120, minSharpness: 120 });
  });

  test("FACE-02J: a far frame is rejected as too far", () => {
    const session = new EnrollmentSession("iris", createEnrollmentSpec({ shotsPerPose: 1 }));
    expect(session.offer(good({ boxFrac: 0.09 }))).toMatchObject({ accepted: false, reason: "too_far" });
  });

  test("FACE-02J: nothing below the bar is ever accepted, across a sweep of sharpness, size and brightness", () => {
    let accepted = 0;
    let rejected = 0;
    for (let sharpness = 0; sharpness <= 200; sharpness += 5) {
      for (let box = 0; box <= 0.3001; box += 0.01) {
        for (const brightness of [0, 39, 40, 128, 220, 221, 255]) {
          const session = new EnrollmentSession("iris", createEnrollmentSpec({ shotsPerPose: 1 }));
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
    const session = new EnrollmentSession("iris", createEnrollmentSpec({ shotsPerPose: 2 }));
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
