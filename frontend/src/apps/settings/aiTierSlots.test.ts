import { describe, expect, test } from "bun:test";
import { levelsLine, configurableTiers, consequences, draftOf, isOn, optionDefs, sameDraft, toStored, whoChoices, withOn, type SlotDrafts } from "./aiTierSlots";

const drafts = (over: Partial<SlotDrafts> = {}): SlotDrafts => ({ reduced: draftOf(undefined, "reduced"), standard: draftOf(undefined, "standard"), boost: draftOf(undefined, "boost"), max: draftOf(undefined, "max"), ...over });

describe("slot drafts", () => {
  test("an unreadable value reads as the tier's default slot; Max defaults to admins and Reduced to off", () => {
    expect(draftOf(null, "max")).toEqual({ model: "recommended", options: {}, who: "admins" });
    expect(draftOf("x", "reduced").model).toBe("off");
    expect(draftOf({ model: "qwen-small", options: { thinking: true, bad: "x" }, who: "assigned" }, "boost")).toEqual({ model: "qwen-small", options: { thinking: true }, who: "assigned" });
  });

  test("the switch is the slot's off value, and turning it on returns to the recommended model", () => {
    const off = withOn(draftOf({ model: "qwen-small", options: {} }, "boost"), false);
    expect(isOn(off)).toBe(false);
    expect(withOn(off, true).model).toBe("recommended");
  });

  test("who is stored only when it differs from the tier's default", () => {
    expect(toStored(draftOf(undefined, "boost"), "boost")).toEqual({ model: "recommended", options: {} });
    expect(toStored({ ...draftOf(undefined, "boost"), who: "admins" }, "boost")).toEqual({ model: "recommended", options: {}, who: "admins" });
    expect(sameDraft(draftOf(undefined, "boost"), draftOf({ model: "recommended", options: {} }, "boost"))).toBe(true);
  });

  test("Max never offers everyone; Standard offers only everyone; chat alone has Reduced", () => {
    expect(whoChoices("max")).toEqual(["assigned", "admins"]);
    expect(whoChoices("standard")).toEqual(["everyone"]);
    expect(configurableTiers("chat")).toContain("reduced");
    expect(configurableTiers("videos")).toEqual(["standard", "boost", "max"]);
  });

  test("the chat options come from the spec: thinking is a switch", () => {
    expect(optionDefs("chat").find((o) => o.id === "thinking")?.type).toBe("boolean");
  });

  test("consequence lines say what a switch does before it is saved", () => {
    expect(consequences(drafts(), "chat", "Chat")).toContain("Big jobs will not simplify chat, so a Max job that needs more room than the rest leaves is not offered.");
    const off = drafts({ boost: withOn(draftOf(undefined, "boost"), false), max: withOn(draftOf(undefined, "max"), false) });
    const lines = consequences(off, "videos", "Video");
    expect(lines.some((l) => l.startsWith("Boost is off for video"))).toBe(true);
    expect(lines.some((l) => l.startsWith("Max is off for video"))).toBe(true);
    expect(lines.join(" ")).not.toMatch(/Big jobs will not simplify/);
  });

  test("the levels line names models and states, never a person or an app", () => {
    const line = levelsLine(drafts({ max: withOn(draftOf(undefined, "max"), false) }), "chat", []);
    expect(line).toBe("Standard: recommended · Boost: recommended · Max: off · Simplify chat for big jobs: off. Max is for admins and anyone an admin assigns.");
    expect(levelsLine(drafts({ max: draftOf({ model: "big-one", options: {} }, "max") }), "videos", [{ id: "big-one", label: "Big One" }])).toContain("Max: Big One");
    expect(levelsLine(drafts(), "videos", [])).toContain("Max: no model of its own yet");
  });
});
