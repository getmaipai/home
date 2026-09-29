// FACE-02: maps a rejected getUserMedia() call to one of the three
// error states a caller needs to show ("no permission", "no device", or
// "something else"). Pulled out as its own pure function (a code review
// on this item, 2026-09-29) rather than left inline, since two other
// call sites (useWakeWord.ts, sttDictationAdapter.ts) already do their
// own narrower version of this same DOMException-name check for their
// own purposes - a future getUserMedia caller has one place to reach
// for the general three-way classification instead of writing a fourth
// copy. Those two existing call sites check a single name each for a
// specific narrow decision (mic permission; falling back off a stale
// device id) and were left as they are rather than migrated onto this
// as part of this item - a real follow-up, not a silent gap.
export type MediaAccessErrorState = "denied" | "unavailable" | "error";

export function classifyMediaAccessError(err: unknown): MediaAccessErrorState {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") return "unavailable";
  return "error";
}
