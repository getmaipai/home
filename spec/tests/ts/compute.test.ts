// Tests for the compute step's spoken-arithmetic normalization (#72).
import { describe, expect, test } from "bun:test";
import { evaluateExpression, normalizeSpokenMath } from "../../interpreters/ts/compute.js";

describe("normalizeSpokenMath", () => {
  test("converts spoken arithmetic to calculator symbols", () => {
    expect(normalizeSpokenMath("12 times 12")).toBe("12 * 12");
    expect(normalizeSpokenMath("100 divided by 4")).toBe("100 / 4");
    expect(normalizeSpokenMath("12 x 12")).toBe("12*12");
    expect(normalizeSpokenMath("3x4")).toBe("3*4");
    expect(normalizeSpokenMath("12 x12")).toBe("12*12");
    expect(normalizeSpokenMath("12x 12")).toBe("12*12");
    expect(normalizeSpokenMath("5 squared")).toBe("5^2");
    expect(normalizeSpokenMath("20 percent of 50")).toBe("(20/100)*50");
    expect(normalizeSpokenMath("(2 + 3) * 4")).toBe("(2 + 3) * 4");
    expect(normalizeSpokenMath("2 miles to km")).toBe("2 miles to km");
    expect(normalizeSpokenMath("seven times three")).toBe("seven * three");
    expect(normalizeSpokenMath("12 times?")).toBe("12 *");
    expect(normalizeSpokenMath("100 over 4")).toBe("100/4");
    expect(normalizeSpokenMath("2 miles over there")).toBe("2 miles over there");
    expect(normalizeSpokenMath("2.5 squared")).toBe("2.5^2");
    expect(normalizeSpokenMath("12.5 percent of 80")).toBe("(12.5/100)*80");
    expect(normalizeSpokenMath("5 SQUARED")).toBe("5^2");
  });

  test("handles trailing punctuation and whitespace", () => {
    expect(normalizeSpokenMath("   12 times 12   ")).toBe("12 * 12");
    expect(normalizeSpokenMath("100 divided by 4.")).toBe("100 / 4");
    expect(normalizeSpokenMath("5 squared!")).toBe("5^2!");
  });
});

describe("evaluateExpression", () => {
  test("evaluates normalized spoken arithmetic expressions", () => {
    expect(evaluateExpression("12 times 12")).toBe("144");
    expect(evaluateExpression("100 divided by 4")).toBe("25");
    expect(evaluateExpression("20 percent of 50")).toBe("10");
    expect(evaluateExpression("5 squared")).toBe("25");
    expect(evaluateExpression("(2 + 3) * 4")).toBe("20");
  });

  test("throws ComputeError for invalid expressions", () => {
    expect(() => evaluateExpression("12 times")).toThrow(/Unexpected end of expression/);
  });

  test("keeps hex literals untouched and evaluates them (#107)", () => {
    expect(normalizeSpokenMath("0x10")).toBe("0x10");
    expect(evaluateExpression("0x10")).toBe("16");
    expect(evaluateExpression("0xff plus 1")).toBe("256");
  });
});