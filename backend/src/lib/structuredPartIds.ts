/** Spec-sheet producers ready for the frontend binding slice. */
export const SPEC_SHEET_READY = new Set([
  "almanac-time",
  "almanac-moon",
  "almanac-holiday",
  "almanac-onthisday",
  "media-lookup",
  "music",
  "currency",
  "convert",
  "define",
  "math",
] as const);

/** Spec-sheet tool ids with matching frontend bindings. The frontend imports
 * this list to keep its renderer registry in sync. */
export const SPEC_SHEET_BOUND = new Set([
  "weather",
  "almanac-date",
  ...SPEC_SHEET_READY,
]);
