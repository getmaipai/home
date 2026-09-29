// FACE-02: plain-language text for the guided capture flow's live
// feedback line, mapping assessQuality()'s own `reason` field (plus two
// reasons only the capture loop itself can produce - "no_face" when
// detection finds nothing, and OfferResult's own "between_angles"/
// "off_target"/"bucket_full") to dad-test-simple copy (docs/STYLE.md), never the
// bare enum values.
const REASON_TEXT: Record<string, string> = {
  ok: "Looking good, hold still.",
  too_far: "Move a little closer.",
  blurry: "Hold still, that looks blurry.",
  too_dark: "It's too dark here. Try more light.",
  too_bright: "That's too bright. Try softer light.",
  between_angles: "Turn a little more, or look straight ahead.",
  off_target: "Not that way yet. Follow the step above.",
  bucket_full: "Got that one, hold on.",
  no_face: "We can't see your face. Move into the frame.",
};

export function captureFeedbackText(reason: string): string {
  return REASON_TEXT[reason] ?? "Hold still.";
}
