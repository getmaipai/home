import { describe, expect, test } from "bun:test";
import { audienceAllows, type SettingsViewer } from "@maipai/ui/src/settings/settingsAudience";
import { settingsArea } from "./settingsAreas";

describe("Coding tabs in the unified Settings area", () => {
  test("the household AI page and personal Chat page expose their declared Coding tabs", () => {
    const area = settingsArea("settings")!;
    expect(area.sections.find((section) => section.id === "ai")?.tabs?.some((tab) => tab.id === "coding")).toBe(true);
    expect(area.sections.find((section) => section.id === "chat")?.tabs?.some((tab) => tab.id === "coding")).toBe(true);
  });

  test("household Coding stays admin-only while personal Coding needs the person's grant", () => {
    const area = settingsArea("settings")!;
    const ai = area.sections.find((section) => section.id === "ai")!;
    const personalCoding = area.sections.find((section) => section.id === "chat")!.tabs!.find((tab) => tab.id === "coding")!;
    const admin: SettingsViewer = { role: "admin", band: "adult" };
    const child: SettingsViewer = { role: "child", band: "child" };
    const teen: SettingsViewer = { role: "teen", band: "teen" };
    expect(audienceAllows(admin, ai)).toBe(true);
    expect(audienceAllows(child, ai)).toBe(false);
    expect(audienceAllows(child, personalCoding)).toBe(false);
    expect(audienceAllows(teen, personalCoding)).toBe(false);
    expect(audienceAllows({ ...child, capabilities: ["coding.allowed_for_me"] }, personalCoding)).toBe(true);
  });
});
