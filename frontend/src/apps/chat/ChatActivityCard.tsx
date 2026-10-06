// ACTIVITY-01d/e (owner, 2026-10-06): the one calm card above the composer.
// No header button, no side panel (ChatGPT and Claude do neither): the
// reply's own working dot and "Used n tools" disclosure live inside the
// message, Stop lives in the composer, and everything else that needs the
// person (an approval waiting in another chat, work that is queued or
// running elsewhere, something that just finished) shows here as ONE card,
// the most urgent first, "and 2 more" for the rest.
//
// Parts: the kit's Alert (as it ships), Button and Progress, tinted by
// tokens only. KIT GAP (rule 9, named): the kit has no inline activity card
// (`RunningNow` is a header popover and its body is not exported), so this
// file is wiring and copy around shipped primitives; the ask for a kit
// `ComposerActivity` part is KIT-ACTIVITY-CARD-01.
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useAuiState } from "@assistant-ui/react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@maipai/ui/src/dashboard/components/ui/alert";
import { Progress } from "@maipai/ui/src/dashboard/components/ui/progress";
import { Button } from "@maipai/ui/src/ui/button";
import { api, type HomeJobView } from "@/lib/api";
import { WakeWordPersonContext } from "@/apps/chat/chatThreadContexts";
import { NOTIFICATIONS_QUERY_KEY } from "@/shell/NotificationBell";
import { runningNowAnnouncement, runningNowView, type RunningNowActionKey, type RunningNowBand, type RunningNowRow, type RunningNowView } from "@/shell/runningNow";

export const JOBS_QUERY_KEY = ["jobs"];
// UI-STUDY.md 8.2: poll every 5 s only while something runs or waits.
const ACTIVE_POLL_MS = 5_000;
const IDLE_POLL_MS = 30_000;
const RECENT_DONE_MS = 15 * 60_000;

const ACTION_LABEL: Record<RunningNowActionKey, string> = { stop: "Stop", approve: "Approve", deny: "Deny", open: "Open" };

function bandOf(role: string): RunningNowBand {
  return role === "child" ? "child" : role === "teen" ? "teen" : "adult";
}

export type ActivityCardPick = { row: RunningNowRow; kind: "waiting" | "running" | "done" | "failed"; more: number };

/** The single most urgent thing to show, or nothing. Waiting beats
 * running beats finished. An approval or ask that belongs to the chat the
 * person is looking at is skipped: the reply already carries that card. */
export function pickActivity(view: RunningNowView, currentConversationId: string | undefined, now: number, dismissed: ReadonlySet<string>): ActivityCardPick | null {
  const here = (row: RunningNowRow) => currentConversationId !== undefined && row.conversationId === currentConversationId && (row.tone === "waiting");
  const waiting = view.waiting.filter((row) => !here(row));
  const running = view.running;
  const done = view.done.filter((row) => row.own && !dismissed.has(row.id) && row.finishedAt !== undefined && now - row.finishedAt <= RECENT_DONE_MS);
  if (waiting.length > 0) return { row: waiting[0]!, kind: "waiting", more: waiting.length - 1 + running.length };
  if (running.length > 0) return { row: running[0]!, kind: "running", more: running.length - 1 };
  const failed = done.find((row) => row.failed);
  if (failed) return { row: failed, kind: "failed", more: done.length - 1 };
  if (done.length > 0) return { row: done[0]!, kind: "done", more: done.length - 1 };
  return null;
}

export function ChatActivityCard() {
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

  const previous = useRef<RunningNowView | null>(null);
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    if (!view) return;
    const said = runningNowAnnouncement(previous.current, view);
    if (said) setAnnouncement(said);
    previous.current = view;
  }, [jobs.data]); // eslint-disable-line react-hooks/exhaustive-deps -- announce on a new list only

  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: JOBS_QUERY_KEY }), queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY })]);
  const stop = useMutation({ mutationFn: (id: string) => api.stopJob(id), onError: () => toast.error("Could not stop that. Try again."), onSettled: refresh });
  const decide = useMutation({ mutationFn: ({ id, decision }: { id: string; decision: "approve" | "deny" }) => api.decideApproval(id, decision), onError: () => toast.error("Could not save that answer. Try again."), onSettled: refresh });

  const pick = view ? pickActivity(view, conversationId, now, dismissed) : null;
  const live = <span role="status" aria-live="polite" className="sr-only">{announcement}</span>;
  if (!pick) return live;
  const { row, kind, more } = pick;
  const busy = stop.isPending || decide.isPending;
  const act = (key: RunningNowActionKey) => {
    if (key === "stop") stop.mutate(row.id);
    else if (key === "approve" || key === "deny") decide.mutate({ id: row.id, decision: key });
    else if (key === "open" && row.href) navigate(row.href);
  };
  const actions = row.actions;
  const percent = row.progress === undefined ? undefined : Math.round(Math.max(0, Math.min(1, row.progress)) * 100);
  const attention = kind === "waiting";
  const failed = kind === "failed";
  return (
    <>
      {live}
      <Alert
        data-slot="chat-activity-card"
        data-kind={kind}
        role="status"
        variant={failed ? "destructive" : "default"}
        className={attention ? "my-2 border-[var(--tint-attention-hairline)] bg-[var(--tint-attention)] text-foreground" : "my-2 text-foreground"}
      >
        <AlertTitle className="flex items-baseline justify-between gap-3 text-base">
          <span className="min-w-0 break-words">{row.title}</span>
          {row.status ? <span className="shrink-0 font-normal text-muted-foreground">{row.status}</span> : null}
        </AlertTitle>
        <AlertDescription className="text-base">
          {row.detail || more > 0 ? <p>{row.detail ? [row.detail, more > 0 ? `${more} more` : ""].filter(Boolean).join(" · ") : `and ${more} more`}</p> : null}
        </AlertDescription>
        {percent !== undefined ? <Progress value={percent} aria-label={`${row.title} progress`} className="mt-2 w-auto" /> : null}
        {actions.length > 0 || kind === "done" || failed ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {actions.map((key) => (
              <Button key={key} type="button" size="sm" variant={key === "approve" ? "default" : "outline"} className="text-base" disabled={busy && key !== "open"} aria-label={`${ACTION_LABEL[key]} ${row.title}`} onClick={() => act(key)}>
                {ACTION_LABEL[key]}
              </Button>
            ))}
            {kind === "done" || failed ? (
              <Button type="button" size="sm" variant="ghost" className="text-base" onClick={() => setDismissed((current) => new Set(current).add(row.id))}>
                Dismiss
              </Button>
            ) : null}
          </div>
        ) : null}
      </Alert>
    </>
  );
}
