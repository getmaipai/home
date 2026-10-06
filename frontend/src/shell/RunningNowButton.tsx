// ACTIVITY-01d: the shell header's Running now button and panel, at the
// top right of every /next page beside the status dot (the 01d verdict's
// C2 placement), and the owner's 2026-10-06 ask: chat's activity area in
// the upper right, as Row-Bot has it, holding the running reply's Stop.
// The kit's `RunningNow` part draws it; this file only wires data, copy
// (runningNow.ts) and the routes.
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { RunningNow, type RunningNowItem } from "@maipai/ui/src/primitives/RunningNow";
import { pauseTvNavForOverlay } from "@maipai/ui/src/tvNav";
import { api, type HomeJobView } from "@/lib/api";
import { useChatHeaderData } from "@/apps/chat/chatHeaderData";
import { NOTIFICATIONS_QUERY_KEY } from "@/shell/NotificationBell";
import { runningNowAnnouncement, runningNowView, type RunningNowActionKey, type RunningNowBand, type RunningNowRow, type RunningNowView } from "@/shell/runningNow";

export const JOBS_QUERY_KEY = ["jobs"];
// UI-STUDY.md 8.2: refetch every 5 s only while something runs or the
// panel is open; otherwise a slow check so new work still shows its count.
const ACTIVE_POLL_MS = 5_000;
const IDLE_POLL_MS = 30_000;

const ACTION_LABEL: Record<RunningNowActionKey, string> = {
  stop_reply: "Stop",
  stop: "Stop",
  approve: "Approve",
  deny: "Deny",
  open: "Open",
};

function bandOf(role: string): RunningNowBand {
  return role === "child" ? "child" : role === "teen" ? "teen" : "adult";
}

export function RunningNowButton({ person }: { person: { id: string; role: string } }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const chat = useChatHeaderData();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const replyStartedAt = useRef<number | null>(null);
  const replyRunning = chat?.replyRunning === true;
  if (replyRunning && replyStartedAt.current === null) replyStartedAt.current = Date.now();
  if (!replyRunning) replyStartedAt.current = null;

  const jobs = useQuery<HomeJobView[]>({
    queryKey: JOBS_QUERY_KEY,
    queryFn: () => api.jobs(),
    refetchInterval: (query) => {
      const rows = Array.isArray(query.state.data) ? query.state.data : [];
      const active = rows.some((row) => row.state === "running" || row.state === "queued");
      return open || active ? ACTIVE_POLL_MS : IDLE_POLL_MS;
    },
  });

  // The elapsed line ("Started 12 seconds ago") only moves while someone
  // is looking at it.
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(id);
  }, [open]);

  const viewer = useMemo(() => ({ id: person.id, band: bandOf(person.role), admin: person.role === "owner" || person.role === "admin" }), [person.id, person.role]);
  const rows = Array.isArray(jobs.data) ? jobs.data : [];
  const view = runningNowView({ jobs: rows, viewer, reply: replyStartedAt.current === null ? null : { startedAt: replyStartedAt.current }, now: open ? now : Date.now() });

  const previous = useRef<RunningNowView | null>(null);
  const [announcement, setAnnouncement] = useState<string | undefined>();
  useEffect(() => {
    const said = runningNowAnnouncement(previous.current, view);
    if (said) setAnnouncement(said);
    previous.current = view;
  }, [jobs.data]); // eslint-disable-line react-hooks/exhaustive-deps -- announce on a new list only

  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: JOBS_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY }),
  ]);
  const stop = useMutation({ mutationFn: (id: string) => api.stopJob(id), onError: () => toast.error("Could not stop that. Try again."), onSettled: refresh });
  const decide = useMutation({ mutationFn: ({ id, decision }: { id: string; decision: "approve" | "deny" }) => api.decideApproval(id, decision), onError: () => toast.error("Could not save that answer. Try again."), onSettled: refresh });

  // Every open and close goes through here, so the TV navigation pause is
  // always released (an Open action closes the panel itself).
  const changeOpen = (next: boolean) => {
    if (next === open) return;
    setOpen(next);
    pauseTvNavForOverlay(next);
    if (next) void queryClient.invalidateQueries({ queryKey: JOBS_QUERY_KEY });
  };
  const act = (row: RunningNowRow, key: RunningNowActionKey) => {
    if (key === "stop_reply") chat?.onStopReply?.();
    else if (key === "stop") stop.mutate(row.id);
    else if (key === "approve" || key === "deny") decide.mutate({ id: row.id, decision: key });
    else if (key === "open" && row.href) {
      changeOpen(false);
      navigate(row.href);
    }
  };
  const busy = stop.isPending || decide.isPending;
  const toItem = (row: RunningNowRow): RunningNowItem => ({
    id: row.id,
    title: row.title,
    status: row.status,
    tone: row.tone,
    ...(row.detail ? { detail: row.detail } : {}),
    ...(row.progress !== undefined ? { progress: row.progress } : {}),
    ...(row.details ? { details: <span className="whitespace-pre-wrap">{row.details}</span> } : {}),
    actions: row.actions.map((key) => ({ label: ACTION_LABEL[key], primary: key === "approve", disabled: busy && key !== "stop_reply" && key !== "open", onSelect: () => act(row, key) })),
  });

  // Shown when relevant (the owner's chat shell, 2026-10-06): something
  // running, waiting or finished in the last few minutes, or the panel open.
  if (!open && view.count === 0 && view.recentDone === 0) return null;

  return (
    <RunningNow
      label="Running now"
      heading="Running now"
      waitingHeading={viewer.band === "child" ? "Waiting" : "Waiting for you"}
      doneLabel={(n) => `${n} done`}
      emptyText="Nothing is running right now."
      running={view.running.map(toItem)}
      waiting={view.waiting.map(toItem)}
      done={view.done.map(toItem)}
      count={view.count}
      announcement={announcement}
      open={open}
      onOpenChange={changeOpen}
    />
  );
}
