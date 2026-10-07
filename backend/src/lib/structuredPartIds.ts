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

/** The only spec-sheet tool ids currently rendered by Home. ELT-T1-19 moves
 * READY ids here together with the matching frontend bindings. */
export const SPEC_SHEET_BOUND = new Set(["weather", "almanac-date"] as const);
