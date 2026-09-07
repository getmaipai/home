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
import { raiseIssue, resolveIssue } from "@/lib/issues";

const ISSUE_SOURCE = "websearch";

// "Earth" rather than something topical/timely: a canary query only
// works if it's as close to guaranteed-to-return-something as a query
// can be, on literally any search engine, indefinitely - a topical query
// ages into a false positive the moment it stops being current.
const CANARY_QUERY = "Earth";

export async function checkSearxngHealth(): Promise<void> {
  const url = getHouseholdSettingValue("search.searxng_url") as string | undefined;
  // Not configured is not a fault - web search is opt-in, and every
  // other household setting this optional gets the identical "nothing to
  // check until it's set" pass (requireSearxngSettings() itself already
  // treats an empty url as "isn't set up yet," not an error).
  if (!url) return;

  let result: unknown;
  try {
    result = await searxngSearch({ query: CANARY_QUERY });
  } catch (err) {
    resolveIssue(ISSUE_SOURCE, "searxng_empty");
    await raiseIssue({
      source: ISSUE_SOURCE,
      key: "searxng_unreachable",
      severity: "error",
      title: "Web search can't reach your SearXNG instance",
      detail: `${(err as Error).message} Check the SearXNG URL in Settings -> AI & connections -> Integrations.`,
    });
    return;
  }
  resolveIssue(ISSUE_SOURCE, "searxng_unreachable");

  if (result === SEARXNG_NO_RESULTS_TEXT) {
    await raiseIssue({
      source: ISSUE_SOURCE,
      key: "searxng_empty",
      severity: "warning",
      title: "Web search isn't finding anything",
      detail: `A test search for "${CANARY_QUERY}" returned no results, which almost never happens on a healthy instance. This usually means SearXNG itself is out of date (its scraping-based engines' parsers no longer match the real sites) or its configured search engines are all blocked - update SearXNG to the latest version and check which engines are enabled.`,
    });
    return;
  }
  resolveIssue(ISSUE_SOURCE, "searxng_empty");
}
