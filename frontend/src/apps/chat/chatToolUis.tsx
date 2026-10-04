// The chat thread's tool-call renderers (spec sheet, artifact card, confirm,
// project, tool timeline), moved verbatim out of NextChatPage.tsx
// (SHARED-THREAD-01). elementBindings.ts maps tool ids to these.
import { useCallback, useContext, useEffect, useState, type MutableRefObject, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAui, useAuiState, type ToolApprovalOption, type ToolCallMessagePartComponent } from "@assistant-ui/react";
// APPROVE-CARD-01: the same vendored Element `thread.aui.tsx`'s own
// default `ToolFallback` renders (its own `import { ToolFallback } from
// "@maipai/ui/src/assistant-ui/tool-fallback.aui"`) - used here directly
// so a "confirm" card renders through `ToolFallback.Approval` exactly as
// it ships, never a hand-built card (the kit's own `approval-card.tsx`
// is built for a terminal command and can't be relabeled, per the org's
// "no hand-built UI" rule).
import { ToolFallback } from "@maipai/ui/src/assistant-ui/tool-fallback.aui";
import { SpecSheet } from "@maipai/ui/src/elements/spec-sheet";
import { ArtifactCard } from "@maipai/ui/src/elements/artifact-card";
import { ToolTimeline } from "@maipai/ui/src/elements/tool-timeline";
import { JobProgress, type JobStage } from "@maipai/ui/src/elements/job-progress";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@maipai/ui/src/ui/dropdown-menu";
// The Elements' own smaller `Button` (not the dashboard `Button` this
// file otherwise uses), because this one renders as a sibling of Copy/
// Reload/etc INSIDE the assistant-ui action bar itself (matching what
// TooltipIconButton, thread.aui.tsx's own action-bar button, wraps) -
// the dashboard Button belongs to the surrounding page chrome, not this
// row.
import { Button } from "@maipai/ui/src/ui/button";
import { TurnErrorDetails } from "@/next/pages/TurnErrorDetails";
import { getIcon } from "@maipai/ui/src/icons";
import { api, type StructuredPart, type TurnStats, type ProjectView } from "@/lib/api";
import { ArtifactOpenContext, ReloadMainThreadContext, ConfirmAskAnswerContext, AdminContext } from "@/apps/chat/chatThreadContexts";
import { faviconUrl } from "@/apps/chat/chatThreadSlots";

// SHELL-02 slice 3, the wiring table's "spec-sheet" row: weather's and
// almanac-date's own structured result (chatModelAdapter.ts's own
// tool-call part, built from `structured_part`) renders through the
// shipped Element, never Home-drawn prose. `useAssistantToolUI` is
// `@assistant-ui/react`'s own deprecated-but-supported render-only
// registration (its replacement, a client toolkit's own `render`, is
// shaped for a tool the FRONTEND can invoke - `parameters`, `execute` -
// which nothing here is: every package these results come from already
// ran, server-side, before this reply ever streamed). `visibleCount`
// is the whole row set - `SpecSheet`'s own progressive-reveal knob has
// nothing to progress against on an already-complete result. Any tool
// call whose name isn't registered here still renders through Thread's
// own built-in `ToolFallback` (thread.aui.tsx's default), unchanged.
export const SpecSheetToolRender: ToolCallMessagePartComponent<Record<string, never>, StructuredPart> = ({ result }) => {
  if (!result) return null;
  return <SpecSheet title={result.title} subtitle={result.subtitle} rows={result.rows} visibleCount={result.rows.length} />;
};

export const ArtifactCardToolRender: ToolCallMessagePartComponent<Record<string, never>, { id: string; version: number }> = ({ result }) => {
  const openArtifact = useContext(ArtifactOpenContext);
  const query = useQuery({
    queryKey: ["artifact-current", result?.id],
    queryFn: () => api.artifactCurrent(result!.id),
    enabled: result !== undefined,
  });
  if (!result) return null;
  const data = query.data;
  // A code review caught this: on a failed fetch (the artifact later
  // deleted, a transient network error), `isLoading` settles to false
  // with `data` still undefined - without this branch the card was
  // stuck reading a non-spinning "Loading..." forever, never an error.
  const meta = data ? `${data.kind} · v${data.version}` : query.isError ? "Not available right now" : "Loading…";
  return (
    <ProducedArtifactCard id={result.id} title={data?.title ?? "Document"} meta={meta} generating={query.isLoading} onOpen={() => openArtifact(result.id)} />
  );
};

