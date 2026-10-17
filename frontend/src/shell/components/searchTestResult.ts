/** The plain-words result of testing one SearXNG address (backend `searchTestSummary.ts`). One definition for the setup
 * Web search screen and the Web search settings: both render these fields, so they never say different things. */
export interface SearchTestResultData {
  level: "pass" | "warn" | "fail";
  address: string;
  headline: string;
  verdict: string;
  recommendation: string;
  canUse: boolean;
  trouble: { label: string; important: boolean }[];
  details: { id: string; title: string; state: "pass" | "warn" | "fail" | "unknown"; detail: string; fix: string | null }[];
}

/** The kit Alert variant for a result level (colors come from tokens). */
export const SEARCH_RESULT_VARIANT = { pass: "default", warn: "warning", fail: "destructive" } as const;
/** The icon name for a result level. */
export const SEARCH_RESULT_ICON = { pass: "circle-check", warn: "alert-triangle", fail: "circle-alert" } as const;
export const SEARCH_ROW_STATE_WORD = { pass: "Passed", warn: "Warning", fail: "Failed", unknown: "Not checked" } as const;
