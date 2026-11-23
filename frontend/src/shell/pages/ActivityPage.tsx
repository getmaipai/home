import { i18n } from "@lingui/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { StatusCard } from "@maipai/ui/src/elements/status-card";
import { Button } from "@maipai/ui/src/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/dashboard/components/ui/alert-dialog";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { dayHeading, dayKey } from "@maipai/ui/src/relativeTime";
import { api } from "@/lib/api";
import { ACTIVITY_KEY } from "@/shell/activity";
import { useActivityFeed, type FeedItem } from "@/shell/activityFeed";
import { ACTIVITY_CARD_KIND, actionLabel, feedIcon, isFinished, leadIcon, lineOf, stateWord } from "@/shell/activityRows";
import { NOTIFICATIONS_HISTORY_QUERY_KEY, NOTIFICATIONS_QUERY_KEY } from "@/shell/NotificationBell";
import { useTabItem } from "@/shell/tabIdentity";

// ACTIVITY-PAGE-01 (PRO-LOOK-01 sections 20 to 25; RULES.md S6, the Activity row) plus ACTIVITY-MERGE-01: the viewer's own jobs and
// status messages in one list, newest first, grouped by day, each drawn as the kit StatusCard. The hub words every line
// (`GET /api/activity`), so this page writes no sentence of its own beyond the state words and the action labels. Opening the page
// marks what finished as seen.

/** Groups already sorted newest first by the local day each last changed. */
export function groupByDay(items: readonly FeedItem[], now: Date = new Date()): Array<{ key: string; heading: string; items: FeedItem[] }> {
  const groups: Array<{ key: string; heading: string; items: FeedItem[] }> = [];
  for (const item of items) {
    const key = dayKey(item.at) ?? "unknown";
    const last = groups.at(-1);
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, heading: key === "unknown" ? i18n._({ id: "Earlier", message: "Earlier" }) : dayHeading(key, now), items: [item] });
  }
  return groups;
}

export function ActivityPage() {
  useTabItem(i18n._({ id: "Activity", message: "Activity" }));
  const navigate = useNavigate();
  const client = useQueryClient();
  const feed = useActivityFeed();
  const marked = useRef(false);
  const groups = useMemo(() => groupByDay(feed.items), [feed.items]);

  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [clearFailed, setClearFailed] = useState(false);
  const clearable = feed.items.some(isFinished);
  const noticeIds = feed.items.flatMap((item) => (item.source === "notice" && item.notificationId ? [item.notificationId] : []));

  // ACTIVITY-CLEAR-01: clearing only hides the list rows for this person; the hub never touches the pictures, videos or songs.
  // ACTIVITY-MERGE-01: the same button clears both kinds of row, jobs through the activity clear and notices through dismiss.
  async function clear(body: { keys?: string[]; all?: boolean } | null, ids: string[] = []) {
    setBusy(true);
    setClearFailed(false);
    try {
      if (body) client.setQueryData(ACTIVITY_KEY, await api.clearActivity(body));
      if (ids.length) await api.dismissNotifications({ ids });
      void client.invalidateQueries({ queryKey: ACTIVITY_KEY });
      if (ids.length) {
        void client.invalidateQueries({ queryKey: NOTIFICATIONS_HISTORY_QUERY_KEY });
        void client.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
      }
    } catch { setClearFailed(true); } finally { setBusy(false); setConfirming(false); }
  }

  // Opening the page clears the "finished, not opened" dot: record it once the list has been read.
  useEffect(() => {
    if (!feed.activity.data || marked.current) return;
    marked.current = true;
    void api.markActivitySeen().then(() => client.invalidateQueries({ queryKey: ACTIVITY_KEY })).catch(() => { marked.current = false; });
  }, [feed.activity.data, client]);

  return (
    <div className="flex flex-col gap-4" data-testid="activity-page">
      {clearable ? (
        <div className="flex justify-end">
          <Button type="button" size="xs" shape="pill" variant="outline" disabled={busy} onClick={() => setConfirming(true)}>{i18n._({ id: "Clear all", message: "Clear all" })}</Button>
        </div>
      ) : null}
      {clearFailed ? (
        <StatusCard kind="problem" stateWord={i18n._({ id: "Could not finish", message: "Could not finish" })} title={i18n._({ id: "Activity was not cleared", message: "Activity was not cleared" })} line={i18n._({ id: "Check that this computer is online, then try again.", message: "Check that this computer is online, then try again." })} icon={leadIcon("failed")} />
      ) : null}
      <AsyncState
        data={feed.activity.data ?? (feed.items.length ? { items: [], seenAt: null, dot: "none" as const } : undefined)}
        error={feed.isError && feed.items.length === 0}
        isFetching={feed.isFetching}
        onRetry={() => feed.refetch()}
        errorMessage={i18n._({ id: "Activity could not load. Check that this computer is online, then try again.", message: "Activity could not load. Check that this computer is online, then try again." })}
        loadingLabel={i18n._({ id: "Loading activity", message: "Loading activity" })}
      >
        {() => groups.length === 0 ? (
          <StatusCard kind="info" stateWord={i18n._({ id: "Good to know", message: "Good to know" })} title={i18n._({ id: "Nothing here yet", message: "Nothing here yet" })} line={i18n._({ id: "Pictures, videos, songs and messages show up here.", message: "Pictures, videos, songs and messages show up here." })} icon={leadIcon("done")} />
        ) : (
          <>
            {groups.map((group) => (
              <section key={group.key} aria-label={group.heading} className="flex flex-col gap-3">
                <h2 className="text-supporting font-medium text-muted-foreground">{group.heading}</h2>
                <ul className="flex flex-col gap-3">
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <StatusCard
                        kind={ACTIVITY_CARD_KIND[item.state]}
                        stateWord={stateWord(item.state)}
                        title={item.title}
                        line={lineOf(item)}
                        thumb={isFinished(item) && item.thumbnailUrl ? item.thumbnailUrl : undefined}
                        icon={feedIcon(item)}
                        progress={item.state === "making" && item.percent !== null ? item.percent : undefined}
                        secondary={isFinished(item) ? { label: i18n._({ id: "Clear this", message: "Clear this" }), onSelect: () => { void (item.source === "notice" && item.notificationId ? clear(null, [item.notificationId]) : clear({ keys: [item.id] })); } } : undefined}
                        action={item.href ? { label: actionLabel(item), onSelect: () => navigate(item.href!), tone: item.state === "waiting" || item.state === "making" ? "quiet" : "primary" } : undefined}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
      </AsyncState>
      <AlertDialog open={confirming} onOpenChange={(open) => { if (!open && !busy) setConfirming(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{i18n._({ id: "Clear all finished activity?", message: "Clear all finished activity?" })}</AlertDialogTitle>
            <AlertDialogDescription>{i18n._({ id: "This only removes the list. Your pictures, videos and songs stay where they are.", message: "This only removes the list. Your pictures, videos and songs stay where they are." })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{i18n._({ id: "Cancel", message: "Cancel" })}</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(event) => { event.preventDefault(); void clear({ all: true }, noticeIds); }}>{i18n._({ id: "Clear all", message: "Clear all" })}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
