import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./nextChatTouchTargets.css", import.meta.url), "utf8");

// happy-dom does not lay out CSS, so this pins the rule text: on a touch
// device (coarse pointer) every message action button, the user-message ones
// and the branch picker included, reaches a 44px hit area without changing
// how the compact icons look.
describe("nextChatTouchTargets.css (UI-2 message actions)", () => {
  const coarse = css.slice(css.indexOf("@media (pointer: coarse)"));

  test("has a coarse-pointer block", () => {
    expect(css).toContain("@media (pointer: coarse)");
  });

  test.each([".aui-assistant-action-bar-root", ".aui-user-action-bar-root", ".aui-branch-picker-root"])("%s buttons get a 44px hit area on touch", (root) => {
    expect(coarse).toContain(`${root} button`);
  });

  test("the extension is 44px tall", () => {
    expect(coarse).toMatch(/min-(height|width): 44px/);
  });
});
