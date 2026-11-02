/** SEARCH-BUDGET-01: one deadline contract for the web-search attempt,
 * its Wikipedia fallback, and the adult-written tool call. */
export const SEARXNG_CONNECT_LIMIT_MS = 3_000;
export const SEARXNG_ATTEMPT_LIMIT_MS = 5_000;
export const ADULT_WRITTEN_WEBSEARCH_DEADLINE_MS = 15_000;

let toolDeadlineOverrideMs: number | undefined;
/** Tests: the tool node's deadline for a round that searches the web (milliseconds); undefined restores it. */
export function __setWebSearchToolDeadlineForTests(ms: number | undefined): void { toolDeadlineOverrideMs = ms; }

export function webSearchToolDeadlineMs(band: string | undefined, surfaceClass: string | undefined, existingDeadlineMs: number): number {
  if (toolDeadlineOverrideMs !== undefined) return toolDeadlineOverrideMs;
  return band === "adult" && surfaceClass === "written" ? ADULT_WRITTEN_WEBSEARCH_DEADLINE_MS : existingDeadlineMs;
}
