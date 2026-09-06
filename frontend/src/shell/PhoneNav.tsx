import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/kit/ui/sheet";
import { getIcon } from "@/kit/icons";
import { cn } from "@/kit/utils";
import { NAV_ENTRIES } from "@/shell/nav";

const BOTTOM_BAR_MAX = 5;

function isActivePath(pathname: string, to: string): boolean {
  return to === "/" ? pathname === "/" : pathname.startsWith(to);
}

// docs/UI.md's per-surface phone rule: "the sidebar collapses to a
// five-entry bottom bar... with the rest under More." Exactly five real
// pages exist today, so `overflowing` never fires yet - the mechanism is
// here for the day a sixth page registers, not invented content ahead of
// it.
export function PhoneNav() {
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const overflowing = NAV_ENTRIES.length > BOTTOM_BAR_MAX;
  const shown = overflowing ? NAV_ENTRIES.slice(0, BOTTOM_BAR_MAX - 1) : NAV_ENTRIES;
  const overflowEntries = overflowing ? NAV_ENTRIES.slice(BOTTOM_BAR_MAX - 1) : [];
  const MoreIcon = getIcon("more-horizontal");

  return (
    <>
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-background pb-[env(safe-area-inset-bottom)] sm:hidden"
      >
        {shown.map((entry) => {
          const Icon = getIcon(entry.icon);
          const active = isActivePath(location.pathname, entry.to);
          return (
            <Link
              key={entry.to}
              to={entry.to}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              <Icon className="h-5 w-5" aria-hidden />
              <span>{entry.label}</span>
            </Link>
          );
        })}
        {overflowing ? (
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className="flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs text-muted-foreground"
          >
            <MoreIcon className="h-5 w-5" aria-hidden />
            <span>More</span>
          </button>
        ) : null}
      </nav>
      {overflowing ? (
        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetContent side="bottom">
            <SheetHeader>
              <SheetTitle>More</SheetTitle>
            </SheetHeader>
            <div className="flex flex-col gap-1 p-2">
              {overflowEntries.map((entry) => {
                const Icon = getIcon(entry.icon);
                return (
                  <Link
                    key={entry.to}
                    to={entry.to}
                    onClick={() => setMoreOpen(false)}
                    className="flex min-h-12 items-center gap-3 rounded-lg px-3 hover:bg-muted"
                  >
                    <Icon className="h-5 w-5" aria-hidden />
                    <span className="text-base">{entry.label}</span>
                  </Link>
                );
              })}
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
    </>
  );
}
