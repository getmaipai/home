// FACE-02: the enrollment flow's per-sample submission loop, pulled out
// of FaceEnrollmentPage.tsx as its own pure function (a code review
// found the previous shape - checking a plain `cancelledRef` boolean
// only between loop iterations - stopped the NEXT sample but not one
// already mid-flight: the person clicks "Cancel enrollment" while a
// POST /api/biometric-prints is in the air, and it completes and saves
// a print anyway, exactly the consent scenario the cancel button exists
// to prevent). A real AbortSignal is threaded through `postOne` all the
// way to fetch() itself (api.ts's request() already passes a caller
// signal through untouched), so cancelling actually aborts the network
// request, not just the JS loop around it. Kept UI-framework-free so the
// abort race is unit-testable without mounting the whole camera/ONNX
// flow (submitEmbeddings.test.ts).
export type SubmitResult = { status: "success" } | { status: "error"; message: string };

/**
 * Sequentially POSTs each embedding via `postOne`, never batched and
 * never parallel (FACE-01's own one-row-per-sample design - a partial
 * failure has to be an honest reflection of exactly which ones actually
 * saved). `onStart` fires right before each attempt (for a "pending" UI
 * state); `onResult` fires only for a sample that actually finished
 * (succeeded or genuinely failed) - a sample aborted mid-flight by
 * `signal` gets neither, so its row is never marked "success", matching
 * what a cancelled consent flow must guarantee.
 */
export async function submitEmbeddings(
  embeddings: readonly number[][],
  signal: AbortSignal,
  postOne: (embedding: number[], signal: AbortSignal) => Promise<void>,
  onStart: (embedding: number[]) => void,
  onResult: (embedding: number[], result: SubmitResult) => void,
): Promise<void> {
  for (const embedding of embeddings) {
    if (signal.aborted) return;
    onStart(embedding);
    try {
      await postOne(embedding, signal);
      if (signal.aborted) return;
      onResult(embedding, { status: "success" });
    } catch (err) {
      // An abort-triggered rejection (postOne's own fetch throwing
      // AbortError once `signal` fires) is a cancel, not a failure -
      // checked here, after the await settles, since that's the only
      // point this function can tell "postOne threw because the request
      // was aborted" apart from "postOne threw for a real reason".
      if (signal.aborted) return;
      const message = err instanceof Error ? err.message : "Could not save that sample.";
      onResult(embedding, { status: "error", message });
    }
  }
}