export function ProducedArtifactCard({ id, title, meta, generating, onOpen }: { id: string; title: string; meta: string; generating: boolean; onOpen: () => void }) {
  const navigate = useNavigate();
  const MoreIcon = getIcon("more-horizontal");
  return (
    <div className="flex w-full max-w-sm items-center gap-1" data-slot="produced-artifact-card">
      <ArtifactCard className="min-w-0 flex-1" title={title} meta={meta} generating={generating} onClick={onOpen} />
      <div className="shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" aria-label="More">
              <MoreIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={onOpen}>Open</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => { window.location.assign(`/api/artifacts/${encodeURIComponent(id)}/export`); }}>Download</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate("/files")}>Show in Library</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}


export const CONFIRM_APPROVAL_OPTIONS: readonly ToolApprovalOption[] = [
  { id: "yes", kind: "allow-once", label: "Yes" },
  { id: "no", kind: "reject-once", label: "No" },
];

// APPROVE-CARD-01: a package's own confirm_needed/consent_needed ask
// (turnNext.ts's finishTurn() "asked" branch), rendered through the
// shipped `ToolFallback.Approval` exactly as it ships - never the kit's
// own `approval-card.tsx` (built for a terminal command, can't be
// relabeled). The tool-call part's own `result` carries
// `{package_id, open, turn_id}` (chatModelAdapter.ts/chatHistoryAdapter.ts),
// never the part's own `approval` field: setting a REAL `part.approval`
// would mark the message `requires-action` in assistant-ui's
// LocalRuntime and re-run the model adapter on this SAME assistant
// message once answered - wrong here, since Home parks the ask
// server-side and the answer is a genuinely new turn. The `approval`
// object below is synthesized purely for THIS component's own render
// logic (never written back onto the real message part, which never
// carries one), and `respondToApproval` here is OUR OWN handler, never
// the real one `ToolCallMessagePartProps` would supply (that one is
// only ever valid while a real `part.approval` is set - ours never is).
export const ConfirmToolRender: ToolCallMessagePartComponent<Record<string, never>, { package_id: string; open: boolean; turn_id: string }> = ({ result }) => {
  const respond = useContext(ConfirmAskAnswerContext);
  if (!result) return null;
  return (
    <ToolFallback.Approval
      approval={{
        id: result.turn_id,
        options: CONFIRM_APPROVAL_OPTIONS,
        // The component's own source (tool-fallback.aui.tsx): a
        // `resolution` set at all - "cancelled" or "expired" - suppresses
        // interactive rendering entirely (its top guard returns null),
        // never partially disables it. `open: false` (an answered,
        // superseded, or reload-stale ask - conversationHistory.ts's own
        // read-time derivation) is exactly a "no longer waiting for an
        // answer" case, so "expired" is the honest value here.
        resolution: result.open ? undefined : "expired",
      }}
      respondToApproval={async (response) => {
        // Our own two options are both known kinds with no `confirm`
        // step, so `ToolFallbackApproval`'s own `respondWithOption()`
        // always calls this with `{optionId: "yes" | "no"}` - never the
        // `approved` field a real runtime resolution would carry (that
        // derivation is the runtime's job for a real `part.approval`,
        // which this never is).
        const approved = "optionId" in response ? response.optionId === "yes" : false;
        respond(result.turn_id, approved);
      }}
    />
  );
};

