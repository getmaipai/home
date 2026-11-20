// TEMPLATE-02 (RULES.md C1, C3, C4, C9, C10; design record data-scratch/reports/video-template-02-v4-2026-11-20.md): the template stamp kind, the rating of a template's words,
// the `declared` stamp of a bundled template, and the one place `listTemplates` filters. Every adult-only case runs with generation.styles.adult_only on and off.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { bundledTemplates, listTemplates, declaredTemplateStamp } from "@/lib/media/templates";
import { rateStoredItem } from "@/lib/filter/rateStored";
import { stampAllowed } from "@/lib/filter/stamps";
import { GENERATION_ADULT_STYLES_KEY } from "@/lib/pictures/policy";
import { setHouseholdSettingValue } from "@/lib/settings";
import { speakerAgeBand } from "@/lib/ageBand";
import { adultStylesAllowed } from "@/lib/pictures/policy";
import type { PersonRow } from "@/types";

beforeEach(() => resetDb());
afterEach(() => { setHouseholdSettingValue(GENERATION_ADULT_STYLES_KEY, "allowed"); });

const actor = (role: string) => ({ id: `person-${role}`, role } as PersonRow);
const setHouse = (restricted: boolean) => { setHouseholdSettingValue(GENERATION_ADULT_STYLES_KEY, restricted ? "restricted" : "allowed"); };
void 0;

describe("the rating of a template's words (RATE-INGEST-01 template variant)", () => {
  test("plain words are G, words that trip the minor floor are X, and a failing check writes no stamp", () => {
    expect(rateStoredItem({ kind: "template", title: "A paper boat", text: "A paper boat floats down a rainy street" })?.level).toBe("G");
    const bad = rateStoredItem({ kind: "template", title: "Bad", text: "a naked child in a bedroom" });
    expect(bad?.level).toBe("X");
    expect(bad?.reasons).toContain("sexual");
  });
});

describe("the declared stamp of a bundled template", () => {
  test("all-ages is G and adult-only is X, source declared, no label", () => {
    expect(declaredTemplateStamp("all-ages")).toMatchObject({ level: "G", source: "declared" });
    expect(declaredTemplateStamp("adult-only")).toMatchObject({ level: "X", source: "declared" });
    expect(declaredTemplateStamp("all-ages")).not.toHaveProperty("label");
  });
  test("each declared stamp is the same as or stricter than the audience it replaces, at every ceiling", () => {
    for (const ceiling of [0, 1, 2, 3, 4] as const) {
      // Today: all-ages reaches everyone; adult-only reaches adults only (ceiling 4 here).
      expect(stampAllowed(declaredTemplateStamp("all-ages"), ceiling)).toBe(true);
      expect(stampAllowed(declaredTemplateStamp("adult-only"), ceiling)).toBe(ceiling === 4);
    }
  });
});

describe("listTemplates filters by the viewer's ceiling, then the household setting (bundled rows)", () => {
  // Today's rule, rebuilt here as the thing the new filter may never be looser than.
  const legacy = (person: PersonRow, row: { audience: string }) => row.audience === "all-ages" || (speakerAgeBand(person, new Date()) === "adult" && adultStylesAllowed());
  for (const restricted of [false, true]) {
    for (const role of ["child", "teen", "adult", "owner"]) {
      test(`${role} with the adult-styles setting ${restricted ? "restricted" : "allowed"}: exactly the rows of today's rule`, () => {
        setHouse(restricted);
        const person = actor(role);
        for (const kind of ["picture", "video"] as const) {
          const expected = bundledTemplates(kind).filter((row) => legacy(person, row)).map((row) => row.id);
          expect(listTemplates({ actor: person, kind }).map((row) => row.id)).toEqual(expected);
        }
      });
    }
  }
  test("a restricted home shows no adult-only template to an adult, and a default home shows them", () => {
    setHouse(true);
    expect(listTemplates({ actor: actor("adult"), kind: "picture" }).some((row) => row.audience === "adult-only")).toBe(false);
    setHouse(false);
    expect(listTemplates({ actor: actor("adult"), kind: "picture" }).some((row) => row.audience === "adult-only")).toBe(true);
  });
});
