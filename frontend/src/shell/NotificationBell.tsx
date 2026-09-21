import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as RadixPopover from "@radix-ui/react-popover";
import { Link } from "react-router-dom";
import { Button } from "@maipai/ui/src/ui/button";
import { getIcon } from "@maipai/ui/src/icons";
import { useToast } from "@maipai/ui/src/primitives/Toast";
import { pauseTvNavForOverlay } from "@maipai/ui/src/tvNav";
import { api, type NotificationDeliveryView } from "@/lib/api";

// Exported: chatMemoryChip.tsx reads this same cached list (the "memory
// updated" chip, getmaipai/home#64) and polls it on the same schedule,
// rather than duplicating the query key/interval and risking the two
// drifting apart.
export const POLL_MS = 15_000;
export const NOTIFICATIONS_QUERY_KEY = ["notifications"];
// NotificationsPage.tsx's own history query key, exported from here (not
// the other way around) so this shell-level file never has to import
// from an app page: a dismiss from EITHER surface has to invalidate both
// caches, or whichever one isn't showing the dismiss keeps a stale row
// until an unrelated remount forces a refetch (a code review, 2026-09-06,
// caught this file only ever invalidating its own).
export const NOTIFICATIONS_HISTORY_QUERY_KEY = ["notifications-history"];
const QUERY_KEY = NOTIFICATIONS_QUERY_KEY;

// The one place both the bell's own popover and the phone header's
// avatar dot/count (HOME-UI-02f) read pending notifications from - the
// same queryKey/queryFn/refetchInterval retyped in each caller was a
// real drift risk a code review caught (a future change to the query
// touching one copy and not the other), not just an efficiency nit:
// react-query already dedupes identical queryKeys to one fetch/poll
// regardless of how many components call this, so this exists for one
// definition, not for caching.
function useNotificationsQuery() {
  return useQuery<NotificationDeliveryView[]>({
    queryKey: QUERY_KEY,
    queryFn: () => api.notifications(),
    refetchInterval: POLL_MS,
  });
}

// The phone header's own avatar dot (HOME-UI-02f: "the bell's count
// shows as a dot on the avatar") needs the pending count without
// mounting this whole bell.
export function usePendingNotificationCount(): number {
  return useNotificationsQuery().data?.length ?? 0;
}

// A new arrival becoming a Toast - lib/notifications.ts's own `in_app`
// channel is just a persisted row; this is what turns "a new row
// exists" into something a person actually notices without having to
// open the bell. Split out of NotificationBell (a code review, HOME-
// UI-02f: the phone header fold hides that whole component on phone,
// which silently took this toast behavior with it - the only place it
// lived) and mounted once, unconditionally, in AppShell.tsx, so a toast
// fires the same way regardless of whether the bell icon itself is
// visible on screen right now. Renders nothing - `useToast()`'s own
// provider does the actual on-screen work.
export function NotificationToaster(): null {
  const query = useNotificationsQuery();
  const seenIds = useRef<Set<string> | null>(null);
  const { push } = useToast();

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
        // Jesse, 2026-09-13: no toast for a memory save. When the
        // originating message is still on screen, chatMemoryChip.tsx's
        // "Memory updated" chip already shows it there; when it isn't
        // (the judge can finish well after someone has moved on to
        // another page - memoryJudge.ts runs off a background queue),
        // this bell's own badge and pending list are the fallback - a
        // real delivery still lands there and in the 30-day history,
        // only the toast itself is skipped.
        if (!n.toast) continue;
        push(n.text);
      }
    }
  }, [query.data, push]);

  return null;
}

// The header half of the pending-list surface (getmaipai/.github/docs/
// NOTIFICATIONS.md: "the shell's notification center") - browsing and
// dismissing. Not a Dialog (docs/MODALS.md): a non-modal Popover, since
// doing either never blocks the rest of the page.
export function NotificationBell() {
  const queryClient = useQueryClient();
  const query = useNotificationsQuery();
  const items = query.data ?? [];
  const [open, setOpen] = useState(false);
  const BellIcon = getIcon("bell");

  // Shared by both dismiss mutations below (a review caught them
  // duplicating this restore-on-error/invalidate-both-caches logic
  // almost verbatim, the exact kind of drift this file's own header
  // comment already warns about - a fix applied to only one copy would
  // reintroduce the stale-row bug that comment describes, for whichever
  // path didn't get it).
  function restoreOnError(context: { previous: NotificationDeliveryView[] | undefined } | undefined) {
    // A failed dismiss restores exactly what was there before, rather
    // than corrupting local state with an optimistic removal the
    // server never actually applied.
    if (context?.previous) queryClient.setQueryData(QUERY_KEY, context.previous);
  }
  function invalidateBothCaches() {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_HISTORY_QUERY_KEY }),
    ]);
  }

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
    onError: (_err, _id, context) => restoreOnError(context),
    onSettled: invalidateBothCaches,
  });

  // Lane 15 (Jesse's ask from live use): "Dismiss all" for the pending
  // list here - same optimistic-then-reconcile shape as the single
  // dismiss above, `{ all: true }` since this popover only ever shows
  // what's currently pending (no 30-day window the way the history page
  // has), so "all" here already means exactly what's on screen. Open to
  // every signed-in person, adults and children alike - a notification
  // is inherently personal (getmaipai/.github/docs/NOTIFICATIONS.md),
  // the same posture the single-dismiss route already holds; nothing
  // here needs a role check.
  const dismissAllMutation = useMutation({
    mutationFn: () => api.dismissNotifications({ all: true }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const previous = queryClient.getQueryData<NotificationDeliveryView[]>(QUERY_KEY);
      queryClient.setQueryData<NotificationDeliveryView[]>(QUERY_KEY, []);
      return { previous };
    },
    onError: (_err, _vars, context) => restoreOnError(context),
    onSettled: invalidateBothCaches,
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
            <span className="absolute right-0.5 top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-base leading-none text-destructive-foreground">
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
              <div className="flex items-center justify-end px-2 pb-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => dismissAllMutation.mutate()}
                  disabled={dismissAllMutation.isPending}
                  className="text-sm text-muted-foreground"
                >
                  {dismissAllMutation.isPending ? "Dismissing…" : "Dismiss all"}
                </Button>
              </div>
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
          {/* The thirty-day history page (session E step 5) - this popover
              only ever shows what's still pending, never a dismissed or
              already-read row, so "view history" is the one way to reach
              those at all. */}
          <div className="border-t border-border pt-1">
            <Link to="/notifications" className="block px-2 py-2 text-sm text-primary underline" onClick={() => setOpen(false)}>
              View history
            </Link>
          </div>
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
