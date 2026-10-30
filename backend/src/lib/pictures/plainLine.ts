const MEMORY_LINE = "This computer is busy freeing up memory, so picture and video making is paused for a moment. Try again in a minute.";

/**
 * A sentence from the engine that a person is about to read. The engine's own wording about memory can carry figures (gigabytes available,
 * reserve); a person never reads those, so a line that talks about memory in figures is replaced by one plain sentence.
 */
export function plainEngineLine(message: string): string {
  return /\b\d+(\.\d+)?\s?(GB|MB|gigabytes?|megabytes?)\b/i.test(message) && /memory|reserve|available/i.test(message) ? MEMORY_LINE : message;
}
