// FACE-02: plain-language text for the guided capture flow's live
// feedback line, mapping assessQuality()'s own `reason` field (plus two
// reasons only the capture loop itself can produce - "no_face" when
// detection finds nothing, and OfferResult's own "between_angles"/
// "off_target"/"bucket_full") to dad-test-simple copy (docs/STYLE.md), never the
// bare enum values.
const REASON_TEXT: Record<string, string> = {
  ok: "Got it.",
  too_far: "Move a little closer.",
  blurry: "That's a bit soft. Hold still.",
  too_dark: "It's too dark here. Try more light.",
  too_bright: "That's too bright. Try softer light.",
  between_angles: "Turn a little more, or look straight ahead.",
  off_target: "Not that way yet. Follow the step above.",
  bucket_full: "Got that one, hold on.",
  no_pose: "Hold still for a moment.",
  calibrating: "Look straight at the screen and hold still.",
  no_face: "We can't see your face. Move into the frame.",
};

// The step's own words for "not that way yet": the person is being asked
// to tilt, so say which way, in plain words (FACE-02K).
const OFF_TARGET_TEXT: Record<string, string> = {
  up: "Tilt your chin up a little, like looking at the ceiling.",
  down: "Tilt your chin down a little, like looking at your keyboard.",
};

export function captureFeedbackText(reason: string, target?: string | null): string {
  if (reason === "off_target" && target && OFF_TARGET_TEXT[target]) return OFF_TARGET_TEXT[target]!;
  return REASON_TEXT[reason] ?? "Hold still.";
}

export type CaptureRing = "green" | "yellow" | "none";

/** FACE-02J: the capture ring for the last judged frame. One definition:
 * green is exactly what EnrollmentSession.offer() accepted (its "ok"),
 * yellow is a face that was seen but not accepted (the reason says why),
 * and "none" is no face to judge. The color is never the only signal:
 * the page shows captureFeedbackText(reason) with an icon beside it. */
export function captureRing(reason: string): CaptureRing {
  if (reason === "ok") return "green";
  if (reason === "no_face") return "none";
  return "yellow";
}
