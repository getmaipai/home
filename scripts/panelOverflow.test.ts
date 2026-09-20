import { describe, test, expect } from "bun:test";
import { findOverflowingPanels } from "./panelOverflow";

// The regression test the screenshot pipeline's own overflow check
// needed (owner finding, "The phone composition," 2026-09-20): the old
// check only ever looked at document.documentElement.scrollWidth, so a
// card whose own content ran past its own right edge - never the
// page's - shipped clean. This proves the widened check actually
// catches that seed, once, as a real test rather than a one-off manual
// capture read.
describe("findOverflowingPanels", () => {
  test("catches a panel whose own content runs past its own right edge", () => {
    document.body.innerHTML = `
      <div style="width: 300px;">
        <div id="card" style="width: 200px; overflow: hidden;">
          <span style="display: inline-block; width: 400px;">a memory title much too long for its own card</span>
        </div>
      </div>
    `;
    const card = document.getElementById("card")!;
    Object.defineProperty(card, "clientWidth", { value: 200, configurable: true });
    Object.defineProperty(card, "scrollWidth", { value: 400, configurable: true });

    const offenders = findOverflowingPanels();
    expect(offenders).toContain("div#card");
  });

  test("does not flag a page with no overflowing panel", () => {
    document.body.innerHTML = `<div style="width: 300px;"><div style="width: 200px;"><span>fits fine</span></div></div>`;
    expect(findOverflowingPanels()).toEqual([]);
  });

  test("skips a deliberately horizontal-scrolling shelf and its children", () => {
    document.body.innerHTML = `
      <div class="overflow-x-auto" id="shelf" style="width: 200px;">
        <div id="column" style="width: 900px;"><span>one long shelf row of cards</span></div>
      </div>
    `;
    const shelf = document.getElementById("shelf")!;
    const column = document.getElementById("column")!;
    Object.defineProperty(shelf, "clientWidth", { value: 200, configurable: true });
    Object.defineProperty(shelf, "scrollWidth", { value: 900, configurable: true });
    Object.defineProperty(column, "clientWidth", { value: 900, configurable: true });
    Object.defineProperty(column, "scrollWidth", { value: 900, configurable: true });

    expect(findOverflowingPanels()).toEqual([]);
  });
});
