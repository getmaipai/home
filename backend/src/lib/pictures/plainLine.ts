import { makingRefusalLine, type MakingCause, type MakingKind } from "@/lib/failureCopy";

const MEMORY_LINE = "This computer is busy freeing up memory, so picture and video making is paused for a moment. Try again in a minute.";

/**
 * A sentence from the engine that a person is about to read. The engine's own wording about memory can carry figures (gigabytes available,
 * reserve); a person never reads those, so a line that talks about memory in figures is replaced by one plain sentence.
 */
export function plainEngineLine(message: string): string {
  return /\b\d+(\.\d+)?\s?(GB|MB|gigabytes?|megabytes?)\b/i.test(message) && /memory|reserve|available/i.test(message) ? MEMORY_LINE : message;
}

/** ENGINE-STATUS-MEDIA-01: a Stack refusal that is a state Home knows in advance (low memory, a restart, coding mode), read from
 * the Stack's own code, never from its wording; null for any other refusal. */
export function makingStateOf(code: string | null | undefined): MakingCause | null {
  if (code === "no_memory" || code === "out_of_memory") return "memory";
  if (code === "stack_restarting") return "restarting";
  if (code === "coding_mode") return "mode_change";
  return null;
}

/** The line a person reads for a failed picture or clip call: the household wording for a known state (failureCopy.ts), else the
 * engine's sentence with any memory figures taken out. */
export function plainMakingLine(kind: MakingKind, code: string | null | undefined, message: string): string {
  const state = makingStateOf(code);
  return state ? makingRefusalLine(kind, state) : plainEngineLine(message);
}
