import { describe, expect, test } from "bun:test";
import { captureFeedbackText, captureRing } from "@/lib/vision/faceCaptureFeedback";

describe("captureFeedbackText", () => {
  test("maps every assessQuality/offer reason to plain language", () => {
    expect(captureFeedbackText("too_far")).toBe("Move a little closer.");
    expect(captureFeedbackText("blurry")).toContain("soft");
    expect(captureFeedbackText("too_dark")).toContain("dark");
    expect(captureFeedbackText("too_bright")).toContain("bright");
    expect(captureFeedbackText("no_face")).toContain("face");
  });

  test("falls back to a generic instruction for an unknown reason", () => {
    expect(captureFeedbackText("something_new")).toBe("Hold still.");
  });
});

// FACE-02J: the ring is green only for a frame the session accepted
// (offer()'s own "ok"), yellow for a face that was seen but not accepted,
// and neutral when there is no face to judge.
describe("captureRing", () => {
  test("only an accepted frame is green", () => {
    expect(captureRing("ok")).toBe("green");
  });

  test.each(["too_far", "blurry", "too_dark", "too_bright", "between_angles", "off_target", "bucket_full"])(
    "a seen face that was not accepted (%s) is yellow",
    (reason) => {
      expect(captureRing(reason)).toBe("yellow");
    },
  );

  test("no face is neither green nor yellow", () => {
    expect(captureRing("no_face")).toBe("none");
  });

  test("every reason that reads as trouble has its own words", () => {
    for (const reason of ["too_far", "blurry", "too_dark", "too_bright"]) {
      expect(captureFeedbackText(reason)).not.toBe("Hold still.");
    }
  });
});
