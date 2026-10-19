import { describe, expect, test } from "bun:test";
import { audienceAllows, type SettingsViewer } from "@maipai/ui/src/settings/settingsAudience";
import { SETTINGS_AREAS, settingsArea } from "./settingsAreas";

describe("Coding settings sections", () => {
  test("the home and account areas expose their spec-defined Coding sections", () => {
    for (const id of ["home", "account"]) {
      expect(settingsArea(id)?.sections.some((section) => section.id === "coding")).toBe(true);
    }
  });
  test("every other section the spec declares is still listed", () => {
    expect(SETTINGS_AREAS.length).toBeGreaterThan(0);
    for (const area of SETTINGS_AREAS) expect(area.sections.length).toBeGreaterThan(0);
  });

  test("only admins see household Coding and account Coding needs an access capability", () => {
    const home = settingsArea("home")!;
    const account = settingsArea("account")!;
    const homeCoding = home.sections.find((section) => section.id === "coding")!;
    const accountCoding = account.sections.find((section) => section.id === "coding")!;
    const admin: SettingsViewer = { role: "admin", band: "adult" };
    const child: SettingsViewer = { role: "child", band: "child" };
    const teen: SettingsViewer = { role: "teen", band: "teen" };
    const guest: SettingsViewer = { role: "guest", band: "adult" };
    expect(audienceAllows(admin, homeCoding)).toBe(true);
    expect(audienceAllows(child, homeCoding)).toBe(false);
    expect(audienceAllows(child, accountCoding)).toBe(false);
    expect(audienceAllows(teen, accountCoding)).toBe(false);
    expect(audienceAllows(guest, accountCoding)).toBe(false);
    expect(audienceAllows({ ...child, capabilities: ["coding.allowed_for_me"] }, accountCoding)).toBe(true);
  });
});
