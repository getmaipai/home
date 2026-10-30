import { describe, expect, test } from "bun:test";
import { dayPartOf, firstNameOf, GREETING_POOL_FOR_TESTS, starterGreeting } from "./starterGreeting";

const every = [...GREETING_POOL_FOR_TESTS.ANYTIME, ...Object.values(GREETING_POOL_FOR_TESTS.BY_TIME).flat()];

describe("starterGreeting", () => {
  test("every line is about the person and follows the writing rules", () => {
    for (const line of every) {
      expect(line).toContain("{name}");
      expect(line).not.toContain("—");
      expect(line.length).toBeLessThan(90);
    }
    expect(new Set(every).size).toBe(every.length);
  });

  test("it uses the person's first name and holds still for the same pick", () => {
    const line = starterGreeting("Sage Rivera", 10, 0.3);
    expect(line).toContain("Sage");
    expect(line).not.toContain("Rivera");
    expect(starterGreeting("Sage Rivera", 10, 0.3)).toBe(line);
  });

  test("different picks give different lines across the whole pool", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) seen.add(starterGreeting("Nova", 14, i / 40));
    expect(seen.size).toBeGreaterThan(15);
  });

  test("the hour only chooses the extra lines, with the boundaries where people expect them", () => {
    expect([4, 5, 11, 12, 16, 17, 21, 22, 0].map(dayPartOf)).toEqual(["night", "morning", "morning", "afternoon", "afternoon", "evening", "evening", "night", "night"]);
    expect(starterGreeting("Nova", 8, 0.99)).toContain("Nova");
  });

  test("a person with no name never gets a blank, a stray comma or a bare brace", () => {
    for (let i = 0; i < every.length; i++) {
      const line = starterGreeting("", 14, i / every.length);
      expect(line).not.toContain("{");
      expect(line).not.toMatch(/\s,|,\s*[.?]|^\s|\s{2}/);
      expect(line[0]).toBe(line[0]!.toUpperCase());
    }
    expect(firstNameOf("  ")).toBe("");
  });
});
