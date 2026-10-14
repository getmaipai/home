import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkSafety } from "@maipai/spec/safety/ts/classifier.js";

const bank = JSON.parse(readFileSync(resolve(import.meta.dir, "../packages/trivia/bank.json"), "utf8")) as { reviewed: { by: string; on: string | null }; questions: Array<{ id: string; band: string; category: string; question: string; answer: string; source: string }> };
const childCategories = new Set(["animals", "space", "earth and nature", "plants", "the human body", "numbers and math", "shapes and colours", "words and spelling", "continents and oceans"]);

describe("trivia bank", () => {
  test("has unique, sourced questions in every band", () => {
    expect(new Set(bank.questions.map((q) => q.id)).size).toBe(bank.questions.length);
    for (const q of bank.questions) { expect(["child", "teen", "adult"]).toContain(q.band); expect(q.question.trim()).not.toBe(""); expect(q.answer.trim()).not.toBe(""); expect(q.source).toMatch(/^https:\/\//); expect(q.question).not.toContain("—"); }
    expect(bank.questions.filter((q) => q.band === "child").length).toBeGreaterThanOrEqual(40);
    expect(bank.questions.filter((q) => q.band === "teen").length).toBeGreaterThanOrEqual(30);
    expect(bank.questions.filter((q) => q.band === "adult").length).toBeGreaterThanOrEqual(30);
    expect(bank.reviewed).toEqual({ by: "pending", on: null });
  });
  test("child questions meet the narrow content floor", () => {
    for (const q of bank.questions.filter((row) => row.band === "child")) {
      expect(childCategories.has(q.category)).toBe(true);
      expect(q.question.trim().split(/\s+/).length).toBeLessThanOrEqual(20);
      expect(q.answer.trim().split(/\s+/).length).toBeLessThanOrEqual(4);
      expect(checkSafety(`${q.question} ${q.answer}`, { isMinor: true }).flagged).toBe(false);
    }
  });
});
