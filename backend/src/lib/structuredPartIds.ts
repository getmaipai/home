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
  // KS-02B: the `define` package is retired (a word question is now
  // `websearch` with `scope: "reference"`), but old stored messages carry
  // a `define` spec-sheet part and the frontend binding still draws it.
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
