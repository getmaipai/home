// ROUTER-SHIP-01: arm C (ROUTER-BUILD-02) is the shipped search head. These tests pin what was shipped:
// the pin names the C bytes, the manifest carries C's tuned threshold, the shipped scorer applies it, and
// the guards that decide who may be scored or rescued are untouched by the swap.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { SEARCH_ASSIST_PIN, parseSearchAssistManifest } from "@/lib/searchAssist/weights";
import { scoreHead } from "@/lib/searchAssist/score";
import { searchAssistEligibility, cappedSearchAssistMode, MINOR_RESCUE_ENABLED, type EligibilityState } from "@/lib/searchAssist/eligible";

const path = new URL("../src/lib/searchAssist/__fixtures__/weights-shipped.json", import.meta.url).pathname;
const bytes = readFileSync(path);
const manifest = parseSearchAssistManifest(JSON.parse(bytes.toString("utf8")));
const C_SHA = "e97cb1e97d2f9b200ad033749fdcf2d47d148b0408d4ab5f1a4d89854b213468";

describe("shipped search head is arm C", () => {
  test("the pin and the shipped weights bytes are arm C's frozen sha256", () => {
    expect(SEARCH_ASSIST_PIN?.sha256).toBe(C_SHA);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(C_SHA);
    expect(SEARCH_ASSIST_PIN?.url).toContain("search-assist-weights-v2");
  });

  test("C's weights load: 768-dim nomic concat head over three classes", () => {
    expect(manifest.embed.dims).toBe(768);
    expect(manifest.features).toBe("concat");
    expect(manifest.classes).toEqual(["no_tool", "recency", "stable"]);
    expect(manifest.coef[0]).toHaveLength(1536);
  });

  test("C's tuned threshold 0.604421 is the one recorded and applied", () => {
    expect(manifest.thresholds.websearch).toEqual({ class: "recency", value: 0.604421 });
    const width = manifest.coef[0]!.length;
    const dir = manifest.coef[manifest.classes.indexOf("recency")]!.map((v) => (v >= 0 ? 1 : -1));
    // Scale the input until the recency probability sits between C's bar and A's old bar.
    let found: number[] | null = null;
    for (let t = 0.0001; t < 1 && !found; t *= 1.05) {
      const f = dir.map((v) => v * t);
      const p = scoreHead(f, manifest, "websearch").p;
      if (p > 0.62 && p < 0.66) found = f;
    }
    expect(found).not.toBeNull();
    expect(found).toHaveLength(width);
    // Over C's recorded bar, under A's: only the recorded value decides.
    expect(scoreHead(found!, manifest, "websearch").over).toBe(true);
    const oldBar = { ...manifest, thresholds: { websearch: { class: "recency", value: 0.674744 } } };
    expect(scoreHead(found!, oldBar, "websearch").over).toBe(false);
  });
});

function state(role: string, spoken = false): EligibilityState {
  return {
    surface: "chat",
    actor: { id: "p1", role, birthdate: null },
    speakerEvidence: null,
    spoken,
    bare: false,
    crisis: false,
    budget: { tools_offered: ["websearch"] },
    planBasis: { surfaceClass: spoken ? "spoken" : "written" },
    outcomes: [],
  } as unknown as EligibilityState;
}

describe("the guards around the head are unchanged by the swap", () => {
  const NOW = new Date("2026-10-11T12:00:00Z");
  test("a minor is never rescued while the minor switch is off", () => {
    expect(MINOR_RESCUE_ENABLED).toBe(false);
    expect(cappedSearchAssistMode("child", "rescue")).toBe("shadow");
    expect(cappedSearchAssistMode("teen", "rescue")).toBe("shadow");
    for (const role of ["child", "teen"]) {
      expect(searchAssistEligibility(state(role), "rescue", { now: NOW, modelToolCalls: 0 }).rescuable).toBe(false);
    }
  });

  test("a spoken turn is scored but never rescued", () => {
    expect(searchAssistEligibility(state("adult", true), "rescue", { now: NOW, modelToolCalls: 0 })).toEqual({ scored: true, rescuable: false });
  });

  test("an adult written turn with zero model tool calls is the only rescuable one", () => {
    expect(searchAssistEligibility(state("adult"), "rescue", { now: NOW, modelToolCalls: 0 }).rescuable).toBe(true);
    expect(searchAssistEligibility(state("adult"), "rescue", { now: NOW, modelToolCalls: 1 }).rescuable).toBe(false);
  });
});
