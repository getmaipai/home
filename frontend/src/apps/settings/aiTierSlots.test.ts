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

  test("only levels something reads are offered: chat and voice have Standard alone (chat adds Reduced), music has no Max", () => {
    expect(configurableTiers("chat")).toEqual(["standard", "reduced"]);
    expect(configurableTiers("voice")).toEqual(["standard"]);
    expect(configurableTiers("music")).toEqual(["standard", "boost"]);
    expect(consequences(drafts({ max: withOn(draftOf(undefined, "max"), false), boost: withOn(draftOf(undefined, "boost"), false) }), "voice", "Voice")).toEqual([]);
    expect(levelsLine(drafts(), "chat", [])).toBe("Standard: recommended · Simplify chat for big jobs: off.");
  });

  test("only options something reads are offered, with their types from the spec", () => {
    expect(optionDefs("video").map((o) => o.id)).toEqual(["resolution", "length_seconds"]);
    expect(optionDefs("video").find((o) => o.id === "length_seconds")?.type).toBe("number");
    for (const category of ["chat", "image", "music", "voice"]) expect(optionDefs(category)).toEqual([]);
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
    const line = levelsLine(drafts({ max: withOn(draftOf(undefined, "max"), false) }), "videos", []);
    expect(line).toBe("Standard: recommended · Boost: recommended · Max: off. Max is for admins and anyone an admin assigns.");
    expect(levelsLine(drafts({ max: draftOf({ model: "big-one", options: {} }, "max") }), "videos", [{ id: "big-one", label: "Big One" }])).toContain("Max: Big One");
    expect(levelsLine(drafts(), "videos", [])).toContain("Max: no model of its own yet");
  });
});
