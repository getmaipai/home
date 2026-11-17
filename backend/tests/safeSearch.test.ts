import { describe, expect, test } from "bun:test";
import { decide } from "@/lib/gate/decide";
import { surfaceActor } from "@/lib/filter/textGate";
import type { AgeBand } from "@/lib/ageBand";
import { applySafeSearchLimits, resolveSafeSearchLevel, safeSearchDefaultFor } from "@/lib/safeSearch";

// SEARCH-RATING-03: resolveSafeSearchLevel takes the viewer as an Audience (the role-default audience of a band) where it took a bare band.
const audienceOf = (band: AgeBand) => ({ actor: surfaceActor(band), band });
const BAND_DEFAULT_LIMIT = "safe_search:at_least_band_default";

describe("GATE-03 safe-search limits", () => {
  for (const band of ["child", "teen", "adult"] as const) {
    test(`${band}: the capability decision declares the floor and applies it to the person's value`, () => {
      const decision = decide({
        who: { personId: `safe-search-${band}`, role: band, band },
        what: { capabilities: ["search.safe_search"] },
        context: { provenance: "person" },
      });
      expect(decision.kind).toBe("allow_with_limits");
      expect(decision.kind === "allow_with_limits" ? decision.limits : []).toContain(BAND_DEFAULT_LIMIT);
      expect(resolveSafeSearchLevel("off", audienceOf(band))).toBe(safeSearchDefaultFor(band));
      expect(applySafeSearchLimits("off", band, [BAND_DEFAULT_LIMIT])).toBe(safeSearchDefaultFor(band));
    });
  }

  test("a child's and teen's more restrictive stored value remains in effect", () => {
    expect(resolveSafeSearchLevel("strict", audienceOf("child"))).toBe("strict");
    expect(resolveSafeSearchLevel("moderate", audienceOf("child"))).toBe("strict");
    expect(resolveSafeSearchLevel("strict", audienceOf("teen"))).toBe("strict");
  });

  test("adult per-person safe-search choices retain their existing behavior", () => {
    expect(resolveSafeSearchLevel("off", audienceOf("adult"))).toBe("off");
    expect(resolveSafeSearchLevel("moderate", audienceOf("adult"))).toBe("moderate");
    expect(resolveSafeSearchLevel("strict", audienceOf("adult"))).toBe("strict");
  });
});
