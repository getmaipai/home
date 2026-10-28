import { beforeEach, describe, expect, test } from "bun:test";
import { __resetWeatherSummaryForTests, __setWeatherSummaryCompleterForTests, factualLine, hoursOf, outlookLine, summaryFor } from "@/lib/weatherSummary";

const input = { place: "Cabin", unit: "fahrenheit" as const, temp: 48, condition: "Light rain", high: 52, low: 40 };
const FACTS = "It is 48°F and light rain. Today's high is 52° and the low is 40°.";
const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

beforeEach(() => __resetWeatherSummaryForTests());

describe("the forecast summary", () => {
  test("the first ask returns the factual line while the model works, the next returns the summary", async () => {
    __setWeatherSummaryCompleterForTests(async () => ({ ok: true, text: "A cool, damp day with light rain." }));
    expect(summaryFor(input, 0)).toBe(FACTS);
    await flush();
    expect(summaryFor(input, 0)).toBe("A cool, damp day with light rain.");
  });
  test("one model call per place per hour, however often it is asked", async () => {
    let calls = 0;
    __setWeatherSummaryCompleterForTests(async () => { calls += 1; return { ok: true, text: "Cool and damp." }; });
    summaryFor(input, 0); summaryFor(input, 0); summaryFor(input, 1_000);
    await flush();
    summaryFor(input, 2_000);
    expect(calls).toBe(1);
    summaryFor(input, 3_600_000);
    await flush();
    expect(calls).toBe(2);
  });
  test("a busy or failed model keeps the factual line, never an error", async () => {
    __setWeatherSummaryCompleterForTests(async () => ({ ok: false, unavailable: true }));
    summaryFor(input, 0);
    await flush();
    expect(summaryFor(input, 0)).toBe(FACTS);
  });
  test("a throwing model is swallowed", async () => {
    __setWeatherSummaryCompleterForTests(async () => { throw new Error("down"); });
    summaryFor(input, 0);
    await flush();
    expect(summaryFor(input, 0)).toBe(FACTS);
  });
  test("text the child floor refuses is never kept", async () => {
    __setWeatherSummaryCompleterForTests(async () => ({ ok: true, text: "any l-o-l-i stuff" }));
    summaryFor(input, 0);
    await flush();
    expect(summaryFor(input, 0)).toBe(FACTS);
  });
  test("no numbers means no summary and no model call", async () => {
    let calls = 0;
    __setWeatherSummaryCompleterForTests(async () => { calls += 1; return { ok: true, text: "x" }; });
    expect(summaryFor({ place: "Cabin", unit: "fahrenheit" }, 0)).toBe("");
    await flush();
    expect(calls).toBe(0);
  });
  test("the prompt carries numbers only, and is told not to add facts", async () => {
    let seen = "";
    __setWeatherSummaryCompleterForTests(async (messages) => { seen = messages.map((m) => m.content).join("\n"); return { ok: true, text: "Fine." }; });
    summaryFor(input, 0);
    await flush();
    expect(seen).toContain("48");
    expect(seen).not.toContain("Advice");
    expect(seen.toLowerCase()).toContain("never advise");
    expect(seen.toLowerCase()).toContain("do not add");
  });
});

describe("the factual line", () => {
  test("states the numbers and condition with no advice", () => {
    expect(factualLine(input)).toBe(FACTS);
    expect(factualLine({ place: "X", unit: "celsius", condition: "Clear" })).toBe("It is clear.");
    expect(factualLine({ place: "X", unit: "celsius" })).toBe("");
  });
});

describe("the outlook", () => {
  const at = (h: number) => `2026-10-28T${String(h).padStart(2, "0")}:00`;
  const hours = (temps: number[], pops: number[] = []) => temps.map((temp, i) => ({ time: at(12 + i), temp, pop: pops[i] ?? 0 }));
  const base = { place: "Cabin", unit: "fahrenheit" as const, temp: 50 };
  test("a big drop says it gets colder, and when", () => {
    expect(outlookLine({ ...base, hours: hours([50, 48, 44, 40, 38, 36]) })).toBe("It gets colder, down to 36°F by 5 PM.");
  });
  test("rain starting later says when; below freezing it is snow", () => {
    expect(outlookLine({ ...base, hours: hours([50, 49, 48, 47], [0, 10, 70, 80]) })).toBe("Rain is likely from about 2 PM.");
    expect(outlookLine({ ...base, temp: 30, hours: hours([30, 29, 28, 28], [0, 10, 70, 80]) })).toBe("Snow is likely from about 2 PM.");
  });
  test("rain that is falling now and stops says when it ends", () => {
    expect(outlookLine({ ...base, hours: hours([50, 50, 51, 51], [80, 60, 20, 10]) })).toBe("The wet weather should end around 2 PM.");
  });
  test("warming, and no change", () => {
    expect(outlookLine({ ...base, hours: hours([50, 55, 60, 62]) })).toBe("It warms up to 62°F by 3 PM.");
    expect(outlookLine({ ...base, hours: hours([50, 51, 50, 52]) })).toBe("No big changes are expected over the next several hours.");
    expect(outlookLine({ ...base, hours: [] })).toBe("");
  });
  test("the factual line and the prompt carry it, and hoursOf zips the recipe arrays", async () => {
    const data = { block_hour_times: [at(12), at(13), at(14)], block_hour_temps: [50, 40, 35], block_hour_pop: [0, 0, 0] };
    expect(hoursOf(data)).toEqual([{ time: at(12), temp: 50, pop: 0 }, { time: at(13), temp: 40, pop: 0 }, { time: at(14), temp: 35, pop: 0 }]);
    const withHours = { ...input, temp: 50, hours: hoursOf(data) };
    expect(factualLine(withHours)).toContain("It gets colder");
    let seen = "";
    __setWeatherSummaryCompleterForTests(async (messages) => { seen = messages.map((m) => m.content).join("\n"); return { ok: true, text: "Colder soon." }; });
    summaryFor(withHours, 0);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(seen).toContain("Next hours: It gets colder");
  });
});
