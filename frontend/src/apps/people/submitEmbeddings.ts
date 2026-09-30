// FACE-02: the enrollment flow's submit step, pulled out of
// FaceEnrollmentPage.tsx as its own pure function so the cancel race is
// unit-testable without mounting the camera/ONNX flow
// (submitEmbeddings.test.ts). A code review found the original per-sample
// loop, checking a plain `cancelledRef` boolean only between iterations,
// stopped the NEXT sample but not one already mid-flight: the person
// clicks "Cancel enrollment" while a POST is in the air, and it completes
// and saves a print anyway, exactly the consent scenario the cancel
// button exists to prevent. A real AbortSignal is threaded through
// `postAll` to fetch() itself, so cancelling aborts the network request.
//
// FACE-02Q (#201): the whole set now goes in ONE request to the hub's
// enrollments route, which saves it and replaces the person's previous
// face set in a single transaction. That makes the outcome all or
// nothing: one success for every sample, or one error meaning nothing was
// saved (and the old set is untouched). A retry resends the whole set.
export type SubmitResult = { status: "success" } | { status: "error"; message: string };

/**
 * Sends every embedding through `postAll` as one call. `onStart` fires
 * right before the attempt (for a "pending" UI state); `onResult` fires
 * only once the call actually finished (succeeded or genuinely failed) -
 * a call aborted mid-flight by `signal` gets neither, so the rows are
 * never marked "success", matching what a cancelled consent flow must
 * guarantee.
 */
export async function submitEnrollment(
  embeddings: readonly number[][],
  signal: AbortSignal,
  postAll: (embeddings: readonly number[][], signal: AbortSignal) => Promise<void>,
  onStart: (embeddings: readonly number[][]) => void,
  onResult: (result: SubmitResult) => void,
): Promise<void> {
  if (embeddings.length === 0 || signal.aborted) return;
  onStart(embeddings);
  try {
    await postAll(embeddings, signal);
    if (signal.aborted) return;
    onResult({ status: "success" });
  } catch (err) {
    // An abort-triggered rejection is a cancel, not a failure - checked
    // after the await settles, the only point this function can tell
    // "threw because the request was aborted" from "threw for a real reason".
    if (signal.aborted) return;
    onResult({ status: "error", message: err instanceof Error ? err.message : "Could not save the enrollment." });
  }
}
