// CODE-APP-01 and CODE-TIER-04: one session. The header (kit chat-header) carries the title, the state and the tier control; the transcript, the held
// request and queue cards, the composer and its one status line fill the middle; Changes, Files, Terminal and Plan are tabs of the kit right pane
// (pinned open on a wide screen, a sheet on a phone).
import { i18n } from "@lingui/core";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useBreakpoint } from "@maipai/ui/src/hooks/useBreakpoint";
import { ChatHeader } from "@maipai/ui/src/elements/chat-header";
import { MessageQueue } from "@maipai/ui/src/elements/message-queue";
import { PendingActions } from "@maipai/ui/src/elements/pending-actions";
import { RightPane } from "@maipai/ui/src/elements/right-pane";
import { StatusCard } from "@maipai/ui/src/elements/status-card";
import { TierChip, TierSegment, type TierId } from "@maipai/ui/src/elements/tier-segment";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import { Button } from "@maipai/ui/src/ui/button";
import { Textarea } from "@maipai/ui/src/ui/textarea";
import { getIcon } from "@maipai/ui/src/icons";
import { errorLine } from "@/lib/hubReachability";
import { ApiError } from "@/lib/api";
import { codeApi, type CodeTier } from "./codeApi";
import { activityOf, isBusy, stateWord, tierWord } from "./codeTranscript";
import { CODE_SESSIONS_KEY, CODE_TIERS_KEY, tierOptions } from "./NewSession";
import { ChangesTab, FilesTab, PlanTab, TerminalTab } from "./SessionTabs";
import { Stack } from "./layout";
import { Transcript, type LocalNotice } from "./Transcript";

const TerminalIcon = getIcon("terminal");

