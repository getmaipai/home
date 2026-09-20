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
  const offenders: string[] = [];
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
    if (el.clientWidth === 0) continue; // hidden or not yet laid out
    if (el.scrollWidth > el.clientWidth + 1) {
      const id = el.id ? `#${el.id}` : "";
      const cls = typeof el.className === "string" && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}` : "";
      offenders.push(`${el.tagName.toLowerCase()}${id}${cls}`);
    }
  }
  return offenders;
}
