import { describe, expect, test } from "bun:test";
import { buildDoor } from "@/lib/filter/door";
import { RATERS, type Rater, type RaterInput, type Surface } from "@/lib/filter/raters";
import type { Audience } from "@/lib/filter/ceiling";
import { CASES } from "./cases";
import type { SuiteCase } from "./adapter";

const MAPPED = new Set(["refusePrompt", "promptViolatesMinorLine", "minorSexualMatch", "refuseVideoPrompt", "refuseMusicPrompt", "contentPolicyFor", "decideAgeCheck", "bandOkAtIngest", "childPromptUnsafe", "teenPromptUnsafe", "evaluateSafety", "codingFloor"]);
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
  return { kind: "text", surface: s, point, text: c.input.text ?? "", field: c.input.field ?? "prompt", lane: c.input.lane ?? c.band };
}
function covered(c: SuiteCase): boolean {
  if (!MAPPED.has(c.input.check)) return false;
  if (c.input.check === "evaluateSafety" && c.surface !== "reply") return false;
  if (c.input.check === "codingFloor" && c.surface !== "coding") return false;
  if (c.input.check === "contentPolicyFor" && c.surface !== "central" && c.surface !== "reply") return false;
  if (c.input.check === "bandOkAtIngest" && c.input.input?.explicit !== true) return false;
  return true;
}

describe("filter suite through the door", () => {
  const cases = CASES.filter(covered);
  for (const c of cases) test(c.id, async () => {
    const door = buildDoor();
    const result = c.point === "release"
      ? await door.release({ surface: surface(c), audience: subject(c), item: requestFor(c) })
      : await door.checkRequest({ surface: surface(c), audience: subject(c), request: requestFor(c) as RaterInput & { kind: "text" } });
    expect(result.verdict).toBe(c.expect);
  });

  test("switching off each rater releases at least one recorded held witness", async () => {
    const witnesses: Record<string, string[]> = {
      "minor-line": ["reply-grooming-child"],
      "lane-prompt": ["picture-child-brand-lane"],
      "explicit-flag": ["library-ingest-explicit"],
      "rules-check": ["central-child-swear"],
    };
    for (const rater of RATERS) {
      const witnessCases = cases.filter((c) => witnesses[rater.id]?.includes(c.id) && c.expect === "held");
      expect(witnessCases.length).toBeGreaterThan(0);
      const disabled = RATERS.map((candidate) => candidate.id === rater.id ? { ...candidate, rate: () => null } : candidate) as Rater[];
      if (rater.id === "rules-check" || rater.id === "explicit-flag") {
        // C4: when no rater can say, the result is Unrated and held below X. rules-check is the last text rater and explicit-flag the only
        // rater for a flag item, so switching either off leaves Unrated: the proof that it was live is the stamp, R with it on, Unrated with it off.
        const c = witnessCases[0]!;
        const door = buildDoor({ raters: disabled });
        const result = c.point === "release"
          ? await door.release({ surface: surface(c), audience: subject(c), item: requestFor(c) })
          : await door.checkRequest({ surface: surface(c), audience: subject(c), request: requestFor(c) as RaterInput & { kind: "text" } });
        expect(result.verdict).toBe("held"); expect(result.rating?.level).toBe("Unrated");
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
