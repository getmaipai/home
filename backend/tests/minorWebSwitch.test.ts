// MINOR-SEARCH-01c: the household's per-band web switches, the child-temporary rule, the refusal copy that
// says the fix, and a guard on the policy node's ask_parent -> parent_required branch.
import { beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { decide } from "@/lib/gate/decide";
import { getHouseholdSettingValue, setHouseholdSettingValue } from "@/lib/settings";
import { CHILD_TEMPORARY_WEB_OFF_NOTE, CHILD_WEB_OFF_NOTE, TEEN_WEB_OFF_NOTE, WEB_OFF_NOTE, effectiveMode, refuseWeb, webSideOff } from "@/lib/retrieval/sourceMode";
import { federatedLookup } from "@/lib/retrieval/lookup";
import { listInstalledManifests } from "@/lib/plugins";

beforeEach(() => resetDb());

describe("MINOR-SEARCH-01c web switches by band", () => {
  test("both switches default to on and the web side is live for every band", () => {
    expect(getHouseholdSettingValue("search.web.child_mode")).toBe("on");
    expect(getHouseholdSettingValue("search.web.teen_mode")).toBe("on");
    for (const band of ["child", "teen", "adult"] as const) expect(webSideOff(band)).toBe(false);
  });

  test("child_mode off turns the web side off for a child only, with copy that says the fix", () => {
    expect(setHouseholdSettingValue("search.web.child_mode", "off").ok).toBe(true);
    expect(effectiveMode("web", "child")).toBe("offline");
    expect(effectiveMode("web", "teen")).not.toBe("offline");
    expect(effectiveMode("web", "adult")).not.toBe("offline");
    const text = refuseWeb("child");
    expect(text).toBe(CHILD_WEB_OFF_NOTE);
    expect(text).toContain("Settings, Search");
  });

  test("teen_mode off turns the web side off for a teen only", () => {
    expect(setHouseholdSettingValue("search.web.teen_mode", "off").ok).toBe(true);
    expect(effectiveMode("web", "teen")).toBe("offline");
    expect(effectiveMode("web", "child")).not.toBe("offline");
    expect(refuseWeb("teen")).toBe(TEEN_WEB_OFF_NOTE);
  });

  test("a child's temporary chat is offline even with the switch on; a teen's and an adult's are not", () => {
    expect(effectiveMode("web", "child", true)).toBe("offline");
    expect(effectiveMode("web", "teen", true)).not.toBe("offline");
    expect(effectiveMode("web", "adult", true)).not.toBe("offline");
    expect(refuseWeb("child", true)).toBe(CHILD_TEMPORARY_WEB_OFF_NOTE);
    expect(refuseWeb("child", true)).toContain("regular chat");
  });

  test("an adult still gets the household copy", () => {
    expect(refuseWeb("adult")).toBe(WEB_OFF_NOTE);
  });
});

describe("MINOR-SEARCH-01c enforcement at the lookup choke point", () => {
  const library = async () => ({ text: "Library says: water boils at 100 C.", rows: [] });
  const run = async (band: "child" | "teen", temporary: boolean) => {
    let webCalls = 0;
    const result = await federatedLookup(
      { query: "boiling point of water", band, scope: "web", temporary, web: async () => { webCalls += 1; return { text: "live", rows: [] }; } },
      { lookupReference: library as never },
    );
    return { text: result.text, webCalls };
  };
  test("a child's temporary chat never reaches the web side and says how to search", async () => {
    const out = await run("child", true);
    expect(out.webCalls).toBe(0);
    expect(out.text).toContain(CHILD_TEMPORARY_WEB_OFF_NOTE);
  });
  test("a teen's temporary chat does reach it", async () => {
    expect((await run("teen", true)).webCalls).toBe(1);
  });
  test("with the child switch off a regular chat stays offline and names the fix", async () => {
    setHouseholdSettingValue("search.web.child_mode", "off");
    const out = await run("child", false);
    expect(out.webCalls).toBe(0);
    expect(out.text).toContain(CHILD_WEB_OFF_NOTE);
  });
});

describe("MINOR-SEARCH-01c policy guard: the ask_parent branch is reachable only for consequential home actions", () => {
  test("a web search never asks a parent for a child or a teen, with or without a household name", () => {
    const websearch = listInstalledManifests().find((m) => m.id === "websearch")!;
    for (const band of ["child", "teen"] as const) {
      for (const capabilities of [websearch.permissions ?? [], ["search.household_subject"]]) {
        const result = decide({ who: { personId: "p", role: band, band }, what: { capabilities, consequential: websearch.consequential, minRole: websearch.min_role }, context: { provenance: "person" } });
        expect(result.kind).not.toBe("ask_parent");
      }
    }
  });

  test("a teen's consequential lock is the case that does ask a parent, and a child's is refused outright", () => {
    const ask = (band: "child" | "teen") => decide({ who: { personId: "p", role: band, band }, what: { capabilities: ["home:lock"], consequential: true }, context: { provenance: "person" } });
    expect(ask("teen").kind).toBe("ask_parent");
    expect(ask("child")).toMatchObject({ kind: "deny", reason: "never_for_band" });
  });
});
