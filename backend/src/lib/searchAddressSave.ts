// One place that tests and saves the household's SearXNG address. The setup Web search screen
// (routes/setup.ts, guarded: no people yet) and Settings > Home > Search (routes/search.ts, owner or admin) both
// call it, so the allowed-host rules, the checker and the plain-words result are one definition.
import { parseSearchAddress } from "@/lib/setupSearchAddress";
import { checkSearchInstance } from "@/lib/searchInstanceCheck";
import { summarizeSearchStatus, type SearchTestSummary } from "@/lib/searchTestSummary";
import { setHouseholdSettingValue } from "@/lib/settings";

export const SEARXNG_URL_KEY = "search.searxng_url";

// The checker paces repeat probes of one address, so Test then Save would fail the second check. A pass from Test
// stands for the same address for a few minutes; Save then skips the second probe.
let searchTestPassed: { url: string; at: number } | null = null;
const SEARCH_TEST_VALID_MS = 5 * 60_000;
export function __resetSearchTestPassedForTests(): void { searchTestPassed = null; }

export type SearchAddressOutcome =
  | { kind: "refused"; error: string; next?: string }
  | { kind: "tested"; result: SearchTestSummary }
  | { kind: "saved" };

/** Test (dryRun) or save one SearXNG address. A Save of an address whose latest check failed is refused. */
export async function testOrSaveSearchAddress(raw: string, dryRun: boolean): Promise<SearchAddressOutcome> {
  const parsed = parseSearchAddress(raw);
  if (!parsed.ok) return { kind: "refused", error: parsed.error };
  const address = parsed.url.toString().replace(/\/$/, "");
  const alreadyPassed = !dryRun && searchTestPassed?.url === address && Date.now() - searchTestPassed.at < SEARCH_TEST_VALID_MS;
  if (!alreadyPassed) {
    const status = await checkSearchInstance({ candidateBaseUrl: address });
    const result = summarizeSearchStatus(status, address);
    if (!result.canUse) {
      searchTestPassed = null;
      // A Test that ran always answers with the result, so the screen can show it; a Save is refused.
      if (dryRun) return { kind: "tested", result };
      return { kind: "refused", error: `${result.headline} ${result.verdict}`, next: result.recommendation };
    }
    if (dryRun) { searchTestPassed = { url: address, at: Date.now() }; return { kind: "tested", result }; }
  }
  searchTestPassed = null;
  const saved = setHouseholdSettingValue(SEARXNG_URL_KEY, address);
  return saved.ok ? { kind: "saved" } : { kind: "refused", error: saved.error };
}

/** Remove the household's SearXNG address (Settings only). */
export function clearSearchAddress(): { ok: true } | { ok: false; error: string } {
  searchTestPassed = null;
  const cleared = setHouseholdSettingValue(SEARXNG_URL_KEY, "");
  return cleared.ok ? { ok: true } : { ok: false, error: cleared.error };
}
