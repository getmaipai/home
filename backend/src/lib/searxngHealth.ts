// A periodic canary check for the household's own SearXNG instance
// (Jesse, 2026-09-07): "we need to be able to detect if search is down,
// outdated, or simply not returning results - or if the URL is invalid -
// and notify on all of those." Modeled directly on householdCa.ts's own
// checkLeafExpiry() - the identical "not this household's concern until
// it's configured, then a periodic raiseIssue/resolveIssue pair" shape.
//
// The three failure modes this distinguishes map to three separate
// Repairs issues, not one, because they need different fixes: a bad/
// unreachable URL is a settings mistake; a real HTTP response that isn't
// JSON usually means the URL is fine but pointed somewhere unexpected
// (an SSO login page, most often - the exact bug found live 2026-09-06);
// a healthy JSON response with zero results for an almost-impossible-to-
// miss canary query means the instance itself is likely too old for its
// scraping-based engines to still work (found live 2026-09-06/07: an
// 18-month-stale SearXNG install returned zero results for "python
// programming language," only a bare Wikipedia title match still worked)
// or its engines are all blocked.
import { searxngSearch, SEARXNG_NO_RESULTS_TEXT } from "@/lib/packageHost";
import { getHouseholdSettingValue } from "@/lib/settings";
import { recordSearchHealth } from "@/lib/searchHealthState";

// "Earth" rather than something topical/timely: a canary query only
// works if it's as close to guaranteed-to-return-something as a query
// can be, on literally any search engine, indefinitely - a topical query
// ages into a false positive the moment it stops being current.
const CANARY_QUERY = "Earth";

// SEARCH-HEALTH-01: raising/resolving the two Repairs rows themselves
// now lives in `searchHealthState.ts`'s `recordSearchHealth()`, shared
// with `packageHost.ts`'s own real-traffic detection (searxngSearch()
// already calls it on every real call - see its own header comment).
// This canary's own judgment stays here, and stays stricter than a real
// household query's: a genuinely empty result for an almost-impossible-
// to-miss canary ("Earth") is itself suspicious even with no reported
// `unresponsive_engines` at all (the stale-install case this file's own
// header names), where a real query returning nothing is ordinary and
// never raises anything (SEARCH-EMPTY-01's own distinction, kept).
export async function checkSearxngHealth(): Promise<void> {
  const url = getHouseholdSettingValue("search.searxng_url") as string | undefined;
  // Not configured is not a fault - web search is opt-in, and every
  // other household setting this optional gets the identical "nothing to
  // check until it's set" pass (requireSearxngSettings() itself already
  // treats an empty url as "isn't set up yet," not an error).
  if (!url) return;

  let result: unknown;
  try {
    result = (await searxngSearch({ query: CANARY_QUERY })).text;
  } catch {
    // searxngSearch() itself already recorded this exact outcome for
    // every error it can throw - search_unavailable as "degraded",
    // rate_limited excluded entirely (a self-imposed throttle, never a
    // health signal), anything else as "down" - so this canary has
    // nothing more to add on a thrown error (a review, 2026-09-24,
    // caught an earlier cut of this catch redundantly recording "down"
    // a second time for the "anything else" case, doing a second
    // needless raiseIssue/DB write every 15 minutes while down).
    return;
  }

  if (result === SEARXNG_NO_RESULTS_TEXT) {
    await recordSearchHealth({
      kind: "degraded",
      detail: `A test search for "${CANARY_QUERY}" returned no results, which almost never happens on a healthy instance. This usually means SearXNG itself is out of date (its scraping-based engines' parsers no longer match the real sites) or its configured search engines are all blocked - update SearXNG to the latest version and check which engines are enabled.`,
    });
    return;
  }
  await recordSearchHealth({ kind: "ok" });
}
