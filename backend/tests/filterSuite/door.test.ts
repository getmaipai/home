import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { buildDoor, type Door } from "@/lib/filter/door";
import { __setListsReadyForTests } from "@/lib/blocklists/listStore";
import { RATERS, type Rater, type RaterInput, type Surface } from "@/lib/filter/raters";
import type { Audience } from "@/lib/filter/ceiling";
import { CASES } from "./cases";
import type { SuiteCase } from "./adapter";

const MAPPED = new Set(["refusePrompt", "promptViolatesMinorLine", "minorSexualMatch", "refuseVideoPrompt", "refuseMusicPrompt", "contentPolicyFor", "decideAgeCheck", "bandOkAtIngest", "childPromptUnsafe", "teenPromptUnsafe", "evaluateSafety", "codingFloor", "minorRowAllowed", "floorSearchResult", "pageLabel"]);
// SEARCH-RATING-02: a fetched page cannot be written as a recorded case (its HTML is not in a case), so the page-label witness lives here.
const PAGE_LABEL_CASE: SuiteCase = { id: "search-page-label-teen", surface: "search", point: "release", band: "teen", input: { check: "pageLabel", title: "A page", text: "Herons nest in the reeds.", html: '<meta name="rating" content="adult">' }, expect: "held", from: "tests/filter/searchRating02.test.ts" };
function subject(c: SuiteCase): Audience { return { actor: (c.input.actor ?? { id: `door-suite-${c.band}`, role: c.band }) as never, band: c.band }; }
function surface(c: SuiteCase): Surface {
  if (c.surface === "central") return "news";
  if (c.surface === "spoken") return "reply";
  return c.surface as Surface;
}
function requestFor(c: SuiteCase): RaterInput {
  const point = c.point === "release" ? "release" : "request";
  const s = surface(c);
  if (c.input.check === "decideAgeCheck") return { kind: "picture_check", checks: c.input.checks, adultOnly: c.input.adultOnly, viewer: c.band };
  if (c.input.check === "bandOkAtIngest") return { kind: "explicit", explicit: true };
  if (c.input.check === "minorRowAllowed") return { kind: "search_row", title: c.input.row.title, snippet: c.input.row.snippet ?? null, url: c.input.row.url ?? null, mode: c.input.options?.mode ?? (c.band === "child" ? "strict" : "moderate") };
  if (c.input.check === "pageLabel") return { kind: "page_text", title: c.input.title, text: c.input.text, html: c.input.html ?? null, url: c.input.url ?? null, mode: "moderate" };
  return { kind: "text", surface: s, point, text: c.input.text ?? "", field: c.input.field ?? "prompt", lane: c.input.lane ?? c.band };
}
function covered(c: SuiteCase): boolean {
  if (!MAPPED.has(c.input.check)) return false;
  if (c.input.check === "evaluateSafety" && c.surface !== "reply") return false;
  if (c.input.check === "codingFloor" && c.surface !== "coding") return false;
  if (c.input.check === "contentPolicyFor" && c.surface !== "central" && c.surface !== "reply") return false;
  if (c.input.check === "bandOkAtIngest" && c.input.input?.explicit !== true) return false;
  if ((c.input.check === "minorRowAllowed" || c.input.check === "floorSearchResult") && c.surface !== "search") return false;
  return true;
}
/** The door's answer for one recorded case, whatever its shape: a request, a release, or (a search result's rows) a list the door filters. */
async function outcome(door: Door, c: SuiteCase): Promise<"held" | "released"> {
  if (c.input.check === "floorSearchResult") {
    const rows = c.input.result.rows as Array<{ title: string; snippet?: string | null; url?: string | null }>;
    const kept = await door.filterList({ surface: "search", audience: subject(c), rows, rate: (r) => ({ kind: "search_row", title: r.title, snippet: r.snippet ?? null, url: r.url ?? null, mode: c.band === "child" ? "strict" : "moderate" }) });
    return kept.length === 0 ? "held" : "released";
  }
  const result = c.point === "release" || c.surface === "search"
    ? await door.release({ surface: surface(c), audience: subject(c), item: requestFor(c) })
    : await door.checkRequest({ surface: surface(c), audience: subject(c), request: requestFor(c) as RaterInput & { kind: "text" } });
  return result.verdict;
}

describe("filter suite through the door", () => {
  const cases = [...CASES, PAGE_LABEL_CASE].filter(covered);
  // The search cases rate a row's host too; "every enabled list is loaded" keeps them to the row's own words (no list names these hosts).
  beforeAll(() => __setListsReadyForTests(true));
  afterAll(() => __setListsReadyForTests(null));
  for (const c of cases) test(c.id, async () => {
    const door = buildDoor();
    expect(await outcome(door, c)).toBe(c.expect);
  });

  test("switching off each rater releases at least one recorded held witness", async () => {
    const witnesses: Record<string, string[]> = {
      "minor-line": ["reply-grooming-child"],
      "lane-prompt": ["picture-child-brand-lane"],
      "explicit-flag": ["library-ingest-explicit"],
      "rules-check": ["central-child-swear"],
      "search-row": ["search-policy-sexual-teen"],
      "page-label": ["search-page-label-teen"],
    };
    for (const rater of RATERS) {
      const witnessCases = cases.filter((c) => witnesses[rater.id]?.includes(c.id) && c.expect === "held");
      expect(witnessCases.length).toBeGreaterThan(0);
      const disabled = RATERS.map((candidate) => candidate.id === rater.id ? { ...candidate, rate: () => null } : candidate) as Rater[];
      if (rater.id === "rules-check" || rater.id === "explicit-flag" || rater.id === "search-row" || rater.id === "page-label") {
        // C4: when no rater can say, the result is Unrated and held below X. rules-check is the last text rater and explicit-flag the only
        // rater for a flag item, so switching either off leaves Unrated: the proof that it was live is the stamp, R with it on, Unrated with it off.
        const c = witnessCases[0]!;
        const door = buildDoor({ raters: disabled });
        const result = c.point === "release" || c.surface === "search"
          ? await door.release({ surface: surface(c), audience: subject(c), item: requestFor(c) })
          : await door.checkRequest({ surface: surface(c), audience: subject(c), request: requestFor(c) as RaterInput & { kind: "text" } });
        expect(result.verdict).toBe("held"); expect(result.rating?.level).toBe("Unrated");
        if (rater.id === "search-row" || rater.id === "page-label") {
          // The same witness with the rater on is rated X (the words, or the page's own label), not Unrated.
          const live = await buildDoor().release({ surface: surface(c), audience: subject(c), item: requestFor(c) });
          expect(live.rating?.level).toBe("X");
        }
        continue;
      }
      let released = false;
      for (const c of witnessCases) {
        const door = buildDoor({ raters: disabled });
        const result = c.point === "release"
          ? await door.release({ surface: surface(c), audience: subject(c), item: requestFor(c) })
          : await door.checkRequest({ surface: surface(c), audience: subject(c), request: requestFor(c) as RaterInput & { kind: "text" } });
        if (result.verdict === "released") released = true;
      }
      expect(released, `switching off ${rater.id} should release a witness`).toBe(true);
    }
  });
});