export function SessionView({ id }: { id: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const phone = useBreakpoint().tier === "phone";
  const view = useQuery({ queryKey: ["code-session", id], queryFn: () => codeApi.view(id), retry: false, refetchInterval: (q) => q.state.data && isBusy(q.state.data.session.state) ? 1500 : 6000 });
  const messages = useQuery({ queryKey: ["code-messages", id], queryFn: () => codeApi.messages(id), retry: false, refetchInterval: view.data && isBusy(view.data.session.state) ? 1500 : false });
  const tiers = useQuery({ queryKey: CODE_TIERS_KEY, queryFn: codeApi.tiers, retry: false });
  const [text, setText] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [notices, setNotices] = useState<LocalNotice[]>([]);
  const [maxNext, setMaxNext] = useState(false);
  const [paneOpen, setPaneOpen] = useState(!phone);
  const [paneTab, setPaneTab] = useState("changes");
  const [pinned, setPinned] = useState(true);
  const end = useRef<HTMLDivElement>(null);
  const list = messages.data ?? [];
  const session = view.data?.session;
  const state = session?.state;
  useEffect(() => { end.current?.scrollIntoView?.({ block: "end" }); }, [list.length, view.data?.waiting?.line]);
  useEffect(() => { if (state && !isBusy(state)) setMaxNext(false); }, [state]);

  const refresh = async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["code-session", id] }), queryClient.invalidateQueries({ queryKey: ["code-messages", id] }), queryClient.invalidateQueries({ queryKey: CODE_SESSIONS_KEY })]); };
  const run = async (action: () => Promise<unknown>, fallback: string) => {
    setProblem(""); setBusy(true);
    try { await action(); await refresh(); } catch (error) { setProblem(errorLine(error, fallback)); await refresh(); } finally { setBusy(false); }
  };

  if (view.isError) {
    const gone = view.error instanceof ApiError && view.error.status === 404;
    return <EmptyState icon="terminal" text={gone ? i18n._({ id: "That session was not found. It may have been deleted.", message: "That session was not found. It may have been deleted." }) : errorLine(view.error, i18n._({ id: "Could not open this session. Try again.", message: "Could not open this session. Try again." }))} actionLabel={i18n._({ id: "Back to sessions", message: "Back to sessions" })} onAction={() => navigate("/apps/code")} />;
  }
  if (!session || !view.data) return null;
  const activity = activityOf(list);
  const tier: CodeTier = session.tier ?? "standard";
  const working = isBusy(session.state);
  const waiting = view.data.waiting;
  const queued = view.data.queued_messages;

  async function changeTier(next: TierId) {
    const was = working;
    await run(async () => {
      await codeApi.setTier(id, next);
      setNotices((current) => [...current, { afterSeq: list[list.length - 1]?.seq ?? 0, text: i18n._({ id: "Switched to {tier}", message: "Switched to {tier}", values: { tier: tierWord(next) } }) }]);
      setMaxNext(next === "max" && was);
      await queryClient.invalidateQueries({ queryKey: CODE_TIERS_KEY });
    }, i18n._({ id: "You cannot use that level for coding. Pick another level.", message: "You cannot use that level for coding. Pick another level." }));
  }

  async function send() {
    const message = text.trim();
    if (!message) return;
    setText("");
    await run(() => codeApi.send(id, message), i18n._({ id: "Could not send that. Try again.", message: "Could not send that. Try again." }));
  }

  const useStandard = waiting?.offers_standard ? [{ label: i18n._({ id: "Use Standard for this message", message: "Use Standard for this message" }), onSelect: () => void run(() => codeApi.useStandard(id, waiting.turn_id), i18n._({ id: "That message is not waiting for Max any more.", message: "That message is not waiting for Max any more." })) }] : [];
  const statusLine = waiting?.line ?? view.data.coding_notice ?? stateWord(session.state);
  const tabs = [
    { id: "changes", label: i18n._({ id: "Changes", message: "Changes" }), content: <ChangesTab session={session} activity={activity} busy={busy} onUndo={(cid) => void run(() => codeApi.undo(id, cid), i18n._({ id: "Could not undo that. Try again.", message: "Could not undo that. Try again." }))} onPush={() => void run(() => codeApi.push(id), i18n._({ id: "Could not push. Try again.", message: "Could not push. Try again." }))} onPullRequest={() => void run(() => codeApi.pullRequest(id), i18n._({ id: "Could not open the pull request. Try again.", message: "Could not open the pull request. Try again." }))} /> },
    { id: "files", label: i18n._({ id: "Files", message: "Files" }), content: <FilesTab session={session} activity={activity} /> },
    { id: "terminal", label: i18n._({ id: "Terminal", message: "Terminal" }), content: <TerminalTab activity={activity} /> },
    { id: "plan", label: i18n._({ id: "Plan", message: "Plan" }), content: <PlanTab activity={activity} /> },
  ];
  const [first, ...rest] = tabs;
  const pane = <RightPane open={paneOpen} onOpenChange={setPaneOpen} pinned={phone ? false : pinned} onPinnedChange={setPinned} companionTab={first!} tabs={rest} activeTab={paneTab} onActiveTabChange={setPaneTab} avatar={null} pinLabel={i18n._({ id: "Keep open", message: "Keep open" })} closeLabel={i18n._({ id: "Close", message: "Close" })} label={i18n._({ id: "Session details", message: "Session details" })} />;
  const subtitle = [session.repo.full_name ?? i18n._({ id: "No repository", message: "No repository" }), session.repo.work_branch].join(" @ ");

  return (
    <Stack row gap="none" data-slot="code-session" className="min-h-0 min-w-0 flex-1">
      <Stack gap="none" className="min-h-0 min-w-0 flex-1">
        <ChatHeader name={session.title} media={<TerminalIcon aria-hidden className="size-6" />} {...(phone ? { onMenu: () => navigate("/apps/code") } : {})}
          actions={<>
            {working ? <Button size="sm" variant="outline" onClick={() => void run(() => codeApi.stop(id), i18n._({ id: "Could not stop. Try again.", message: "Could not stop. Try again." }))}>{i18n._({ id: "Stop", message: "Stop" })}</Button> : null}
            {!paneOpen || phone ? <Button size="sm" variant="ghost" onClick={() => setPaneOpen(true)}>{i18n._({ id: "Changes", message: "Changes" })}</Button> : null}
          </>}
          end={<div className="flex flex-wrap items-center gap-2" data-slot="code-header-tier">
            {(tiers.data?.tiers.length ?? 0) > 1 ? <TierSegment value={tier} onValueChange={(next) => void changeTier(next)} tiers={tierOptions(tiers.data!.tiers)} presentation={phone ? "dropdown" : "segment"} density="compact" label={i18n._({ id: "Level", message: "Level" })} /> : <TierChip tier={tier} />}
            {maxNext ? <TierChip tier="max" label={i18n._({ id: "Max from the next message", message: "Max from the next message" })} /> : null}
          </div>} />
        <p className="truncate px-4 pb-1 text-body text-muted-foreground" data-slot="code-subtitle">{subtitle}</p>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {list.length === 0 ? <p className="p-6 text-center text-body text-muted-foreground">{i18n._({ id: "Nothing yet. Tell the agent what to do.", message: "Nothing yet. Tell the agent what to do." })}</p> : <Transcript messages={list} notices={notices} onAnswer={(rid, answer) => void run(() => codeApi.answer(id, rid, answer), i18n._({ id: "Could not send your answer. Try again.", message: "Could not send your answer. Try again." }))} />}
          <div ref={end} />
        </div>
        <div className={`mx-auto flex w-full max-w-3xl flex-col gap-2 px-4 ${phone ? "pb-32" : "pb-3"}`}>
          {useStandard.length > 0 ? <div data-slot="code-held"><PendingActions actions={useStandard} /></div> : null}
          {queued.length > 0 ? <div><MessageQueue running={statusLine} queued={queued.map((qid, index) => ({ id: qid, text: i18n._({ id: "Message {n} is waiting", message: "Message {n} is waiting", values: { n: index + 1 } }) }))} onCancel={(qid) => void run(() => codeApi.cancelQueued(id, qid), i18n._({ id: "That message is not waiting any more.", message: "That message is not waiting any more." }))} /></div> : null}
          {problem ? <StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={problem} /> : null}
          <Stack as="form" onSubmit={(event) => { event.preventDefault(); void send(); }}>
            <Textarea value={text} rows={3} onChange={(event) => setText(event.target.value)} aria-label={i18n._({ id: "Message to the agent", message: "Message to the agent" })} placeholder={i18n._({ id: "Message the agent", message: "Message the agent" })}
              onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void send(); } }} />
            <Stack row className="justify-end"><Button type="submit" disabled={!text.trim() || busy}>{i18n._({ id: "Send", message: "Send" })}</Button></Stack>
          </Stack>
          <p role="status" data-slot="code-status" className="text-body text-muted-foreground">{statusLine}</p>
        </div>
      </Stack>
      {pane}
    </Stack>
  );
}
