// docs/UI.md: "Four surfaces, one set of breakpoints owned by the kit
// (phone under 640, tablet to 1024, desktop above, TV by input mode).
// Packages never write a breakpoint." This file is where the kit owns
// them, so CardGrid, MediaShelf and SplitView share one definition of
// what a surface is instead of each spelling out its own Tailwind
// variants (org standard 1: one definition, one implementation).
//
// The mapping to Tailwind v4's default variants, once, here: unprefixed
// is phone, `sm:` is tablet (>= 640), `lg:` is desktop (>= 1024). `md:`
// and `xl:` are deliberately unused - they are not surfaces.
//
// TV is missing on purpose. It is defined by input mode, not width, and
// nothing in the shell detects an input mode yet (Shell.tsx's own
// deferral list). Inventing a TV media query here would be a second,
// wrong definition to unpick later.

export const SURFACE_MIN_WIDTH_PX = {
  phone: 0,
  tablet: 640,
  desktop: 1024,
} as const;

export type Surface = keyof typeof SURFACE_MIN_WIDTH_PX;

/** The kit's density budgets. `default` is docs/UI.md's stated budget
 * verbatim (one column on phone, two on tablet, three on desktop);
 * `compact` is the same budget for tile-sized content (posters, covers,
 * album art), where three-across on a phone-width column is unreadable
 * and one-across wastes the screen. Two named budgets, not a free
 * column count, so a package still never picks a breakpoint. */
export type Density = "default" | "compact";

export const GRID_COLUMNS: Record<Density, string> = {
  default: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  compact: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5",
};

/** A shelf tile's share of the rail's width, per surface. Percentages,
 * never pixels: docs/UI.md forbids fixed widths on content, and the
 * fraction under 100% is what makes the next tile peek into view so the
 * rail reads as scrollable. */
export const SHELF_ITEM_WIDTH: Record<Density, string> = {
  default: "w-[72%] sm:w-[40%] lg:w-[27%]",
  compact: "w-[44%] sm:w-[25%] lg:w-[17%]",
};
