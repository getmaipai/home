import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as RadixPopover from "@radix-ui/react-popover";
import { Button } from "@/kit/ui/button";
import { getIcon } from "@/kit/icons";
import { useToast } from "@/kit/primitives/Toast";
import { pauseTvNavForOverlay } from "@/shell/tvNav";
import { api, type NotificationDeliveryView } from "@/lib/api";

const POLL_MS = 15_000;
const QUERY_KEY = ["notifications"];

// The header half of the pending-list surface (getmaipai/.github/docs/
// NOTIFICATIONS.md: "the shell's notification center"), and the one
// place a new arrival becomes a Toast - lib/notifications.ts's own
// `in_app` channel is just a persisted row; this is what turns "a new
// row exists" into something a person actually notices without having
// to open the bell. Not a Dialog (docs/MODALS.md): a non-modal Popover,
// since browsing or dismissing notifications never blocks the rest of
// the page.
export function NotificationBell() {
  const queryClient = useQueryClient();
  // The data layer (docs/plans/session-b-ui.md step 3) owns the poll now
  // - `refetchInterval` replaces the hand-rolled `setInterval`, and a
  // failed tick already leaves `data` as whatever it last was rather than
  // throwing away the pending list, the same "never surface the
  // plumbing's own hiccups as a header error" behavior the old catch
  // block wrote out by hand.
  const query = useQuery<NotificationDeliveryView[]>({
    queryKey: QUERY_KEY,
    queryFn: () => api.notifications(),
    refetchInterval: POLL_MS,
  });
  const items = query.data ?? [];
  const [open, setOpen] = useState(false);
  const seenIds = useRef<Set<string> | null>(null);
  const { push } = useToast();
  const BellIcon = getIcon("bell");

  useEffect(() => {
    if (!query.data) return;
    if (seenIds.current === null) {
      // First load: everything already pending is real history, not a
      // "just arrived" toast flood the moment the page opens.
      seenIds.current = new Set(query.data.map((n) => n.id));
      return;
    }
    for (const n of query.data) {
      if (!seenIds.current.has(n.id)) {
        seenIds.current.add(n.id);
        push(n.text);
      }
    }
  }, [query.data, push]);

  // useMutation, not a bare optimistic `setQueryData` plus a hand-rolled
  // try/catch (a code review, 2026-09-05, found this the one write in
  // the migrated pages not using the mutation the others had already
  // established): `onMutate` cancels any poll already in flight before
  // applying the optimistic removal, and `onSettled` always refetches
  // once the dismiss call resolves either way - both close the same real
  // race, a `refetchInterval` tick landing between the optimistic removal
  // and the dismiss actually reaching the server, which could otherwise
  // bring a just-dismissed notification back.
  const dismissMutation = useMutation({
    mutationFn: (id: string) => api.dismissNotification(id),
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const previous = queryClient.getQueryData<NotificationDeliveryView[]>(QUERY_KEY);
      queryClient.setQueryData<NotificationDeliveryView[]>(QUERY_KEY, (prev) => (prev ?? []).filter((n) => n.id !== id));
      return { previous };
    },
    onError: (_err, _id, context) => {
      // A failed dismiss restores exactly what was there before, rather
      // than corrupting local state with an optimistic removal the
      // server never actually applied.
      if (context?.previous) queryClient.setQueryData(QUERY_KEY, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  return (
    <RadixPopover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        pauseTvNavForOverlay(next);
      }}
    >
      <RadixPopover.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Notifications${items.length > 0 ? ` (${items.length} pending)` : ""}`} className="relative">
          <BellIcon className="h-5 w-5" aria-hidden />
          {items.length > 0 ? (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-xs text-destructive-foreground">
              {items.length}
            </span>
          ) : null}
        </Button>
      </RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          align="end"
          sideOffset={8}
          className="z-40 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card p-2 text-card-foreground shadow-lg"
        >
          {items.length === 0 ? (
            <p className="px-2 py-3 text-base text-muted-foreground">Nothing pending.</p>
          ) : (
            <div className="flex flex-col divide-y divide-border">
              {items.map((n) => (
                <div key={n.id} className="flex items-start justify-between gap-2 py-2 px-2">
                  <p className="text-base">{n.text}</p>
                  {/* 48px minimum, not "sm": this is the only way to
                      dismiss a notification, the same accessibility
                      floor docs/UI.md's 2026-09-05 audit already
                      established for a sole-path action. */}
                  <Button
                    variant="ghost"
                    onClick={() => dismissMutation.mutate(n.id)}
                    className="shrink-0 px-3 text-sm text-muted-foreground"
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
