// The minor-protection floors read no setting. This flips EVERY household setting in the registry (generation.people_prompts,
// generation.adults, generation.adult_adapters, generation.kids, every other key) to each non-default choice, in two sweeps, and
// asserts the floors still hold: detectCsam, minorLine, refusePrompt, refuseVideoPrompt and the viewer-aware decideAgeCheck.
// Probes use the plain word "child" and the mild word "naked"; no explicit wording is written anywhere.
import { beforeEach, describe, expect, test } from "bun:test";
import { detectCsam } from "@maipai/spec/safety/ts/signals.js";
import { resetDb } from "./reset-db";
import { getRegistry } from "@/lib/settingsRegistry";
import { setHouseholdSettingValue } from "@/lib/settings";
import { minorSexualMatch, mixedScriptMinorCue } from "@/lib/pictures/minorLine";
import { promptViolatesMinorLine, refusePrompt } from "@/lib/pictures/policy";
import { refuseVideoPrompt } from "@/lib/videos/policy";
import { decideAgeCheck, type AgeVerdict, type ImageCheck } from "@/lib/pictures/ageCheck";

const verdict = (label: AgeVerdict["label"], sexual: boolean): ImageCheck => ({
  ok: true, verdict: { people_count: 1, apparent_min_age_estimate: label === "adult" ? 35 : 8, label, is_nude_or_sexual: sexual, confidence: 0.9 },
});

function assertFloorsHold(): void {
  for (const prompt of ["a naked child", "ch1ld n.a.k.e.d", "a c h i l d, naked", "a happy child 公園 with a naked friend"]) {
    expect(promptViolatesMinorLine(prompt)).toBe(true);
    expect(refusePrompt(prompt)).toBe("minor_sexual");
    expect(refusePrompt(prompt, { lane: "adult" })).toBe("minor_sexual");
    expect(refuseVideoPrompt(prompt)).toBe("minor_sexual");
  }
  expect(detectCsam("a naked child").matched.length).toBeGreaterThan(0);
  expect(detectCsam("ch1ld naked").matched.length).toBeGreaterThan(0);
  expect(minorSexualMatch("a naked child")).toBe(true);
  expect(mixedScriptMinorCue("a child 公園")).toBe(true);
  // the finished-picture decision: an adult viewer withholds a possible minor in a sexual picture; a teen and a child withhold ANY sexual picture and fail closed
  expect(decideAgeCheck([verdict("child", true)], false, "picture").action).toBe("withhold");
  for (const viewer of ["teen", "child"] as const) {
    expect(decideAgeCheck([verdict("adult", true)], false, "picture", viewer).action).toBe("withhold");
    expect(decideAgeCheck([verdict("adult", false)], true, "picture", viewer).action).toBe("withhold");
    expect(decideAgeCheck([{ ok: false, why: "timeout" }], false, "picture", viewer)).toMatchObject({ action: "withhold", reason: "unchecked" });
    expect(decideAgeCheck([], false, "video", viewer).action).toBe("withhold");
  }
}

beforeEach(() => resetDb());

describe("no setting reaches the minor-protection floors", () => {
  test("the registry has household keys, among them the picture settings", () => {
    const keys = getRegistry().filter((k) => k.scope === "household").map((k) => k.key);
    for (const key of ["generation.people_prompts", "generation.adults", "generation.adult_adapters"]) expect(keys).toContain(key);
  });

  test("every household setting flipped to each of its other choices, one at a time and then all together", () => {
    const household = getRegistry().filter((k) => k.scope === "household");
    assertFloorsHold();
    const flipped: string[] = [];
    for (const key of household) {
      const options: unknown[] = [];
      if (key.selector === "boolean") options.push(!(key.default as boolean));
      else if (Array.isArray((key.range as { options?: unknown[] } | undefined)?.options)) options.push(...(key.range as { options: unknown[] }).options);
      for (const value of options) {
        const result = setHouseholdSettingValue(key.key, value);
        if (result.ok) flipped.push(`${key.key}=${String(value)}`);
        assertFloorsHold();
      }
    }
    expect(flipped.length).toBeGreaterThan(10);
    expect(flipped).toContain("generation.people_prompts=true");
    // and each boolean in both directions all at once
    for (const direction of [true, false]) {
      for (const key of household) if (key.selector === "boolean") setHouseholdSettingValue(key.key, direction);
      assertFloorsHold();
    }
  });
});

describe("the viewer-aware finished-picture decision", () => {
  test("an adult viewer is unchanged", () => {
    expect(decideAgeCheck([verdict("adult", true)], false, "picture")).toEqual({ action: "allow" });
    expect(decideAgeCheck([verdict("child", false)], false, "picture")).toEqual({ action: "allow" });
    expect(decideAgeCheck([{ ok: false, why: "timeout" }], false, "picture")).toEqual({ action: "allow" });
  });
  test("a teen and a child: anything sexual withholds whoever is in it, an adult-only job is never shown, an unchecked picture is not shown", () => {
    for (const viewer of ["teen", "child"] as const) {
      expect(decideAgeCheck([verdict("adult", true)], false, "picture", viewer)).toMatchObject({ action: "withhold", reason: "minor_sexual" });
      expect(decideAgeCheck([verdict("none", false)], true, "picture", viewer)).toMatchObject({ action: "withhold", reason: "minor_sexual" });
      expect(decideAgeCheck([verdict("adult", false), { ok: false, why: "memory" }], false, "video", viewer)).toMatchObject({ action: "withhold", reason: "unchecked" });
      expect(decideAgeCheck([], false, "picture", viewer)).toMatchObject({ action: "withhold", reason: "unchecked" });
    }
  });
  test("a teen or a child sees an ordinary checked picture, including a cartoon child", () => {
    for (const viewer of ["teen", "child"] as const) {
      expect(decideAgeCheck([verdict("child", false)], false, "picture", viewer)).toEqual({ action: "allow" });
      expect(decideAgeCheck([verdict("none", false)], false, "picture", viewer)).toEqual({ action: "allow" });
    }
  });
  test("the line a teen or a child reads names nothing that was found", () => {
    const d = decideAgeCheck([verdict("child", true)], false, "picture", "child");
    expect(d.action === "withhold" && d.line).toBe("I can't show that one. Want to try something different?");
  });
});
