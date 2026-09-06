import type { ReactNode } from "react";
import { useFocusable } from "@noriginmedia/norigin-spatial-navigation";
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
  /** `useSurface().far`, read once by the caller and passed down - a code
   * review (2026-09-06) found an earlier version calling `useSurface()`
   * inside `Card` itself, which meant a grid of N cards mounted N
   * independent `matchMedia`/window-listener subscriptions instead of
   * the one `List.tsx` already takes for its own multi-row case. Callers
   * that render exactly one Card and never pass `onSelect` (WidgetRow,
   * WidgetCard, Home's own single cards) can pass `false` - the value is
   * only ever read on the interactive branch below. */
  far?: boolean;
}

// The one card surface in the kit. CardGrid and MediaShelf both draw
// their items with it rather than each repeating a border, a radius, a
// hover and a focus ring (org standard 1: a second copy of anything is
// wrong even when it is faster). Callers pass content, never chrome.
//
// A pattern component, not `kit/ui/card.tsx` directly: shadcn's generated
// Card is a padded header/content/footer container built for structured
// layouts, and CardGrid/MediaShelf's contract is the opposite (content-
// agnostic, no assumed padding, the whole surface optionally one button).
// This reuses the kit's card tokens (`bg-card`, `text-card-foreground`,
// `border-border`) rather than reimplementing them, which is the sense in
// which it is "rebuilt on the generated components" (docs/plans/
// session-b-ui.md step 1) even though it does not render `Card` itself.
/** The far surface's card button (step 7, "every node renders its far
 * profile"): a real `useFocusable` registration, the only way a card is
 * reachable by the TV remote's arrow keys at all - Norigin's spatial map
 * only knows about nodes that registered with it, plain DOM buttons are
 * invisible to it. Kept as its own component rather than a branch inside
 * `Card` (same reason Shell.tsx's `NavItem`/`TvNavItem` are split): the
 * library's hook can't be called conditionally, and is only ever safe to
 * call after `ensureTvNavInit()` has run, which every route already
 * guarantees by rendering under `Shell` first. `shouldFocusDOMNode`
 * defaults to false (tvNav.ts), so the ring is driven by `focused`, not
 * `:focus-visible` - `FOCUS_RING` never lights up on this branch. */
function TvCardButton({
  children,
  onSelect,
  label,
  selected,
  className,
  surfaceClasses,
}: {
  children: ReactNode;
  onSelect: () => void;
  label?: string;
  selected?: boolean;
  className?: string;
  surfaceClasses: string;
}) {
  const { ref, focused } = useFocusable<HTMLButtonElement>({ onEnterPress: onSelect });
  return (
    <button
      ref={ref}
      type="button"
      onClick={onSelect}
      aria-label={label}
      aria-current={selected ? "true" : undefined}
      className={cn(
        surfaceClasses,
        "block min-h-12 w-full text-left transition-opacity hover:opacity-90",
        focused && "ring-2 ring-ring",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Card({ children, onSelect, label, selected, className, far = false }: CardProps) {
  const surfaceClasses = cn(
    "overflow-hidden rounded-lg border bg-card text-left text-card-foreground",
    selected ? "border-primary" : "border-border",
  );

  if (!onSelect) {
    return (
      // `aria-label` on a bare div is ignored; it needs a role to land on.
      <div role={label ? "group" : undefined} aria-label={label} className={cn(surfaceClasses, className)}>
        {children}
      </div>
    );
  }

  if (far) {
    return (
      <TvCardButton onSelect={onSelect} label={label} selected={selected} className={className} surfaceClasses={surfaceClasses}>
        {children}
      </TvCardButton>
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
      className={cn(surfaceClasses, "block min-h-12 w-full transition-opacity hover:opacity-90", FOCUS_RING, className)}
    >
      {children}
    </button>
  );
}
