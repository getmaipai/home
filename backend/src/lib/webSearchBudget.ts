/** SEARCH-BUDGET-01: one deadline contract for the web-search attempt,
 * its Wikipedia fallback, and the adult-written tool call. */
export const SEARXNG_CONNECT_LIMIT_MS = 3_000;
export const SEARXNG_ATTEMPT_LIMIT_MS = 5_000;
export const ADULT_WRITTEN_WEBSEARCH_DEADLINE_MS = 15_000;

export function webSearchToolDeadlineMs(band: string | undefined, surfaceClass: string | undefined, existingDeadlineMs: number): number {
  return band === "adult" && surfaceClass === "written" ? ADULT_WRITTEN_WEBSEARCH_DEADLINE_MS : existingDeadlineMs;
}
