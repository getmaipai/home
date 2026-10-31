import { describe, expect, test } from "bun:test";
import { certaintyFields, certaintyOf, gateBand, memoryBand, precipitationBand, webHostCount, WEB_AGREEMENT_MIN_HOSTS } from "../src/lib/certainty";
import { toolResultContent } from "../src/lib/composer";
import { contextToMessages } from "../src/lib/turnMachine/messages";
import { DEFAULT_PERSONA, INFORMATION_HANDLING_POLICY, INFORMATION_HANDLING_POLICY_WRITTEN } from "../src/lib/persona";
import { MAX_RULES_SECTION_CHARS } from "../src/lib/turnShared";
import type { ToolExecutionOutcome } from "../src/lib/turnContext";

function outcome(packageId: string, extra: Partial<ToolExecutionOutcome> = {}): ToolExecutionOutcome {
  return { callId: `call-${packageId}`, packageId, status: "succeeded", ...extra };
}
const webSource = (site: string): any => ({ id: `src-${site.replace(/\W/g, "")}abc`, kind: "web" as const, title: `Page on ${site}`, url: `https://${site}/a`, site, snippet: null });
const search = (hosts: string[]) => outcome("websearch", { result: { reply: { text: "x" }, data: { query: "q", rows: hosts.map((h) => ({ title: `T ${h}`, url: `https://${h}/p`, snippet: "s" })) } } as never });
const weather = (chance: unknown) => outcome("weather", { result: { reply: { text: "It's 70." }, data: { temperature: 70, precipitation_chance: chance } } as never });

describe("certaintyOf: one row per source kind", () => {
  test("reference source is likely", () => {
    expect(certaintyOf(outcome("books", { source: { kind: "reference", title: "Atlas" } }))).toBe("likely");
  });
  test("a single web source is maybe", () => {
    expect(certaintyOf(search(["a.example"]))).toBe("maybe");
    expect(certaintyOf(outcome("x", { source: { kind: "web", title: "t", site: "a.example" } }))).toBe("maybe");
  });
  test("two distinct web hosts are likely; the same host twice is still maybe", () => {
    expect(WEB_AGREEMENT_MIN_HOSTS).toBe(2);
    expect(certaintyOf(search(["a.example", "b.example"]))).toBe("likely");
    expect(certaintyOf(search(["a.example", "www.a.example"]))).toBe("maybe");
    expect(webHostCount(outcome("x", { sources: [webSource("a.example"), webSource("b.example")] }))).toBe(2);
  });
  test("a news shelf item is reported", () => {
    expect(certaintyOf(outcome("news", { sources: [{ ...webSource("n.example"), kind: "shelf" }] }))).toBe("reported");
  });
  test("a household record or live reading is sure", () => {
    expect(certaintyOf(outcome("remind"))).toBe("sure");
    expect(certaintyOf(weather(5))).toBe("sure");
  });
  test("a failed outcome carries no band", () => {
    expect(certaintyOf(outcome("websearch", { status: "failed" }))).toBeNull();
  });
});

describe("memoryBand", () => {
  const now = new Date("2026-10-28T00:00:00Z");
  test("sure when confident and recent, recalled when low confidence or old", () => {
    expect(memoryBand(1, "2026-10-01T00:00:00Z", now)).toBe("sure");
    expect(memoryBand(0.59, "2026-10-01T00:00:00Z", now)).toBe("recalled");
    expect(memoryBand(0.6, "2026-10-01T00:00:00Z", now)).toBe("sure");
    expect(memoryBand(1, "2026-04-01T00:00:00Z", now)).toBe("recalled");
    expect(memoryBand(null, "2026-10-01T00:00:00Z", now)).toBe("sure");
  });
});

describe("weather precipitation thresholds", () => {
  test("29 unlikely, 30 maybe, 59 maybe, 60 likely", () => {
    expect(precipitationBand(29)).toBe("unlikely");
    expect(precipitationBand(30)).toBe("maybe");
    expect(precipitationBand(59)).toBe("maybe");
    expect(precipitationBand(60)).toBe("likely");
    expect(precipitationBand("60")).toBe("likely");
    expect(precipitationBand("")).toBeNull();
  });
  test("the outcome carries the rain band beside its sure reading", () => {
    expect(certaintyFields(weather(45), "adult", false)).toEqual({ certainty: "sure", precipitation_certainty: "maybe" });
  });
});

describe("listener gate", () => {
  test("adults and unflagged turns keep every band", () => {
    expect(gateBand("reported", "adult", true)).toBe("reported");
    expect(gateBand("maybe", "child", false)).toBe("maybe");
    expect(gateBand("recalled", "teen", false)).toBe("recalled");
  });
  test("a flagged child or teen keeps only sure and likely", () => {
    for (const age of ["child", "teen"] as const) {
      expect(gateBand("sure", age, true)).toBe("sure");
      expect(gateBand("likely", age, true)).toBe("likely");
      for (const weak of ["maybe", "unlikely", "recalled", "reported"] as const) expect(gateBand(weak, age, true)).toBeNull();
    }
    expect(certaintyFields(weather(10), "child", true)).toEqual({ certainty: "sure" });
  });
});

describe("rendering", () => {
  test("the tool message shows the band beside the fact, only when a gate is given", () => {
    const o = search(["a.example", "b.example"]);
    expect(JSON.parse(toolResultContent(o, undefined, false, { ageBand: "adult", safetyFlagged: false })).certainty).toBe("likely");
    expect(JSON.parse(toolResultContent(o)).certainty).toBeUndefined();
    expect(JSON.parse(toolResultContent(weather(45), undefined, false, { ageBand: "adult", safetyFlagged: false }))).toMatchObject({ certainty: "sure", precipitation_certainty: "maybe" });
    expect(JSON.parse(toolResultContent(search(["a.example"]), undefined, false, { ageBand: "teen", safetyFlagged: true })).certainty).toBeUndefined();
  });
  test("a memory line shows its band", () => {
    const item = { id: "memory-1", text: "Dentist is Dr. Lee", source: "memory" as const, subjects: [], disclosure: "adult_only" as const, at: "2026-01-01T00:00:00Z", certainty: "recalled" as const };
    const msgs = contextToMessages([item], "who is my dentist", DEFAULT_PERSONA, { moves: [], constraints: {}, length: {} } as never, { age_band: "adult" } as never, "spoken");
    expect(JSON.stringify(msgs)).toContain("certainty: recalled");
  });
});

describe("policy paragraph", () => {
  test("both twins carry the certainty paragraph and fit the rules cap", () => {
    for (const text of [INFORMATION_HANDLING_POLICY, INFORMATION_HANDLING_POLICY_WRITTEN]) {
      expect(text).toContain("certainty");
      expect(text).toContain("safety");
      expect(text).toContain("probably around seventy");
      expect(text).not.toContain("uncertain or secondhand");
    }
    expect(INFORMATION_HANDLING_POLICY.length).toBeLessThanOrEqual(MAX_RULES_SECTION_CHARS);
  });
});
