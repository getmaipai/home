import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Page } from "@maipai/ui/src/primitives/Page";
import { List } from "@maipai/ui/src/primitives/List";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import { BatchBar, SelectModeToggle } from "@maipai/ui/src/primitives/BatchBar";
import { useSelectMode } from "@/kit/hooks/useSelectMode";
import { Checkbox } from "@maipai/ui/src/ui/checkbox";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { NOTIFICATIONS_QUERY_KEY, NOTIFICATIONS_HISTORY_QUERY_KEY } from "@/shell/NotificationBell";
import { api, ApiError, type NotificationDeliveryView } from "@/lib/api";
import { cn, FOCUS_RING } from "@maipai/ui/src/utils";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function whenText(iso: string): string {
  return new Date(iso).toLocaleString();
}

// "The thirty-day history page" (session E step 5). GET /api/notifications
// /history (backend/src/lib/notifications.ts's listHistory()) is real but
// genuinely unbounded - every delivery ever made, no date filter, no cap
// (confirmed by reading it, not assumed) - so the thirty days is a client-
// side window over the real data, not a server capability this page
// pretends exists.
//
// Lane 15 (Jesse's ask from live use): "Clear all" and the new "Dismiss
// selected" both call the real POST /api/notifications/dismiss route now
// (backend/src/lib/notifications.ts's dismissMany()) - one request, not
// a client-side loop over the per-item dismiss route the way this page's
// own "Clear all" used to work before that route existed. Both send
// `{ ids }`, the exact set of pending ids this page's own 30-day window
// shows, not `{ all: true }` - that flag would reach every pending row
// in the person's whole history regardless of this page's own window,
// silently widening what one click does past what's actually on screen.
export function NotificationsPage() {
  const queryClient = useQueryClient();
  const query = useQuery<NotificationDeliveryView[]>({
    queryKey: NOTIFICATIONS_HISTORY_QUERY_KEY,
    queryFn: () => api.notificationHistory(),
  });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const cutoff = Date.now() - THIRTY_DAYS_MS;
  const all = query.data ?? [];
  const recent = all.filter((n) => new Date(n.createdAt).getTime() >= cutoff);
  const pending = recent.filter((n) => !n.dismissedAt);
  const pendingIds = pending.map((n) => n.id);
  const selectMode = useSelectMode(pendingIds);

  function invalidate() {
    // Both caches: dismissing here should also drop the row from the
    // shell's own pending bell (NotificationBell.tsx), not just this
    // page's own copy - they're two different queries (this page shows
    // history, including already-read/dismissed rows the bell never
    // does), not the same list under two keys.
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_HISTORY_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY }),
    ]);
  }

  async function handleDismiss(id: string) {
    setBusy(true);
    setActionError(null);
    try {
      await api.dismissNotification(id);
      await invalidate();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not dismiss that notification.");
    } finally {
      setBusy(false);
    }
  }

  async function dismissMany(ids: string[]) {
    setBusy(true);
    setActionError(null);
    try {
      const result = await api.dismissNotifications({ ids });
      if (result.count < ids.length) {
        setActionError(`${result.count} of ${ids.length} could be cleared - the rest were already gone.`);
      }
      selectMode.exit();
      await invalidate();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not clear those notifications.");
      // A review caught this catch block leaving the on-screen list
      // unrefetched on a failed call, unlike every other path here -
      // the list can silently drift from server state (a partial
      // failure, a race with the bell's own "Dismiss all") until an
      // unrelated remount or the next poll.
      await invalidate();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Notifications">
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a keyboard-scrollable region, not a widget (DetailPane.tsx's own precedent). */}
      <div tabIndex={0} className={cn("flex flex-1 flex-col gap-4 overflow-y-auto p-4", FOCUS_RING)}>
        {actionError ? <p className="text-base text-destructive">{actionError}</p> : null}

        <AsyncState
          data={query.data}
          error={query.isError}
          isFetching={query.isFetching}
          onRetry={() => query.refetch()}
          errorMessage="Could not load your notification history."
          loadingLabel="Loading notifications"
        >
          {() => {
            // Re-derived from the CURRENT pendingIds every render instead
            // of trusted as-is (the fix this hook generalizes): a row
            // that's no longer pending can never still read as selected,
            // inflate the BatchBar's own count, or get sent in a stale
            // Dismiss-selected call.
            const selectedPending = [...selectMode.selected];
            const allPendingSelected = pendingIds.length > 0 && selectMode.count === pendingIds.length;
            if (recent.length === 0) {
              return <EmptyState icon="bell" text="Nothing in the last 30 days." />;
            }
            return (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-medium text-muted-foreground">Last 30 days</h2>
                  {selectMode.active ? (
                    // Never gated on pending.length - a review caught
                    // the earlier `selectMode && pending.length > 0`
                    // version leaving no way out of select mode at all
                    // once the pending set hit 0 while still selected
                    // (the bell's own "Dismiss all", another tab, or a
                    // poll landing mid-selection): BatchBar's own "Done"
                    // is the one exit, so it has to render for as long
                    // as selectMode itself is true, regardless of
                    // whether anything is left to act on.
                    <BatchBar count={selectedPending.length} onExit={selectMode.exit}>
                      <Button variant="ghost" disabled={selectedPending.length === 0 || busy} onClick={() => dismissMany(selectedPending)}>
                        Dismiss selected
                      </Button>
                    </BatchBar>
                  ) : (
                    <div className="flex items-center gap-2">
                      {pending.length > 0 ? <SelectModeToggle label="Select" onClick={selectMode.enter} /> : null}
                      {pending.length > 0 ? (
                        <Button variant="ghost" onClick={() => dismissMany(pendingIds)} disabled={busy}>
                          Clear all
                        </Button>
                      ) : null}
                    </div>
                  )}
                </div>
                {selectMode.active && pending.length > 0 ? (
                  <div className="flex w-fit items-center gap-2 text-sm text-muted-foreground">
                    <Checkbox
                      checked={allPendingSelected ? true : selectedPending.length > 0 ? "indeterminate" : false}
                      onCheckedChange={() => (allPendingSelected ? selectMode.clear() : selectMode.selectAll())}
                      aria-label="Select all"
                      id="notifications-select-all"
                    />
                    <label htmlFor="notifications-select-all">Select all</label>
                  </div>
                ) : null}
                <List
                  items={recent}
                  getKey={(n) => n.id}
                  label="Notification history"
                  renderItem={(n) => (
                    <div className="flex min-w-0 flex-1 items-start gap-3 py-1">
                      {selectMode.active && !n.dismissedAt ? (
                        <Checkbox
                          checked={selectMode.isSelected(n.id)}
                          onCheckedChange={() => selectMode.toggle(n.id)}
                          aria-label={`Select ${n.text}`}
                          className="mt-1 shrink-0"
                        />
                      ) : null}
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex items-center gap-2">
                          {n.dismissedAt ? (
                            <Badge variant="secondary">Dismissed</Badge>
                          ) : n.readAt ? (
                            <Badge variant="outline">Read</Badge>
                          ) : (
                            <Badge>New</Badge>
                          )}
                          <span className="text-base">{n.text}</span>
                        </div>
                        <span className="text-sm text-muted-foreground">{whenText(n.createdAt)}</span>
                      </div>
                    </div>
                  )}
                  renderAction={
                    selectMode.active
                      ? undefined
                      : (n) =>
                          n.dismissedAt ? null : (
                            <Button
                              variant="ghost"
                              aria-label={`Dismiss ${n.text}`}
                              onClick={() => handleDismiss(n.id)}
                              disabled={busy}
                            >
                              Dismiss
                            </Button>
                          )
                  }
                />
              </>
            );
          }}
        </AsyncState>
      </div>
    </Page>
  );
}