// PROJECT-PROGRESS-01: once a project finishes with a real posted
// artifact, this replaces the JobProgress card below with the exact same
// artifact-card render ArtifactCardToolRender above uses for a
// `write_document` turn - a small dedicated component rather than
// reusing that one directly (its own type is a `ToolCallMessagePartComponent`,
// shaped for `useAssistantToolUI`'s full prop set, not a bare `{id}`
// caller). Same query key (`["artifact-current", id]`) as that render,
// so the two share a cache entry if a reload's own real `artifact` field
// ever fetches the identical id.
export function ProjectFinishedArtifact({ id }: { id: string }) {
  const openArtifact = useContext(ArtifactOpenContext);
  const reloadMainThread = useContext(ReloadMainThreadContext);
  const query = useQuery({ queryKey: ["artifact-current", id], queryFn: () => api.artifactCurrent(id) });
  const data = query.data;
  const meta = data ? `${data.kind} · v${data.version}` : query.isError ? "Not available right now" : "Loading…";
  // Jesse, live-found 2026-09-27: "auto open the canvas when the book
  // is ready... this should be the default." This component only ever
  // mounts live: a reload turns a finished project's row into a plain
  // `write_document`-shaped artifact (chatHistoryAdapter.ts's own #182
  // rule hides `row.project` once `row.artifact` is set), so there is
  // no "reopening old history" case here to guard against the way
  // chatModelAdapter.ts's own onArtifactReady comment has to - every
  // mount of this component genuinely means the artifact just became
  // available in front of whoever has this thread open right now.
  //
  // `reloadMainThread()` rides the SAME effect (Jesse, live-found the
  // same day): without it, the surrounding reply text stayed on its own
  // stream-time "Creating…" wording until ProjectResultReload's own,
  // separate notification poll (up to 15s later) happened to catch up -
  // two different events, on two different timers, for what reads as
  // one "it's done" moment. This reload picks up post.ts's own corrected
  // replyText ("<title> is ready.") the moment the SAME poll tick that
  // opens the canvas sees the project is done, not on a second, slower
  // poll's own schedule.
  useEffect(() => {
    openArtifact(id);
    reloadMainThread();
  }, [id, openArtifact, reloadMainThread]);
  return <ProducedArtifactCard id={id} title={data?.title ?? "Document"} meta={meta} generating={query.isLoading} onOpen={() => openArtifact(id)} />;
}

// PROJECT-PROGRESS-01 (issue #180): a project's own dependency-graph
// plan has no percentage or per-step label to report (steps.ts's own
// header) - v1's whole "how far along" signal is which step is still
// pending/running versus already settled. `done`/`failed`/`skipped` all
// count as settled: nothing further ever runs on any of them, so the
// progress bar should already credit them, not just `done`.
export function projectStages(steps: ProjectView["steps"]): JobStage[] {
  return steps.map((step) => ({ name: step.stepId, weight: 1 }));
}

export function projectStageIndex(steps: ProjectView["steps"]): number {
  const index = steps.findIndex((step) => step.state === "pending" || step.state === "running");
  return index === -1 ? steps.length : index;
}

// The design record's own poll interval - fast enough to read as "alive"
// (issue #180's own ask: ChatGPT-style visible progress, not silence),
// slow enough not to be a real load for a household hub (ModelsSection.tsx's
// own model-download job poll is the precedent this mirrors, 1s there
// since that download job DOES report a real byte-progress percentage;
// this one only ever moves once a whole step settles, so 2s is plenty).
export const PROJECT_POLL_MS = 2000;

// A terminal (`done`/`failed`) project with no `posted_artifact` yet is
// either the brief FK-race window post.ts's own header names (resolves
// within one more tick almost always - postProjectResult() saves the
// state and posts the artifact in the same synchronous pass) or a
// project started from an incognito thread (post.ts never creates one
// there - "no thread to post to"). This caps the extra polling to a
// handful of ticks so the second case gives up instead of polling
// forever for a card that will never arrive - a code review's own
// finding: the first cut stopped polling the instant `done` appeared, no
// matter whether the artifact had actually landed yet.
export const PROJECT_SETTLED_ARTIFACT_POLL_LIMIT = 5;

