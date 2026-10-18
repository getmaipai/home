import { describe, expect, test } from "bun:test";
import { SETTINGS_AREAS, settingsArea } from "./settingsAreas";

// CODE-SET-01 builds the Coding screens; until then the spec's coding sections must not appear in Settings.
describe("Coding settings sections before CODE-SET-01", () => {
  test("neither the home nor the account area lists a coding section", () => {
    for (const id of ["home", "account"]) {
      expect(settingsArea(id)?.sections.some((section) => section.id === "coding")).toBe(false);
    }
  });
  test("every other section the spec declares is still listed", () => {
    expect(SETTINGS_AREAS.length).toBeGreaterThan(0);
    for (const area of SETTINGS_AREAS) expect(area.sections.length).toBeGreaterThan(0);
  });
});
