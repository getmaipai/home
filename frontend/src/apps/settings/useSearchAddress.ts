// AUDIT-DUP-FE-01: the SearXNG address test-and-save state machine that Settings > Web search and the setup screen both used to write out:
// the typed text, what is busy, the latest Test result and the exact text it tested, the error line, and the "tested text still matches" rules.
import { useState } from "react";
import type { SearchTestResultData } from "@/shell/components/searchTestResult";
import { ApiError } from "@/lib/api";

/** The failure as one sentence: what went wrong, then the next step. */
export function webSearchFailure(reason: unknown): string {
  if (reason instanceof ApiError) return [reason.message.replace(/\s+$/, ""), reason.next].filter(Boolean).join(" ");
  return "Home couldn't reach that address. Check it and that the search service is running, then press Test.";
}

export type SearchTest = (url: string) => Promise<{ saved: boolean; result?: SearchTestResultData }>;

/** `fallback` is what the field shows until the person types (the saved address, or a candidate found on this computer). `B` adds the caller's own busy kinds. */
export function useSearchAddress<B extends string = never>(fallback: string, test: SearchTest) {
  const [typed, setTyped] = useState<string | null>(null);
  const [busy, setBusy] = useState<"test" | B | null>(null);
  const [result, setResult] = useState<SearchTestResultData | null>(null);
  const [testedText, setTestedText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const text = typed ?? fallback;
  const trimmed = text.trim();
  const empty = trimmed === "";
  // Passed means the latest Test, of exactly this text, was usable (works or works with warnings).
  const passed = !empty && result?.canUse === true && testedText === trimmed;
  const changedAfterTest = !empty && result !== null && testedText !== trimmed;

  async function runTest(): Promise<void> {
    if (empty) return;
    setBusy("test"); setError(null); setResult(null);
    try { setResult((await test(trimmed)).result ?? null); setTestedText(trimmed); }
    catch (reason) { setError(webSearchFailure(reason)); }
    finally { setBusy(null); }
  }
  return {
    text, trimmed, empty, busy, setBusy, result, error, setError, passed, changedAfterTest,
    /** The person typed: keep it, and drop the old error line. */
    type: (value: string) => { setTyped(value); setError(null); },
    /** Back to the fallback text (the saved address changed under us). */
    resetTyped: () => setTyped(null),
    /** A saved address makes the earlier Test moot. */
    forgetTest: () => { setResult(null); setTestedText(null); },
    runTest,
  };
}
