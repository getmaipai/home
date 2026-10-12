import { describe, expect, test } from "bun:test";
import { easeChangedKeys, easeRowExtras } from "@/shell/easeRows";

const base = [
  { key: "ease.preset", value: "large", layer: "person" },
  { key: "ease.text_size", value: "preset", layer: "default" },
  { key: "ease.motion", value: "calm", layer: "person" },
  { key: "ease.spacing", value: "roomy", layer: "person", locked: true },
];

describe("ease card rows", () => {
  test("changes are the person's own non-follow values, not the Look itself", () => {
    expect(easeChangedKeys(base)).toEqual(["ease.motion", "ease.spacing"]);
  });

  test("the Look row says 'Large + 2 changes' and Back to Large resets only unlocked changes", () => {
    const reset: string[][] = [];
    const rows = easeRowExtras(base, true, (k) => reset.push(k));
    expect(rows["ease.preset"]!.note).toBe("Large + 2 changes");
    expect(rows["ease.preset"]!.action!.label).toBe("Back to Large");
    rows["ease.preset"]!.action!.onPress();
    expect(reset).toEqual([["ease.motion"]]);
  });

  test("a locked row is explained to its person and not to an admin on their page", () => {
    expect(easeRowExtras(base, true, () => {})["ease.spacing"]!.lockedReason).toContain("admin set this");
    expect(easeRowExtras(base, false, () => {})["ease.spacing"]).toBeUndefined();
  });

  test("no changes, no summary", () => {
    expect(easeRowExtras([base[0]!, base[1]!], true, () => {})["ease.preset"]).toBeUndefined();
  });
});
