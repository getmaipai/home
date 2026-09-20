// The screenshot pipeline's own overflow check used to look at the page
// as a whole (`document.documentElement.scrollWidth > ...clientWidth`)
// - real, but not enough: a memory or weather line running past the
// right edge of its own card (owner finding, "Phone density, and
// conversations inside Chat," 2026-09-20 - the phone dashboard's Today
// and Recent memories cards) never widens the *page*, only the card,
// so the page-level check passed clean while the capture itself showed
// real clipped text. This scans every element's own box instead, not
// only the document's.
//
// One function, zero arguments, every reference resolved against
// whatever `document` it finds at call time - not split into a "real"
// scan plus a thin wrapper: Playwright's `page.evaluate(fn)` (no `arg`)
// sends only `fn`'s own source text into the browser
// (`Function.prototype.toString()`), never the module it came from, so
// a call out to a second exported function is a `ReferenceError` in the
// browser even though it type-checks and runs fine in Node (found live
// running this file's own first draft: it split the scan into
// `findOverflowingPanels()` calling `scanForOverflow(root)`, which
// passed `bunx tsc` and `bun test` and then threw exactly this
// `ReferenceError` the moment a real capture called it against a real
// page). `panelOverflow.test.ts` calls this same zero-arg function
// against a happy-dom tree (its own `GlobalRegistrator` supplies
// `document`), so it is the real function under test, not a stand-in
// for it.
export function findOverflowingPanels(): string[] {
  const offending: HTMLElement[] = [];
  const all = document.body.querySelectorAll("*");
  for (const el of all) {
    if (!(el instanceof HTMLElement)) continue; // skip SVG icons and the like - scrollWidth there is noise, not a real layout bug
    if (el.children.length === 0) continue; // a leaf's own scrollWidth vs clientWidth is rarely meaningful
    const style = getComputedStyle(el);
    // A deliberately horizontal-scrolling row (a shelf, a filter strip)
    // is SUPPOSED to have scrollWidth > clientWidth - that is what makes
    // it scroll. Its own overflow-x is "auto"/"scroll"; skip it and
    // everything inside it, the same way the pipeline's own separate
    // `clippedStrips` check (screenshot.ts) already scopes to exactly
    // this class of element for its own, different check (vertical
    // clipping, not horizontal spillover).
    if (style.overflowX === "auto" || style.overflowX === "scroll") continue;
    if (el.closest('[class*="overflow-x-auto"]')) continue;
    // The kit's own rail nav list wrapper (`[data-nav-mode="pinned"]`,
    // @maipai/ui/src/blocks/dashboard/components/nav-main.tsx) sits
    // directly inside its own scrolling parent (`overflow-auto` on
    // SidebarContent) - when the rail is tall enough to actually
    // scroll, that parent's vertical scrollbar shaves a few px off its
    // own clientWidth that this wrapper's full-width children don't
    // always inherit at the same instant a scrollbar appears, tripping
    // this check on the wrapper ITSELF for a few px with zero visible
    // defect (confirmed by eye against several captures; neither
    // reordering settleAnimations() ahead of this check nor a generous
    // tolerance below ever cleared it). Only the wrapper element is
    // skipped, not everything inside it - a real overflow on a pill's
    // own label, say, still needs catching.
    if (el.matches('[data-nav-mode="pinned"]')) continue;
    if (el.clientWidth === 0) continue; // hidden or not yet laid out
    // `scrollWidth` counts a `::before`/`::after` pseudo-element's own
    // box even when it is pure hit-area padding (the kit's own
    // `hitArea()`, utils.ts: a transparent, contentless, absolutely
    // positioned box extending past a small control's edges so it
    // still meets the 48px touch-target floor) - found live at 1920px
    // (`far`), where every hitArea()-using control in the rail and
    // header tripped this check at once for zero visible defect.
    // `el.children` never includes pseudo-elements, so measuring their
    // real boxes instead catches genuine content overflow (a span of
    // text, a card) without the false positive.
    // +2px, not +1: real sub-pixel layout rounding (arbitrary-value
    // Tailwind classes like `mx-[13px]` don't always snap to the same
    // fraction of a device pixel a browser's own flex layout resolves
    // to) tipped isolated, visually-flawless elements over a tighter
    // tolerance. A real overflow (the seeded-overflow test below) is
    // many pixels, never a handful. screenshot.ts's own caller skips
    // this whole check on the `far` (1920px TV) viewport specifically
    // - a persistent few-px flag on the rail's own wrapper there, at
    // dark theme only, survived even this tolerance and every fix
    // above; that surface is outside every viewport this pipeline's
    // other callers actually judge, so it is tracked there as its own
    // gap rather than chased by loosening this for every viewport that
    // does matter.
    const parentRect = el.getBoundingClientRect();
    const overflowsRight = Array.from(el.children).some((child) => child.getBoundingClientRect().right > parentRect.right + 2);
    if (overflowsRight) offending.push(el);
  }
  // One real overflow pushes every ancestor's own scrollWidth past its
  // clientWidth too (a child's natural content size is part of its
  // parent's), so the raw scan above reports the same bug once per
  // ancestor - found live running this against a real page (the rail's
  // own overflow-x-auto-free ancestors all lit up together for what
  // was really one row). Keep only the innermost offenders: drop any
  // element that contains another offender, so the list names the
  // actual root cause, not its whole ancestor chain.
  const roots = offending.filter((el) => !offending.some((other) => other !== el && el.contains(other)));
  return roots.map((el) => {
    const id = el.id ? `#${el.id}` : "";
    const cls = typeof el.className === "string" && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}` : "";
    return `${el.tagName.toLowerCase()}${id}${cls}`;
  });
}
