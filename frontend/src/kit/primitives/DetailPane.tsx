import type { ReactNode } from "react";
import { Button } from "@/kit/components/Button";
import { getIcon } from "@/kit/icons";
import { cn, FOCUS_RING } from "@/kit/utils";

interface DetailPaneProps {
  title: string;
  subtitle?: string;
  /** Given, a back affordance appears. docs/UI.md: on phone the right
   * pane becomes a bottom sheet and breadcrumbs become a back button, so
   * a detail view always needs a way out that is not the browser's. */
  onClose?: () => void;
  closeLabel?: string;
  /** Buttons for the thing being shown. Kept in the header rather than
   * floating over the content, so they stay reachable while the body
   * scrolls. */
  actions?: ReactNode;
  children: ReactNode;
}

// docs/UI.md names DetailPane as a kit primitive: the "one thing, in
// full" half of a list-plus-detail page, and the shape the shell's right
// pane renders into. Content-agnostic - it owns the header, the back
// button and the scroll behavior, and nothing about what is being
// detailed.
//
// The body scrolls on its own rather than the page: in SplitView the
// list beside it has to stay put while the detail scrolls, which is only
// true if the scroll container is here.
export function DetailPane({ title, subtitle, onClose, closeLabel = "Back", actions, children }: DetailPaneProps) {
  const BackIcon = getIcon("chevron-left");

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex shrink-0 items-start gap-2 border-b border-[hsl(var(--border))] p-3">
        {onClose ? (
          <Button variant="ghost" size="icon" onClick={onClose} aria-label={closeLabel} className="shrink-0">
            <BackIcon className="h-5 w-5" aria-hidden />
          </Button>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="text-base font-semibold text-[hsl(var(--foreground))]">{title}</h2>
          {subtitle ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">{subtitle}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {/* The body takes a tab stop of its own: a scrollable region has
          to be reachable without a mouse (WCAG 2.2 AA, 2.1.1), and
          Safari - the iPhone and iPad PWA's engine, not an edge case
          here - does not make keyboard-scrollable containers focusable
          by itself the way Chrome and Firefox now do. Same reasoning as
          MediaShelf's rail. */}
      <div tabIndex={0} className={cn("min-h-0 flex-1 overflow-y-auto p-4", FOCUS_RING)}>
        {children}
      </div>
    </div>
  );
}
