// U0b (docs/plans/simple-turn-pipeline-2026-09-22.md): the no-new-rules
// lint. Tests the pure scanner (`scanSource`) against fixture source
// text, plus the baseline-comparison logic in `main()`'s shape via a
// scripted budget check, mirroring `speechLint.test.ts`'s
// fixture-driven style rather than running the CLI against real files.
import { describe, expect, test } from "bun:test";
import { scanSource } from "../scripts/lint/rule-budget";
import { RULE_NAMES } from "../src/lib/ruleNames";

describe("rule-budget lint: scanSource", () => {
  test("an unmarked regex literal counts against the budget", () => {
    const fixture = `
export const GREETING_RE = /^(hi|hello)$/i;
`;
    const result = scanSource(fixture, "fixture.ts");
    expect(result.total).toBe(1);
    expect(result.unmarked).toBe(1);
    expect(result.occurrences[0]?.kind).toBe("regex");
    expect(result.occurrences[0]?.marked).toBe(false);
  });

  test("the same regex literal marked with a valid rule name and a design reference does not count", () => {
    const validName = RULE_NAMES[0];
    expect(validName).toBeDefined();
    const fixture = `
// rule: ${validName} (docs/plans/simple-turn-pipeline-2026-09-22.md)
export const GREETING_RE = /^(hi|hello)$/i;
`;
    const result = scanSource(fixture, "fixture.ts");
    expect(result.total).toBe(1);
    expect(result.unmarked).toBe(0);
    expect(result.occurrences[0]?.marked).toBe(true);
    expect(result.occurrences[0]?.markerValid).toBe(true);
  });

  test("a marker naming something outside ruleNames.ts still counts as unmarked", () => {
    const fixture = `
// rule: not_a_real_rule_name (docs/plans/simple-turn-pipeline-2026-09-22.md)
export const GREETING_RE = /^(hi|hello)$/i;
`;
    const result = scanSource(fixture, "fixture.ts");
    expect(result.unmarked).toBe(1);
    expect(result.occurrences[0]?.marked).toBe(true);
    expect(result.occurrences[0]?.markerValid).toBe(false);
  });

  // .github/docs/RULES-AND-LEARNED-COMPONENTS.md, "No hacky rules"
  // (2026-09-22): "a new rule outside the protected modules fails the
  // gate unless its marker names the design record that accepted it."
  test("a marked line with no design reference fails", () => {
    const validName = RULE_NAMES[0];
    expect(validName).toBeDefined();
    const fixture = `
// rule: ${validName}
export const GREETING_RE = /^(hi|hello)$/i;
`;
    const result = scanSource(fixture, "fixture.ts");
    expect(result.unmarked).toBe(1);
    expect(result.occurrences[0]?.marked).toBe(true);
    expect(result.occurrences[0]?.markerName).toBe(validName);
    expect(result.occurrences[0]?.markerValid).toBe(false);
  });

  test("a same-line trailing marker with a design reference also exempts the literal", () => {
    const validName = RULE_NAMES[1];
    expect(validName).toBeDefined();
    const fixture = `export const GREETING_RE = /^(hi|hello)$/i; // rule: ${validName} (U2)\n`;
    const result = scanSource(fixture, "fixture.ts");
    expect(result.unmarked).toBe(0);
  });

  test("new RegExp(...) counts the same as a literal", () => {
    const fixture = `
const dynamic = "x";
export const RE = new RegExp(dynamic, "i");
`;
    const result = scanSource(fixture, "fixture.ts");
    expect(result.total).toBe(1);
    expect(result.occurrences[0]?.kind).toBe("regex");
  });

  test("a three-string array is a word list; two strings is not", () => {
    const fixture = `
const three = ["a", "b", "c"];
const two = ["a", "b"];
`;
    const result = scanSource(fixture, "fixture.ts");
    expect(result.total).toBe(1);
    expect(result.occurrences[0]?.kind).toBe("wordlist");
  });

  test("a mixed array (a string and a number) is not a word list", () => {
    const fixture = `
const mixed = ["a", "b", 3];
`;
    const result = scanSource(fixture, "fixture.ts");
    expect(result.total).toBe(0);
  });

  test("a multi-line word list is marked by a comment on its opening line", () => {
    const validName = RULE_NAMES[2];
    expect(validName).toBeDefined();
    const fixture = `
// rule: ${validName} (BACKLOG.md#u0b)
const LIST = [
  "a",
  "b",
  "c",
];
`;
    const result = scanSource(fixture, "fixture.ts");
    expect(result.unmarked).toBe(0);
  });

  test("a marker two lines above does not exempt the literal", () => {
    const validName = RULE_NAMES[0];
    const fixture = `
// rule: ${validName} (BACKLOG.md#u0b)

export const GREETING_RE = /^(hi|hello)$/i;
`;
    const result = scanSource(fixture, "fixture.ts");
    expect(result.unmarked).toBe(1);
  });
});
