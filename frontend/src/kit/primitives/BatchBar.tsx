import type { ReactNode } from "react";
import { Button } from "@/kit/ui/button";

interface BatchBarProps {
  count: number;
  onExit: () => void;
  /** Destructive/other batch actions (a "Remove selected" button, and
   * later a "Clear all"). Disabling them at `count === 0` is the
   * caller's job, since some actions (clear-all) make sense with
   * nothing selected. */
  children: ReactNode;
}

/** The row that appears once a list enters select mode: a count of what
 * is selected, the batch actions, and a way out. docs/UI.md's Batch
 * actions rule ("the kit owns the pattern... so a package never builds
 * its own") and docs/BACKLOG.md's own "kit owns the batch-selection
 * pattern" item name this exact lift: `PeoplePage.tsx` hand-rolled this
 * row, Memory is its second consumer, and a second consumer is the
 * point this becomes a kit primitive rather than a copy. Entering select
 * mode and the destructive confirmation stay page-specific (their
 * wording differs per list); this is only the bar itself. */
export function BatchBar({ count, onExit, children }: BatchBarProps) {
  return (
    // `self-start`: found live (2026-09-05, docs/plans/session-b-ui.md
    // step 5) - a flex-column caller (kit/schema/NodeRenderer.tsx's list
    // node; any hand-written page stacking this above a List the same
    // way) defaults its children to `align-items: stretch`, which
    // otherwise stretches this bar to the FULL cross-axis width and, for
    // `SelectModeToggle` below (a bare Button with no wrapping row of its
    // own), centers its short label in all that extra space - reading as
    // an oversized, wrongly-centered heading rather than a compact
    // toolbar row. Neither component should ever depend on its caller
    // remembering `items-start`.
    <div className="flex flex-wrap items-center gap-2 self-start" role="toolbar" aria-label="Batch actions">
      <span className="text-base text-muted-foreground">{count} selected</span>
      {children}
      <Button variant="ghost" onClick={onExit}>
        Done
      </Button>
    </div>
  );
}

interface SelectModeToggleProps {
  label: string;
  onClick: () => void;
}

/** The button that enters select mode. Its own component only so every
 * list's entry point looks and behaves the same way. */
export function SelectModeToggle({ label, onClick }: SelectModeToggleProps) {
  return (
    // `self-start`: same fix, same reason as BatchBar's own root above -
    // a bare Button with no row of its own is the shape most exposed to
    // a flex-column caller's default stretch.
    <Button variant="ghost" onClick={onClick} className="self-start">
      {label}
    </Button>
  );
}