// react-query's own function-form `refetchInterval` is this file's
// idiomatic way to poll (every other tool-call render here - SpecSheet,
// ArtifactCard above - already reads through `useQuery`, never a
// hand-rolled `setInterval`) - the STOP condition it implements is
// ModelsSection.tsx's own precedent ("poll the active job while it's
// actually in flight; stop as soon as it lands on ready/failed so an
// idle page never keeps a timer running"), the same rule applied here to
// a project's own terminal states.
export const ProjectToolRender: ToolCallMessagePartComponent<Record<string, never>, { id: string }> = ({ result }) => {
  const query = useQuery({
    queryKey: ["project", result?.id],
    queryFn: () => api.project(result!.id),
    enabled: result !== undefined,
    refetchInterval: (q) => {
      // A persistently failing poll (the project row gone, a transient
      // error) never gets hammered every 2s forever - a code review's
      // own finding: this had no error branch at all before, so a
      // permanent fetch failure polled indefinitely with nothing ever
      // shown.
      if (q.state.status === "error") return false;
      const data = q.state.data;
      if (!data) return PROJECT_POLL_MS;
      if (data.state === "cancelled") return false;
      const settled = data.state === "done" || data.state === "failed";
      if (!settled) return PROJECT_POLL_MS;
      return data.posted_artifact || q.state.dataUpdateCount >= PROJECT_SETTLED_ARTIFACT_POLL_LIMIT ? false : PROJECT_POLL_MS;
    },
  });
  if (!result) return null;
  const project = query.data;
  if (!project) {
    // A persistently failing fetch gets a real (if quiet) line, not
    // silence forever - the same isError branch ArtifactCardToolRender/
    // ProjectFinishedArtifact below already have for their own fetch.
    if (query.isError) return <p className="text-sm text-destructive">Couldn't check on this project right now.</p>;
    // Nothing to show yet on the very first, still-in-flight poll - the
    // reply's own text already told the person the project started
    // (tool.ts's own `runStartProjectTool()` phrasing), so a brief gap
    // with no card here reads as "the reply is still settling," not as
    // silence.
    return null;
  }
  // On finish, the artifact card takes over from the progress bar - the
  // design record's own "the live tab needs to show the posted artifact
  // without a reload." Checked for `failed` too, not just `done`: post.ts's
  // own header posts a real document either way (a failure summary for
  // `failed`), only `cancelled` posts nothing.
  if ((project.state === "done" || project.state === "failed") && project.posted_artifact) {
    return <ProjectFinishedArtifact id={project.posted_artifact.id} />;
  }
  if (project.state === "failed") {
    return <p className="text-sm text-destructive">{project.title} didn't finish{project.error ? `: ${project.error}` : "."}</p>;
  }
  if (project.state === "cancelled") {
    return <p className="text-muted-foreground text-sm">{project.title} was cancelled.</p>;
  }
  const stages = projectStages(project.steps);
  const stageIndex = projectStageIndex(project.steps);
  return (
    <JobProgress
      title={project.title}
      stages={stages}
      stageIndex={stageIndex}
      stageProgress={0}
      eta={`Step ${Math.min(stageIndex + 1, stages.length)} of ${stages.length}`}
      onCancel={() => {
        void api
          .cancelProject(project.id)
          .then(() => query.refetch())
          .catch(() => {
            /* the next poll tick (still running while a cancel is in flight) settles this either way */
          });
      }}
    />
  );
};


// APPROVE-CARD-01: computes the actual send callback and provides it
// through `ConfirmAskAnswerContext` - mounted at the SAME root level as
// `LiveVoiceSession` below (a sibling of `Thread`, never nested inside
// it), the one place `useAui()` resolves to the thread-level composer
// rather than a message/part-scoped one (`ConfirmAskAnswerContext`'s own
// doc comment has the live "Composer is not available" failure this
// fixed). `askAnswerRef` is armed here, synchronously, before the
// composer send - the same single-shot shape `spokenNextRef` already
// uses for VOICE-LIVE-02's live voice session; `chatModelAdapter.ts`'s
// own `consumeAskAnswer()` reads AND resets it.
export function ConfirmAskAnswerProvider({ askAnswerRef, children }: { askAnswerRef: MutableRefObject<{ turnId: string; approved: boolean } | undefined>; children: ReactNode }) {
  const aui = useAui();
  const respond = useCallback(
    (turnId: string, approved: boolean) => {
      askAnswerRef.current = { turnId, approved };
      aui.composer.setText(approved ? "Yes" : "No");
      void Promise.resolve(aui.composer.send());
    },
    [aui, askAnswerRef],
  );
  return <ConfirmAskAnswerContext.Provider value={respond}>{children}</ConfirmAskAnswerContext.Provider>;
}

// ReloadMainThreadContext's own provider - the same "call useAui() once,
// correctly scoped, hand the closure down" shape as ConfirmAskAnswerProvider
// above. `void` on the returned promise: ProjectFinishedArtifact's own
// effect (the one caller) fires this alongside openArtifact(), not
// something that needs awaiting there.
export function ReloadMainThreadProvider({ children }: { children: ReactNode }) {
  const aui = useAui();
  const reload = useCallback(() => {
    // A background refresh's own failure (a transient network error, a
    // thread switched away from before this lands) is never worth
    // surfacing - the live poll driving ProjectFinishedArtifact already
    // has the canvas open and correct; this is only ever a courtesy
    // resync of the surrounding text, not something anything else here
    // waits on. Caught, not left to become an unhandled rejection: `void`
    // alone discards the reference but not a real rejection.
    aui.threads.reloadMainThread().catch(() => {});
  }, [aui]);
  return <ReloadMainThreadContext.Provider value={reload}>{children}</ReloadMainThreadContext.Provider>;
}


