import { describe, expect, test } from "bun:test";
import { CONTENT_CEILINGS, getCeilingForBand, hasUnrestrictedGrant } from "@/lib/contentCeiling";
import { ContentCeiling } from "@maipai/spec/gen/ts/content-ceiling.js";

describe("CONTENT_CEILINGS", () => {
  test("all three bands are real, schema-valid records", () => {
    for (const band of ["child", "teen", "adult"] as const) {
      expect(() => ContentCeiling.parse(CONTENT_CEILINGS[band])).not.toThrow();
      expect(CONTENT_CEILINGS[band].band).toBe(band);
    }
  });

  test("the floor is byte-identical across every band - it documents an invariant, not a per-band setting", () => {
    expect(CONTENT_CEILINGS.child.floor).toEqual(CONTENT_CEILINGS.teen.floor);
    expect(CONTENT_CEILINGS.teen.floor).toEqual(CONTENT_CEILINGS.adult.floor);
    expect(CONTENT_CEILINGS.adult.floor.length).toBeGreaterThan(0);
  });

  test("self_harm is never in the floor - it's allow_with_resources, never refuse, and never gated by a ceiling either", () => {
    for (const band of ["child", "teen", "adult"] as const) {
      expect(CONTENT_CEILINGS[band].floor).not.toContain("self_harm");
    }
  });

  test("child is the most restrictive band - every dial is 'off'", () => {
    for (const key of Object.keys(CONTENT_CEILINGS.child.dials) as (keyof ContentCeiling["dials"])[]) {
      expect(CONTENT_CEILINGS.child.dials[key]).toBe("off");
    }
  });

  test("getCeilingForBand() returns the matching record", () => {
    expect(getCeilingForBand("child")).toBe(CONTENT_CEILINGS.child);
    expect(getCeilingForBand("adult")).toBe(CONTENT_CEILINGS.adult);
  });

  // A code review (2026-09-06) found `Readonly<...>` alone is a
  // compile-time-only guarantee - real enforcement needs Object.freeze(),
  // which this proves actually throws (strict mode, every module here),
  // not just that TypeScript's own type checker would complain at a
  // call site that happened to be checked.
  test("mutating a band's dials, floor, or the top-level record throws - real, not just compile-time, enforcement", () => {
    expect(() => {
      (CONTENT_CEILINGS.child.dials as { sexual: string }).sexual = "unrestricted";
    }).toThrow();
    expect(() => {
      (CONTENT_CEILINGS.adult.floor as unknown as string[]).push("self_harm");
    }).toThrow();
    expect(() => {
      (CONTENT_CEILINGS as Record<string, unknown>).child = CONTENT_CEILINGS.adult;
    }).toThrow();
    // And the attempted mutation above genuinely didn't happen, not just
    // that the assignment statement itself threw.
    expect(CONTENT_CEILINGS.child.dials.sexual).toBe("off");
    expect(CONTENT_CEILINGS.adult.floor).not.toContain("self_harm");
  });
});

describe("hasUnrestrictedGrant()", () => {
  test("always false today - a real, deferred gap until session-f-platform-and-trust.md step 7 ships a real grants table", () => {
    expect(hasUnrestrictedGrant("person-anyone")).toBe(false);
  });
});
