import { beforeEach, describe, expect, test } from "bun:test";
import { __resetWeatherSummaryForTests, __setWeatherSummaryCompleterForTests, summaryFor } from "@/lib/weatherSummary";
import type { AdviceItem } from "@/lib/weatherAdvice";

const advice: AdviceItem[] = [{ id: "jacket", kind: "clothing", text: "Wear a jacket." }, { id: "umbrella", kind: "rain", text: "Bring an umbrella." }];
const input = { place: "Cabin", unit: "fahrenheit" as const, temp: 48, condition: "Light rain", high: 52, low: 40, advice };
const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

beforeEach(() => __resetWeatherSummaryForTests());

describe("the forecast summary", () => {
  test("the first ask returns the advice line while the model works, the next returns the summary", async () => {
    __setWeatherSummaryCompleterForTests(async () => ({ ok: true, text: "A cool, damp day. Take a jacket and an umbrella." }));
    expect(summaryFor(input, 0)).toBe("Wear a jacket. Bring an umbrella.");
    await flush();
    expect(summaryFor(input, 0)).toBe("A cool, damp day. Take a jacket and an umbrella.");
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
  test("a busy or failed model keeps the advice line, never an error", async () => {
    __setWeatherSummaryCompleterForTests(async () => ({ ok: false, unavailable: true }));
    summaryFor(input, 0);
    await flush();
    expect(summaryFor(input, 0)).toBe("Wear a jacket. Bring an umbrella.");
  });
  test("a throwing model is swallowed", async () => {
    __setWeatherSummaryCompleterForTests(async () => { throw new Error("down"); });
    summaryFor(input, 0);
    await flush();
    expect(summaryFor(input, 0)).toBe("Wear a jacket. Bring an umbrella.");
  });
  test("text the child floor refuses is never kept", async () => {
    __setWeatherSummaryCompleterForTests(async () => ({ ok: true, text: "any l-o-l-i stuff" }));
    summaryFor(input, 0);
    await flush();
    expect(summaryFor(input, 0)).toBe("Wear a jacket. Bring an umbrella.");
  });
  test("no advice means no summary and no model call", async () => {
    let calls = 0;
    __setWeatherSummaryCompleterForTests(async () => { calls += 1; return { ok: true, text: "x" }; });
    expect(summaryFor({ ...input, advice: [] }, 0)).toBe("");
    await flush();
    expect(calls).toBe(0);
  });
  test("the prompt carries numbers and advice, and is told not to add facts", async () => {
    let seen = "";
    __setWeatherSummaryCompleterForTests(async (messages) => { seen = messages.map((m) => m.content).join("\n"); return { ok: true, text: "Fine." }; });
    summaryFor(input, 0);
    await flush();
    expect(seen).toContain("48");
    expect(seen).toContain("Wear a jacket.");
    expect(seen.toLowerCase()).toContain("do not add");
  });
});
