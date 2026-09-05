import type { ReactNode } from "react";
import { cn, FOCUS_RING } from "@/kit/utils";

interface CardProps {
  children: ReactNode;
  /** Given, the whole card becomes one button. Absent, it is a plain
   * surface - a card is not a control unless something happens when you
   * press it (docs/UI.md > patterns, GOV.UK first in precedence). */
  onSelect?: () => void;
  /** Accessible name. Needed whenever the card's own content is an image
   * or otherwise has no readable text of its own. It names the button
   * when the card is one, and a labelled group when it is not - a code
   * review (2026-09-05) found the non-interactive branch silently
   * dropping it, which left a caller believing its cards were named
   * when they had no accessible text at all. */
  label?: string;
  selected?: boolean;
  className?: string;
}

// The one card surface in the kit. CardGrid and MediaShelf both draw
// their items with it rather than each repeating a border, a radius, a
// hover and a focus ring (org standard 1: a second copy of anything is
// wrong even when it is faster). Callers pass content, never chrome.
export function Card({ children, onSelect, label, selected, className }: CardProps) {
  const surface = cn(
    "overflow-hidden rounded-[var(--radius)] border bg-[hsl(var(--card))] text-left text-[hsl(var(--card-foreground))]",
    selected ? "border-[hsl(var(--primary))]" : "border-[hsl(var(--border))]",
  );

  if (!onSelect) {
    return (
      // `aria-label` on a bare div is ignored; it needs a role to land on.
      <div role={label ? "group" : undefined} aria-label={label} className={cn(surface, className)}>
        {children}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={label}
      aria-current={selected ? "true" : undefined}
      // 48px is the kit's hard minimum touch target and the focus ring
      // is required to be visible (docs/UI.md, WCAG 2.2 AA 2.4.13/2.5.5).
      // The caller's className comes last in both branches, so what it
      // overrides does not depend on whether the card is interactive.
      className={cn(surface, "block min-h-12 w-full transition-opacity hover:opacity-90", FOCUS_RING, className)}
    >
      {children}
    </button>
  );
}
