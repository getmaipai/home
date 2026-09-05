import type { ReactNode } from "react";
import { cn, FOCUS_RING } from "@/kit/utils";

interface SplitViewProps {
  /** The index side: a List or a CardGrid, usually. */
  list: ReactNode;
  /** The detail side: a DetailPane, usually. Rendered even when nothing
   * is selected, so a caller can show its own "pick something" state on
   * the surfaces where both halves are visible at once. */
  detail: ReactNode;
  /** True when something is selected. Drives the phone swap: one column
   * on phone (docs/UI.md's density budget) means the list and the detail
   * take turns rather than sitting side by side. */
  detailOpen?: boolean;
  listLabel?: string;
  detailLabel?: string;
}

// docs/UI.md names SplitView as a kit primitive. It owns exactly one
// decision - how a list and a detail share the screen at each surface -
// and nothing else. Phone shows one at a time; tablet and desktop show
// both, the list narrower than the detail.
//
// The phone swap is CSS (`max-sm:hidden`), not a width measured in
// JavaScript: measuring would make the first paint wrong on a phone and
// would put a second, drifting definition of "phone" next to the kit's
// own (@/kit/responsive). The caller only ever says whether something is
// selected.
export function SplitView({ list, detail, detailOpen = false, listLabel, detailLabel }: SplitViewProps) {
  return (
    <div className="flex h-full min-h-0 w-full">
      <div
        // A label only means something on a labelled region; an
        // aria-label on a bare div is ignored by every screen reader.
        role={listLabel ? "region" : undefined}
        aria-label={listLabel}
        // A tab stop for the same reason DetailPane's body has one: this
        // column scrolls, and Safari will not focus it on its own.
        tabIndex={0}
        className={cn(
          "flex min-h-0 min-w-0 flex-col overflow-y-auto",
          FOCUS_RING,
          "w-full sm:w-2/5 sm:border-r sm:border-[hsl(var(--border))] lg:w-1/3",
          detailOpen && "max-sm:hidden",
        )}
      >
        {list}
      </div>
      <div
        role={detailLabel ? "region" : undefined}
        aria-label={detailLabel}
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col",
          !detailOpen && "max-sm:hidden",
        )}
      >
        {detail}
      </div>
    </div>
  );
}
