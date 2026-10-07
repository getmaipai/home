import { useContext, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useAuiState } from "@assistant-ui/react";
import { toast } from "sonner";
import type { BackgroundRun } from "@maipai/ui/src/elements/background-inbox";
import { api, type HomeJobView } from "@/lib/api";
import { WakeWordPersonContext } from "@/apps/chat/chatThreadContexts";
import { NOTIFICATIONS_QUERY_KEY } from "@/shell/NotificationBell";
import {
  runningNowView,
  type RunningNowActionKey,
  type RunningNowBand,
  type RunningNowRow,
  type RunningNowView,
} from "@/shell/runningNow";

export const JOBS_QUERY_KEY = ["jobs"];
const ACTIVE_POLL_MS = 5_000;
const IDLE_POLL_MS = 30_000;
const RECENT_DONE_MS = 15 * 60_000;

export type ActivityCardPick = {
  row: RunningNowRow;
  kind: "waiting" | "running" | "done" | "failed";
  more: number;
};

function bandOf(role: string): RunningNowBand {
  return role === "child" ? "child" : role === "teen" ? "teen" : "adult";
}

/** Picks the urgent row for TaskCard; other live jobs are shown in BackgroundInbox. */
export function pickActivity(
  view: RunningNowView,
  currentConversationId: string | undefined,
  now: number,
  dismissed: ReadonlySet<string>,
): ActivityCardPick | null {
  const here = (row: RunningNowRow) => currentConversationId !== undefined && row.conversationId === currentConversationId && row.tone === "waiting";
  const waiting = view.waiting.filter((row) => !here(row));
  const running = view.running;
  const done = view.done.filter((row) => row.own && !dismissed.has(row.id) && row.finishedAt !== undefined && now - row.finishedAt <= RECENT_DONE_MS);
  if (waiting.length > 0) return { row: waiting[0]!, kind: "waiting", more: waiting.length - 1 };
  if (running.length > 0) return { row: running[0]!, kind: "running", more: running.length - 1 };
  const failed = done.find((row) => row.failed);
  if (failed) return { row: failed, kind: "failed", more: done.length - 1 };
  if (done.length > 0) return { row: done[0]!, kind: "done", more: done.length - 1 };
  return null;
}

export function useChatActivity() {
  const person = useContext(WakeWordPersonContext);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const conversationId = useAuiState((s) => s.threadListItem.remoteId);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const jobs = useQuery<HomeJobView[]>({
    queryKey: JOBS_QUERY_KEY,
    enabled: person !== null,
    refetchInterval: (query) => {
      const rows = Array.isArray(query.state.data) ? query.state.data : [];
      return rows.some((row) => row.state === "running" || row.state === "queued" || row.state === "waiting_for_you") ? ACTIVE_POLL_MS : IDLE_POLL_MS;
    },
    queryFn: () => api.jobs(),
  });
  const viewer = useMemo(() => (person ? { id: person.id, band: bandOf(person.role), admin: person.role === "owner" || person.role === "admin" } : null), [person]);
  const rows = Array.isArray(jobs.data) ? jobs.data : [];
  const now = Date.now();
  const view = viewer ? runningNowView({ jobs: rows, viewer, now }) : null;

  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: JOBS_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY }),
  ]);
  const stop = useMutation({
    mutationFn: (id: string) => api.stopJob(id),
    onError: () => toast.error("Could not stop that. Try again."),
    onSettled: refresh,
  });
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approve" | "deny" }) => api.decideApproval(id, decision),
    onError: () => toast.error("Could not save that answer. Try again."),
    onSettled: refresh,
  });

  const pick = view ? pickActivity(view, conversationId, now, dismissed) : null;
  const backgroundRuns: BackgroundRun[] = view?.running
    .filter((row) => pick?.kind !== "running" || row.id !== pick.row.id)
    .map((row) => ({
      id: row.id,
      title: row.title,
      state: "running",
      elapsed: row.status,
      ...(row.detail ? { summary: row.detail } : {}),
    })) ?? [];
  const busy = stop.isPending || decide.isPending;

  const act = (key: RunningNowActionKey) => {
    if (!pick) return;
    if (key === "stop") stop.mutate(pick.row.id);
    else if (key === "approve" || key === "deny") decide.mutate({ id: pick.row.id, decision: key });
    else if (key === "open" && pick.row.href) navigate(pick.row.href);
  };
  const dismiss = () => {
    if (pick) setDismissed((current) => new Set(current).add(pick.row.id));
  };

  return { pick, backgroundRuns, busy, act, dismiss };
}
