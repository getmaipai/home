import { describe, expect, test } from "bun:test";
import { captureFeedbackText } from "@/lib/vision/faceCaptureFeedback";

describe("captureFeedbackText", () => {
  test("maps every assessQuality/offer reason to plain language", () => {
    expect(captureFeedbackText("too_far")).toBe("Move a little closer.");
    expect(captureFeedbackText("blurry")).toContain("blurry");
    expect(captureFeedbackText("too_dark")).toContain("dark");
    expect(captureFeedbackText("too_bright")).toContain("bright");
    expect(captureFeedbackText("no_face")).toContain("face");
  });

  test("falls back to a generic instruction for an unknown reason", () => {
    expect(captureFeedbackText("something_new")).toBe("Hold still.");
  });
});
