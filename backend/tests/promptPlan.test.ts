// VIDEO-LORA-09: the prompt plan table (design 6.1, test 12). Pure: no database.
import { describe, expect, test } from "bun:test";
import { addedForLine, buildPromptPlan, strengthFor, TWO_AT_A_TIME_LINE, TWO_CHARACTERS_LINE, TOO_MUCH_ADDED_LINE, type StyleForPlan } from "@/lib/loras/promptPlan";

let n = 0;
function style(over: Partial<StyleForPlan> = {}): StyleForPlan {
  n += 1;
  return { id: `lora-s${n}`, name: `Style ${n}`, kind: "style", trigger_words: [], trigger_position: "start", positive_addins: [], negative_addins: [], avoid_as_positive: [], strength: { default: 1, min: 0.2, max: 1.5 }, ...over };
}
const words = "A fox walks through snow.";

describe("buildPromptPlan", () => {
  test("no styles: the words are the prompt, byte for byte", () => {
    const plan = buildPromptPlan({ words: "  A fox,  runs  ", styles: [] });
    expect(plan).toMatchObject({ ok: true, prompt: "  A fox,  runs  ", changed: false, loras: [] });
  });

  test("start trigger goes first, end trigger and add-ins follow the words, in that order", () => {
    const a = style({ trigger_words: ["clay look"], positive_addins: ["soft studio light"] });
    const b = style({ trigger_words: ["stop motion"], trigger_position: "end", positive_addins: ["tiny seams"] });
    const plan = buildPromptPlan({ words: "a fox runs", styles: [a, b] });
    expect(plan).toMatchObject({ ok: true, prompt: "clay look, a fox runs, stop motion, soft studio light, tiny seams" });
  });

  test("the person's words survive unchanged inside the prompt", () => {
    const plan = buildPromptPlan({ words: words, styles: [style({ trigger_words: ["clay look"] })] });
    if (!plan.ok) throw new Error("expected ok");
    expect(plan.prompt).toContain(words);
    expect(plan.prompt).toBe(`clay look, ${words}`);
  });

  test("a trigger the person already wrote is not added again (any letter case)", () => {
    const plan = buildPromptPlan({ words: "a Clay Look fox", styles: [style({ trigger_words: ["clay look"] })] });
    expect(plan).toMatchObject({ ok: true, prompt: "a Clay Look fox", changed: false });
  });

  test("duplicate triggers and add-ins across stacked styles are added once, by the first style", () => {
    const a = style({ name: "A", trigger_words: ["glow"], positive_addins: ["warm light"] });
    const b = style({ name: "B", trigger_words: ["Glow", "film grain"], positive_addins: ["warm  LIGHT", "deep shadows"] });
    const plan = buildPromptPlan({ words: "a fox", styles: [a, b] });
    if (!plan.ok) throw new Error("expected ok");
    expect(plan.prompt).toBe("glow, film grain, a fox, warm light, deep shadows");
    expect(plan.lines[0]!.phrases.map((p) => p.text)).toEqual(["glow", "warm light"]);
    expect(plan.lines[1]!.phrases.map((p) => p.text)).toEqual(["film grain", "deep shadows"]);
    expect(addedForLine(plan.lines)).toBe("Added for A (2 phrases) and B (2 phrases)");
  });

  test("the same style chosen twice is one style", () => {
    const a = style({ trigger_words: ["clay look"] });
    const plan = buildPromptPlan({ words: "a fox", styles: [a, a] });
    expect(plan).toMatchObject({ ok: true, prompt: "clay look, a fox" });
    if (plan.ok) expect(plan.loras).toHaveLength(1);
  });

  test("three styles are refused with a plain line", () => {
    const plan = buildPromptPlan({ words: "a fox", styles: [style(), style(), style()] });
    expect(plan).toEqual({ ok: false, code: "too_many", line: TWO_AT_A_TIME_LINE });
  });

  test("two character styles are refused; one character with one style is fine", () => {
    const c1 = style({ kind: "character" });
    const c2 = style({ kind: "character" });
    expect(buildPromptPlan({ words: "a fox", styles: [c1, c2] })).toEqual({ ok: false, code: "two_characters", line: TWO_CHARACTERS_LINE });
    expect(buildPromptPlan({ words: "a fox", styles: [c1, style()] }).ok).toBe(true);
  });

  test("avoid and say instead: the say-instead words are positive text when the engine has no negative prompt", () => {
    const a = style({ negative_addins: ["blurry"], avoid_as_positive: ["sharp focus"] });
    const plan = buildPromptPlan({ words: "a fox", styles: [a], negativePrompt: "none" });
    expect(plan).toMatchObject({ ok: true, prompt: "a fox, sharp focus", negative: null });
  });

  test("avoid and say instead: the negative text is sent only when the engine reports NAG, and the positive prompt stays clean", () => {
    const a = style({ negative_addins: ["blurry", "extra fingers"], avoid_as_positive: ["sharp focus"] });
    const plan = buildPromptPlan({ words: "a fox", styles: [a], negativePrompt: "nag" });
    expect(plan).toMatchObject({ ok: true, prompt: "a fox", negative: "blurry, extra fingers" });
  });

  test("added text over 400 characters across two styles fails the plan", () => {
    const a = style({ positive_addins: ["a".repeat(120), "b".repeat(120)] });
    const b = style({ positive_addins: ["c".repeat(120), "d".repeat(100)] });
    expect(buildPromptPlan({ words: "a fox", styles: [a, b] })).toEqual({ ok: false, code: "too_much_added", line: TOO_MUCH_ADDED_LINE });
  });

  test("strength: Less, Normal and More are 0.75, 1 and 1.25 of the default, held between the record's minimum and 2", () => {
    const s = style({ strength: { default: 1, min: 0.2, max: 1.5 } });
    expect(strengthFor(s, "less")).toBe(0.75);
    expect(strengthFor(s, "normal")).toBe(1);
    expect(strengthFor(s, "more")).toBe(1.25);
    expect(strengthFor(s, undefined)).toBe(1);
    const strong = style({ strength: { default: 1.8, min: 0.2, max: 2 } });
    expect(strengthFor(strong, "more")).toBe(2);
    const wide = style({ strength: { default: 1.8, min: 0, max: 2 } });
    expect(strengthFor(wide, "more")).toBe(2);
    const floor = style({ strength: { default: 0.8, min: 0.7, max: 1.5 } });
    expect(strengthFor(floor, "less")).toBe(0.7);
    const capped = style({ strength: { default: 1, min: 0, max: 1 } });
    expect(strengthFor(capped, "more")).toBe(1);
  });

  test("the plan's loras carry the clamped strength in the order chosen", () => {
    const a = style({ strength: { default: 1, min: 0, max: 1 } });
    const b = style({ strength: { default: 0.5, min: 0, max: 2 } });
    const plan = buildPromptPlan({ words: "a fox", styles: [a, b], strength: "more" });
    if (!plan.ok) throw new Error("expected ok");
    expect(plan.loras).toEqual([{ id: a.id, strength: 1 }, { id: b.id, strength: 0.625 }]);
  });
});