// TOOL-EVENTS-01's own frontend half, consumer before producer (the same
// order slice 5(a)'s sources card and slice 4's artifact card landed in):
// chatModelAdapter.ts already parses tool_call/tool_result/tool_error
// (spec-v0.1.16) into a `{callId, packageId, state}[]` synthetic tool-
// call part, `toolName: "tool_timeline"` - fixed, matching the reserved-
// name list `weather`/`almanac-date`/`sources` already keep (never a
// package's own id). Nothing in the running app emits it yet (the
// backend half of TOOL-EVENTS-01 hasn't landed), so this renders nothing
// live today - covered by chatModelAdapter.test.ts and NextChatPage.
// test.tsx's own scripted-stream cases instead.
// `label` (COORDINATOR, 2026-09-22): spec-v0.1.17 will add an optional
// human label to `tool_call` (a manifest's own `tool_label`, "Checking
// the weather for Seattle" - the gap this file's own comment above named
// back to the lane). Not on the currently pinned spec-v0.1.16 shape, so
// `chatModelAdapter.ts` never sets it and this always falls back to the
// package id today - the seam is here so the chip starts reading a real
// label automatically the moment a later pin bump's adapter change
// starts providing one, with no render-side change needed then.
export type TimelineCall = { callId: string; packageId: string; label?: string; state: "running" | "ok" | "error"; sites?: { host: string; url: string }[] };
export const TIMELINE_VERB: Record<TimelineCall["state"], string> = {
  running: "Running",
  ok: "Ran",
  error: "Failed",
};
export const ToolTimelineIcon = getIcon("wrench");

export function toolTimelineRestingLabel(stepCount: number, stats: TurnStats | undefined): string {
  const totalTimeMs = stats?.total_time_ms;
  if (totalTimeMs == null) return `${stepCount} tool call${stepCount === 1 ? "" : "s"}`;
  if (totalTimeMs < 60_000) {
    const seconds = Math.round(totalTimeMs / 1000);
    return `Worked for ${seconds} second${seconds === 1 ? "" : "s"}, ${stepCount} step${stepCount === 1 ? "" : "s"}`;
  }
  const minutes = Math.round(totalTimeMs / 60_000);
  return `Worked for ${minutes} minute${minutes === 1 ? "" : "s"}, ${stepCount} step${stepCount === 1 ? "" : "s"}`;
}

export const ToolTimelineToolRender: ToolCallMessagePartComponent<Record<string, never>, TimelineCall[]> = ({ result }) => {
  const [open, setOpen] = useState(false);
  const stats = useAuiState((s) => s.message.metadata?.custom?.stats as TurnStats | undefined);
  const isAdmin = useContext(AdminContext);
  const turnId = useAuiState((s) => s.message.metadata?.custom?.turnId as string | undefined);
  if (!result?.length) return null;
  const running = result.some((call) => call.state === "running");
  // THIN-1E: an admin's quiet way into the raw details of a failed call.
  const failed = isAdmin && !!turnId && result.some((call) => call.state === "error");
  return (
    <div className="flex items-start gap-1">
    <ToolTimeline
      steps={result.map((call) => ({ verb: TIMELINE_VERB[call.state], chip: call.label ?? call.packageId, icon: ToolTimelineIcon, sites: call.sites }))}
      visibleSteps={result.length}
      streaming={running}
      // `w-auto`: the indicator below sits beside the timeline, not at the end of its full-width box.
      className={failed ? "w-auto" : undefined}
      open={open}
      onOpenChange={setOpen}
      activeLabel="Working…"
      restingLabel={toolTimelineRestingLabel(result.length, stats)}
      // No producer for a per-file diff-stat summary anywhere in Home
      // today (the kit's own upstream use is a coding-agent timeline) -
      // a named gap, not invented data.
      stats={[]}
      // SRC-ICON-01's own proxy (never the shipped default) - the same
      // function `SourcesFooterContent` below already passes to `SourceIcon`.
      faviconUrl={faviconUrl}
    />
    {failed ? <TurnErrorDetails turnId={turnId} /> : null}
    </div>
  );
};



// The "sources" tool call still needs SOME registration or assistant-ui's own
// fallback UI renders it inline in the message content - same no-op shape as
// ChatPage.tsx's `SuppressLegacySourcesFallback` (`623878a6`), for the
// identical reason: the real render happens in the action-bar trigger and
// message-footer slots (chatThreadSlots.tsx), not in the message body.
export const SourcesNoopRender: ToolCallMessagePartComponent = () => null;
