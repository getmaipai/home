import { describe, expect, test } from "bun:test";
import { SURFACE_MIN_WIDTH_PX, GRID_COLUMNS, SHELF_ITEM_WIDTH } from "@/kit/responsive";

const tokens = await Bun.file(new URL("./tokens.css", import.meta.url)).text();

function pinnedBreakpoint(name: string): number {
  const match = tokens.match(new RegExp(`--breakpoint-${name}:\\s*(\\d+)px`));
  if (!match?.[1]) throw new Error(`--breakpoint-${name} is not pinned in tokens.css`);
  return Number(match[1]);
}

// docs/UI.md: "one set of breakpoints owned by the kit... packages never
// write a breakpoint." Two files have to agree for that to be true - the
// constants here and the Tailwind variants the primitives actually
// render with - so this is the test that makes the kit's ownership real
// instead of a comment. A code review (2026-09-05) pointed out that the
// constants were decorative until something checked them.
describe("the kit's surfaces", () => {
  test("tablet starts where tokens.css pins Tailwind's sm:", () => {
    expect(pinnedBreakpoint("sm")).toBe(SURFACE_MIN_WIDTH_PX.tablet);
  });

  test("desktop starts where tokens.css pins Tailwind's lg:", () => {
    expect(pinnedBreakpoint("lg")).toBe(SURFACE_MIN_WIDTH_PX.desktop);
  });

  test("phone is the unprefixed base, so it has no breakpoint at all", () => {
    expect(SURFACE_MIN_WIDTH_PX.phone).toBe(0);
  });

  // md: and xl: are not surfaces (responsive.ts says so). A primitive
  // reaching for one is writing a breakpoint the kit does not own.
  test("no density budget uses a variant that is not a surface", () => {
    for (const classes of [...Object.values(GRID_COLUMNS), ...Object.values(SHELF_ITEM_WIDTH)]) {
      expect(classes).not.toMatch(/\b(md|xl|2xl):/);
    }
  });

  test("every budget steps through all three surfaces", () => {
    for (const classes of [...Object.values(GRID_COLUMNS), ...Object.values(SHELF_ITEM_WIDTH)]) {
      expect(classes).toMatch(/\bsm:/);
      expect(classes).toMatch(/\blg:/);
    }
  });
});
