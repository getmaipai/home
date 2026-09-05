import { useEffect, useRef, useState } from "react";
import * as RadixPopover from "@radix-ui/react-popover";
import { Button } from "@/kit/ui/button";
import { getIcon } from "@/kit/icons";
import { useToast } from "@/kit/primitives/Toast";
import { api, type NotificationDeliveryView } from "@/lib/api";

const POLL_MS = 15_000;

// The header half of the pending-list surface (getmaipai/.github/docs/
// NOTIFICATIONS.md: "the shell's notification center"), and the one
// place a new arrival becomes a Toast - lib/notifications.ts's own
// `in_app` channel is just a persisted row; this is what turns "a new
// row exists" into something a person actually notices without having
// to open the bell. Not a Dialog (docs/MODALS.md): a non-modal Popover,
// since browsing or dismissing notifications never blocks the rest of
// the page.
export function NotificationBell() {
  const [items, setItems] = useState<NotificationDeliveryView[]>([]);
  const [open, setOpen] = useState(false);
  const seenIds = useRef<Set<string> | null>(null);
  const { push } = useToast();
  const BellIcon = getIcon("bell");

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const pending = await api.notifications();
        if (cancelled) return;
        if (seenIds.current === null) {
          // First load: everything already pending is real history, not
          // a "just arrived" toast flood the moment the page opens.
          seenIds.current = new Set(pending.map((n) => n.id));
        } else {
          for (const n of pending) {
            if (!seenIds.current.has(n.id)) {
              seenIds.current.add(n.id);
              push(n.text);
            }
          }
        }
        setItems(pending);
      } catch {
        // A failed poll tick is silently skipped, not surfaced as an
        // error banner in the header - the next tick tries again, and a
        // household member browsing the app is never interrupted by the
        // notification system's own plumbing failing quietly in the
        // background.
      }
    }

    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [push]);

  async function handleDismiss(id: string) {
    setItems((prev) => prev.filter((n) => n.id !== id));
    try {
      await api.dismissNotification(id);
    } catch {
      // A failed dismiss just means it reappears on the next poll tick
      // rather than corrupting local state with an optimistic removal
      // the server never actually applied.
    }
  }

  return (
    <RadixPopover.Root open={open} onOpenChange={setOpen}>
      <RadixPopover.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Notifications${items.length > 0 ? ` (${items.length} pending)` : ""}`} className="relative">
          <BellIcon className="h-5 w-5" aria-hidden />
          {items.length > 0 ? (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--destructive)] px-1 text-[10px] text-[var(--destructive-foreground)]">
              {items.length}
            </span>
          ) : null}
        </Button>
      </RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          align="end"
          sideOffset={8}
          className="z-40 w-80 max-w-[calc(100vw-2rem)] rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-2 text-[var(--card-foreground)] shadow-lg"
        >
          {items.length === 0 ? (
            <p className="px-2 py-3 text-base text-[var(--muted-foreground)]">Nothing pending.</p>
          ) : (
            <div className="flex flex-col divide-y divide-[var(--border)]">
              {items.map((n) => (
                <div key={n.id} className="flex items-start justify-between gap-2 py-2 px-2">
                  <p className="text-base">{n.text}</p>
                  {/* 48px minimum, not "sm": this is the only way to
                      dismiss a notification, the same accessibility
                      floor docs/UI.md's 2026-09-05 audit already
                      established for a sole-path action. */}
                  <Button
                    variant="ghost"
                    onClick={() => handleDismiss(n.id)}
                    className="shrink-0 px-3 text-sm text-[var(--muted-foreground)]"
                  >
                    Dismiss
                  </Button>
                </div>
              ))}
            </div>
          )}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
