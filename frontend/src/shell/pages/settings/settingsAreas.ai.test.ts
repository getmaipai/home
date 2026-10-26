import { describe, expect, test } from "bun:test";
import { settingsArea } from "./settingsAreas";

describe("AI and models settings page", () => {
  test("has no Manage card: its AI models and Engines links only reopened this page", () => {
    const ai = settingsArea("settings")!.sections.find((section) => section.id === "ai")!;
    expect(ai.cards?.some((card) => card.label === "Manage")).toBe(false);
    expect(ai.cards?.some((card) => card.links?.some((link) => link.href === "/models" || link.href === "/engines"))).toBe(false);
  });
});
