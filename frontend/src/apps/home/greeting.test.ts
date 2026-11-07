import { describe, expect, test } from "bun:test";
import { familyLabel, greetingFor, timeOfDay } from "./greeting";

describe("familyLabel (household.family_name above the greeting)", () => {
  test("a name becomes '<name> Family'", () => {
    expect(familyLabel("Willow")).toBe("Willow Family");
    expect(familyLabel("  Willow  ")).toBe("Willow Family");
  });
  test("a name that already ends in Family is shown as typed", () => {
    expect(familyLabel("The Willow Family")).toBe("The Willow Family");
    expect(familyLabel("willow family")).toBe("willow family");
  });
  test("an empty or unset name shows nothing", () => {
    expect(familyLabel("")).toBeNull();
    expect(familyLabel("   ")).toBeNull();
    expect(familyLabel(undefined)).toBeNull();
    expect(familyLabel(7)).toBeNull();
  });
});

describe("greetingFor", () => {
  test("keeps the time-of-day greeting", () => {
    expect(timeOfDay(8)).toBe("morning");
    expect(greetingFor(new Date(2026, 0, 1, 13), "Sage")).toBe("Good afternoon, Sage");
  });
});
