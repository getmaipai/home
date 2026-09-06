import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Page } from "@/kit/primitives/Page";
import { List } from "@/kit/primitives/List";
import { AsyncState } from "@/kit/primitives/AsyncState";
import { EmptyState } from "@/kit/primitives/EmptyState";
import { Badge } from "@/kit/ui/badge";
import { Button } from "@/kit/ui/button";
import { NOTIFICATIONS_QUERY_KEY, NOTIFICATIONS_HISTORY_QUERY_KEY } from "@/shell/NotificationBell";
import { api, ApiError, type NotificationDeliveryView } from "@/lib/api";
import { cn, FOCUS_RING } from "@/kit/utils";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function whenText(iso: string): string {
  return new Date(iso).toLocaleString();
}

// "The thirty-day history page" (session E step 5). GET /api/notifications
// /history (backend/src/lib/notifications.ts's listHistory()) is real but
// genuinely unbounded - every delivery ever made, no date filter, no cap
// (confirmed by reading it, not assumed) - so the thirty days is a client-
// side window over the real data, not a server capability this page
// pretends exists. "Clear all" is the same shape: there is no
// POST /api/notifications/clear-all, so it loops the real, real
// POST /:id/dismiss once per still-pending row (a code review precedent
// this session already used for a genuinely missing batch endpoint -
// PeoplePage.tsx's own batch delete IS a real batch route, but where one
// doesn't exist, looping the real single-item action is the honest
// choice over inventing a fake batch response).
export function NotificationsPage() {
  const queryClient = useQueryClient();
  const query = useQuery<NotificationDeliveryView[]>({
    queryKey: NOTIFICATIONS_HISTORY_QUERY_KEY,
    queryFn: () => api.notificationHistory(),
  });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

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

  async function handleClearAll(pending: NotificationDeliveryView[]) {
    setBusy(true);
    setActionError(null);
    try {
      const results = await Promise.allSettled(pending.map((n) => api.dismissNotification(n.id)));
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed > 0) setActionError(`${failed} of ${pending.length} could not be cleared.`);
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
          {(all) => {
            const cutoff = Date.now() - THIRTY_DAYS_MS;
            const recent = all.filter((n) => new Date(n.createdAt).getTime() >= cutoff);
            const pending = recent.filter((n) => !n.dismissedAt);
            if (recent.length === 0) {
              return <EmptyState icon="bell" text="Nothing in the last 30 days." />;
            }
            return (
              <>
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-medium text-muted-foreground">Last 30 days</h2>
                  {pending.length > 0 ? (
                    <Button variant="ghost" onClick={() => handleClearAll(pending)} disabled={busy}>
                      Clear all
                    </Button>
                  ) : null}
                </div>
                <List
                  items={recent}
                  getKey={(n) => n.id}
                  label="Notification history"
                  renderItem={(n) => (
                    <div className="flex min-w-0 flex-1 flex-col gap-1 py-1">
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
                  )}
                  renderAction={(n) =>
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
