import { describe, test, expect } from "bun:test";
import { findClippedStrips, findOverflowingPanels } from "./panelOverflow";

// Stands in for happy-dom's own always-zeroed getBoundingClientRect()
// (this codebase's established reason real layout checks like this one
// live here, exercised against a mocked rect, rather than trusting
// happy-dom to lay anything out for real).
function mockRect(el: Element, rect: { left: number; right: number; top?: number; bottom?: number }): void {
  const top = rect.top ?? 0;
  const bottom = rect.bottom ?? top;
  el.getBoundingClientRect = () => ({ ...rect, top, bottom, width: rect.right - rect.left, height: bottom - top, x: rect.left, y: top, toJSON() { return this; } });
  // `findOverflowingPanels`'s own `el.clientWidth === 0` guard (skip
  // hidden/not-yet-laid-out elements) reads happy-dom's real property,
  // not the mocked rect above - zero by default, which would skip
  // every element these tests mock.
  Object.defineProperty(el, "clientWidth", { value: rect.right - rect.left, configurable: true });
}

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
      <div id="card">
        <span id="title">a memory title much too long for its own card</span>
      </div>
    `;
    mockRect(document.getElementById("card")!, { left: 0, right: 200 });
    mockRect(document.getElementById("title")!, { left: 0, right: 400 });

    const offenders = findOverflowingPanels();
    expect(offenders).toContain("div#card");
  });

  test("does not flag a page with no overflowing panel", () => {
    document.body.innerHTML = `<div id="card"><span id="title">fits fine</span></div>`;
    mockRect(document.getElementById("card")!, { left: 0, right: 200 });
    mockRect(document.getElementById("title")!, { left: 0, right: 150 });

    expect(findOverflowingPanels()).toEqual([]);
  });

  // A real page against a real capture (settings-devices-far-dark,
  // 2026-09-20): one genuinely-too-wide rail pill pushed its own
  // parents' scrollWidth past their clientWidth too (a child's content
  // size is part of a parent's), so the raw scan reported the same
  // one bug a dozen times up the ancestor chain, drowning the actual
  // culprit in noise.
  test("reports only the innermost offender when its overflow pushes every ancestor's box too", () => {
    document.body.innerHTML = `
      <div id="grandparent">
        <div id="parent">
          <div id="child">
            <span id="title">a rail pill's own content, too wide for its pill</span>
          </div>
        </div>
      </div>
    `;
    for (const id of ["grandparent", "parent", "child"]) mockRect(document.getElementById(id)!, { left: 0, right: 300 });
    mockRect(document.getElementById("title")!, { left: 0, right: 500 });

    const offenders = findOverflowingPanels();
    expect(offenders).toEqual(["div#child"]);
  });

  // Found live at 1920px (`far`): the kit's own `hitArea()` (utils.ts)
  // extends a small control's real, hit-testable click region past its
  // visible box with a transparent, contentless `::before` pseudo-
  // element - real layout, but never a visible defect, and every
  // hitArea()-using control in the rail and header tripped the old
  // scrollWidth-based check at once for it. Pseudo-elements never
  // appear in `el.children`, so a check built on real children's own
  // boxes doesn't see them at all.
  test("does not flag a control whose own pseudo-element hit-area extends past its box", () => {
    document.body.innerHTML = `<button id="icon-button"><svg id="icon"></svg></button>`;
    mockRect(document.getElementById("icon-button")!, { left: 100, right: 132 });
    mockRect(document.getElementById("icon")!, { left: 108, right: 124 });

    expect(findOverflowingPanels()).toEqual([]);
  });

  // The kit's own rail nav wrapper (nav-main.tsx's `[data-nav-mode=
  // "pinned"]`) sits inside its own scrolling parent and can read a
  // few px "over" with zero visible defect once that parent's own
  // scrollbar appears (found live at desktop/far, both dark) - the
  // wrapper itself is excluded by its own stable attribute, but a
  // real overflow on something INSIDE it (a pill's own label) still
  // has to be caught.
  test("excludes the rail wrapper itself but still catches real overflow inside it", () => {
    document.body.innerHTML = `
      <div data-nav-mode="pinned" id="wrapper">
        <div id="pill">
          <span id="label">a pill label far too long for its own pill</span>
        </div>
      </div>
    `;
    mockRect(document.getElementById("wrapper")!, { left: 0, right: 300 });
    // The pill's own box is wider than the wrapper's (a real quirk
    // this test reproduces on purpose, per the scrollbar reasoning
    // above) - proves the wrapper itself is skipped, not just that it
    // happens not to trip the check.
    mockRect(document.getElementById("pill")!, { left: 0, right: 350 });
    mockRect(document.getElementById("label")!, { left: 0, right: 500 });

    const offenders = findOverflowingPanels();
    expect(offenders).toEqual(["div#pill"]);
    expect(offenders).not.toContain("div#wrapper");
  });

  test("skips a deliberately horizontal-scrolling shelf and its children", () => {
    document.body.innerHTML = `
      <div class="overflow-x-auto" id="shelf">
        <div id="column"><span>one long shelf row of cards</span></div>
      </div>
    `;
    mockRect(document.getElementById("shelf")!, { left: 0, right: 200 });
    mockRect(document.getElementById("column")!, { left: 0, right: 900 });

    expect(findOverflowingPanels()).toEqual([]);
  });

  test("does not mistake the chat thread viewport's intentional vertical scroll for a clipped horizontal shelf", () => {
    document.body.innerHTML = `
      <div class="overflow-x-auto overflow-y-scroll" data-slot="aui_thread-viewport" id="thread">
        <div id="messages">a long conversation</div>
      </div>
    `;
    mockRect(document.getElementById("thread")!, { left: 0, right: 300, top: 0, bottom: 200 });
    mockRect(document.getElementById("messages")!, { left: 0, right: 300, top: 0, bottom: 900 });

    expect(findClippedStrips()).toBe(0);
  });

  test("still catches a horizontal shelf whose content extends below its own box", () => {
    document.body.innerHTML = `
      <div class="overflow-x-auto" id="shelf">
        <div id="column">a clipped shelf row</div>
      </div>
    `;
    mockRect(document.getElementById("shelf")!, { left: 0, right: 300, top: 0, bottom: 200 });
    mockRect(document.getElementById("column")!, { left: 0, right: 300, top: 0, bottom: 260 });

    expect(findClippedStrips()).toBe(1);
  });
});
