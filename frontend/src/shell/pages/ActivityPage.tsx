import { i18n } from "@lingui/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { StatusCard, type StatusCardKind } from "@maipai/ui/src/elements/status-card";
import { getIcon } from "@maipai/ui/src/icons";
import { Button } from "@maipai/ui/src/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/dashboard/components/ui/alert-dialog";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { dayHeading, dayKey } from "@maipai/ui/src/relativeTime";
import { api, type ActivityItemView } from "@/lib/api";
import { ACTIVITY_KEY, useActivity } from "@/shell/activity";
import { useTabItem } from "@/shell/tabIdentity";

// ACTIVITY-PAGE-01 (PRO-LOOK-01 sections 20 to 25; RULES.md S6, the Activity row): the viewer's own jobs and status messages across
// apps, newest first, grouped by day, each drawn as the kit StatusCard. The hub words every line (`GET /api/activity`), so this page
// writes no sentence of its own beyond the state words and the one action's label. Opening the page marks what finished as seen.

/** Only a finished card can be cleared; a waiting or making one is still running. */
const isFinished = (item: ActivityItemView): boolean => item.state === "done" || item.state === "failed" || item.state === "attention";

const KIND: Record<ActivityItemView["state"], StatusCardKind> = { waiting: "waiting", making: "progress", done: "done", attention: "attention", failed: "problem" };

const stateWord = (state: ActivityItemView["state"]): string => ({
  waiting: i18n._({ id: "Waiting", message: "Waiting" }),
  making: i18n._({ id: "Making now", message: "Making now" }),
  done: i18n._({ id: "Done", message: "Done" }),
  attention: i18n._({ id: "Needs a look", message: "Needs a look" }),
  failed: i18n._({ id: "Could not finish", message: "Could not finish" }),
})[state];

const actionLabel = (state: ActivityItemView["state"]): string => ({
  waiting: i18n._({ id: "Open", message: "Open" }),
  making: i18n._({ id: "Open", message: "Open" }),
  done: i18n._({ id: "Open", message: "Open" }),
  attention: i18n._({ id: "Review", message: "Review" }),
  failed: i18n._({ id: "Try again", message: "Try again" }),
})[state];

const sourceName = (source: ActivityItemView["source"]): string => ({
  picture: i18n._({ id: "Pictures", message: "Pictures" }),
  video: i18n._({ id: "Videos", message: "Videos" }),
  song: i18n._({ id: "Music", message: "Music" }),
  job: i18n._({ id: "Home", message: "Home" }),
})[source];

/** The one muted line: the hub's own words, then how long it usually takes while a figure is not known yet; a finished one names where it was made. */
function lineOf(item: ActivityItemView): string {
  const usually = item.state === "making" && item.percent === null && item.typicalMinutes
    ? i18n._({ id: "Usually about {minutes, plural, one {# minute} other {# minutes}}.", message: "Usually about {minutes, plural, one {# minute} other {# minutes}}.", values: { minutes: item.typicalMinutes } })
    : "";
  if (item.state === "done" && !item.line) return i18n._({ id: "Made in {app}.", message: "Made in {app}.", values: { app: sourceName(item.source) } });
  return [item.line, usually].filter(Boolean).join(" ");
}

const leadIcon = (state: ActivityItemView["state"]) => {
  const Icon = getIcon(state === "done" ? "check" : state === "failed" || state === "attention" ? "alert-triangle" : state === "waiting" ? "clock" : "loader");
  return <Icon aria-hidden className="size-5" />;
};

/** Groups already sorted newest first by the local day each last changed. */
export function groupByDay(items: readonly ActivityItemView[], now: Date = new Date()): Array<{ key: string; heading: string; items: ActivityItemView[] }> {
  const groups: Array<{ key: string; heading: string; items: ActivityItemView[] }> = [];
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
  const query = useActivity();
  const marked = useRef(false);
  const groups = useMemo(() => groupByDay(query.data?.items ?? []), [query.data]);

  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [clearFailed, setClearFailed] = useState(false);
  const clearable = (query.data?.items ?? []).some(isFinished);

  // ACTIVITY-CLEAR-01: clearing only hides the list rows for this person; the hub never touches the pictures, videos or songs.
  async function clear(body: { keys?: string[]; all?: boolean }) {
    setBusy(true);
    setClearFailed(false);
    try {
      client.setQueryData(ACTIVITY_KEY, await api.clearActivity(body));
      void client.invalidateQueries({ queryKey: ACTIVITY_KEY });
    } catch { setClearFailed(true); } finally { setBusy(false); setConfirming(false); }
  }

  // Opening the page clears the "finished, not opened" dot: record it once the list has been read.
  useEffect(() => {
    if (!query.data || marked.current) return;
    marked.current = true;
    void api.markActivitySeen().then(() => client.invalidateQueries({ queryKey: ACTIVITY_KEY })).catch(() => { marked.current = false; });
  }, [query.data, client]);

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
        data={query.data}
        error={query.isError}
        isFetching={query.isFetching}
        onRetry={() => query.refetch()}
        errorMessage={i18n._({ id: "Activity could not load. Check that this computer is online, then try again.", message: "Activity could not load. Check that this computer is online, then try again." })}
        loadingLabel={i18n._({ id: "Loading activity", message: "Loading activity" })}
      >
        {() => groups.length === 0 ? (
          <StatusCard kind="info" stateWord={i18n._({ id: "Good to know", message: "Good to know" })} title={i18n._({ id: "Nothing here yet", message: "Nothing here yet" })} line={i18n._({ id: "Pictures, videos and songs you make show up here while they are made and after.", message: "Pictures, videos and songs you make show up here while they are made and after." })} icon={leadIcon("done")} />
        ) : (
          <>
            {groups.map((group) => (
              <section key={group.key} aria-label={group.heading} className="flex flex-col gap-3">
                <h2 className="text-supporting font-medium text-muted-foreground">{group.heading}</h2>
                <ul className="flex flex-col gap-3">
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <StatusCard
                        kind={KIND[item.state]}
                        stateWord={stateWord(item.state)}
                        title={item.title}
                        line={lineOf(item)}
                        icon={leadIcon(item.state)}
                        progress={item.state === "making" && item.percent !== null ? item.percent : undefined}
                        secondary={isFinished(item) ? { label: i18n._({ id: "Clear this", message: "Clear this" }), onSelect: () => { void clear({ keys: [item.id] }); } } : undefined}
                        action={item.href ? { label: actionLabel(item.state), onSelect: () => navigate(item.href!), tone: item.state === "waiting" || item.state === "making" ? "quiet" : "primary" } : undefined}
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
            <AlertDialogAction disabled={busy} onClick={(event) => { event.preventDefault(); void clear({ all: true }); }}>{i18n._({ id: "Clear all", message: "Clear all" })}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <p className="text-supporting text-muted-foreground">
        <Link to="/notifications" className="underline underline-offset-4">{i18n._({ id: "Older messages", message: "Older messages" })}</Link>
      </p>
    </div>
  );
}
