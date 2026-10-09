// The chat thread's tool-call renderers (spec sheet, artifact card, confirm,
// project, tool timeline), moved verbatim out of ChatPage.tsx
// (SHARED-THREAD-01). elementBindings.ts maps tool ids to these.
import { useCallback, useContext, useEffect, useState, type MutableRefObject, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAui, useAuiState, type ToolCallMessagePartComponent } from "@assistant-ui/react";
import { ApprovalCard } from "@maipai/ui/src/elements/approval-card";
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
import { getIcon } from "@maipai/ui/src/icons";
import { Kbd } from "@maipai/ui/src/dashboard/components/ui/kbd";
import { useSurface } from "@maipai/ui/src/useSurface";
import { api, type StructuredPart, type TurnStats, type ProjectView } from "@/lib/api";
import { ArtifactOpenContext, ReloadMainThreadContext, ConfirmAskAnswerContext } from "@/apps/chat/chatThreadContexts";
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
  const query = useQuery<Awaited<ReturnType<typeof api.artifactCurrent>>>({
    queryKey: ["artifact-current", result?.id],
    queryFn: () => import.meta.env.DEV && result?.id === "showcase-artifact-card"
      ? Promise.resolve({
          id: "showcase-artifact-card", conversation_id: "showcase", turn_id: "showcase-artifact-card",
          title: "Weekend storybook", kind: "markdown", body: "A weekend storybook for the family.", version: 1,
          parent_version: null, created_by: "showcase", provenance: "showcase", created_at: "2026-10-08T00:00:00.000Z", hlc: "1788000000000:0:showcase",
        })
      : api.artifactCurrent(result!.id),
    enabled: result !== undefined,
  });
  if (!result) return null;
  const data = query.data;
  // A code review caught this: on a failed fetch (the artifact later
  // deleted, a transient network error), `isLoading` settles to false
  // with `data` still undefined - without this branch the card was
  // stuck reading a non-spinning "Loading..." forever, never an error.
  const meta = data ? `${data.kind} · v${data.version}` : query.isError ? "Not available right now" : "Loading…";
  const navigate = useNavigate();
  const MoreIcon = getIcon("more-horizontal");
  const onOpen = () => openArtifact(result.id);
  return (
    <ArtifactCard
      title={data?.title ?? "Document"}
      meta={meta}
      generating={query.isLoading}
      onClick={onOpen}
      actions={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" aria-label="More">
              <MoreIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={onOpen}>Open</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => { window.location.assign(`/api/artifacts/${encodeURIComponent(result.id)}/export`); }}>Download</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate("/files")}>Show in Library</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    />
  );
};


function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.tagName === "SELECT";
}

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

// APPROVE-CARD-02: map the server-parked ask to the kit's shipped
// ApprovalCard. The tool-call part carries `{package_id, open, turn_id}`;
// answering still sends a genuinely new turn through Home's lifted handler.
export const ConfirmToolRender: ToolCallMessagePartComponent<Record<string, never>, { package_id: string; open: boolean; turn_id: string }> = function ConfirmToolRender({ result }) {
  const respond = useContext(ConfirmAskAnswerContext);
  const createdAt = useAuiState((state) => state.message.createdAt);
  // A reply after this one means the ask was answered or passed over: the
  // hub clears a parked ask on the next turn, and a reload reads it closed
  // (conversationHistory.ts). Live, `open` stays true on this stored
  // result, so the card closes itself once it is no longer the last message.
  const isLast = useAuiState((state) => state.message.isLast);
  const pointer = useSurface().pointer;
  const open = result?.open === true && isLast;
  const turnId = result?.turn_id;
  // APPROVE-CALM-01: Ctrl (or Cmd) and Enter approve the one open ask,
  // except while the person is typing somewhere (the composer's own keys).
  useEffect(() => {
    if (!open || !turnId) return;
    let answered = false;
    const onKeyDown = (event: KeyboardEvent) => {
      if (answered || event.key !== "Enter" || !(event.ctrlKey || event.metaKey) || event.defaultPrevented || isTypingTarget(event.target)) return;
      event.preventDefault();
      answered = true;
      respond(turnId, true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, turnId, respond]);
  if (!result || !open || !turnId) return null;
  const ShieldCheckIcon = getIcon("shield-check");
  const createdAtDate = createdAt instanceof Date ? createdAt : createdAt ? new Date(createdAt) : undefined;
  const waitingSince = createdAtDate && !Number.isNaN(createdAtDate.getTime())
    ? ` Waiting since ${createdAtDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    : "";
  return (
    <ApprovalCard
      state="request"
      icon={<ShieldCheckIcon aria-hidden />}
      title="Go ahead?"
      subtitle={`Nothing happens until you choose.${waitingSince}`}
      allowHint={pointer === "fine" ? <Kbd aria-hidden>{IS_MAC ? "⌘ ↵" : "Ctrl ↵"}</Kbd> : undefined}
      onAllowOnce={() => respond(turnId, true)}
      onDeny={() => respond(turnId, false)}
    />
  );
};

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
  const openArtifact = useContext(ArtifactOpenContext);
  const reloadMainThread = useContext(ReloadMainThreadContext);
  const navigate = useNavigate();
  const MoreIcon = getIcon("more-horizontal");
  const query = useQuery({
    queryKey: ["project", result?.id],
    queryFn: () => import.meta.env.DEV && result?.id === "showcase-job-progress"
      ? Promise.resolve({
          id: "showcase-job-progress", type: "adhoc", title: "Weekend storybook", state: "running",
          plan: { steps: [], ceilings: { maxWallSeconds: 120, maxGeneratorJobs: 1 } },
          steps: [{ stepId: "chapter-one", state: "running", startedAt: new Date().toISOString(), endedAt: null, error: null, artifactIds: [] }, { stepId: "chapter-two", state: "pending", startedAt: null, endedAt: null, error: null, artifactIds: [] }],
          artifacts: [], provenance: { person: "showcase", conversationId: "showcase", turnId: "showcase-job-progress", planSource: "model" },
          error: null, hlc: "1788000000000:0:showcase", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), posted_artifact: null,
        } as ProjectView)
      : api.project(result!.id),
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
  const artifactId = query.data?.posted_artifact?.id;
  const artifactQuery = useQuery({
    queryKey: ["artifact-current", artifactId],
    queryFn: () => api.artifactCurrent(artifactId!),
    enabled: artifactId !== undefined,
  });
  useEffect(() => {
    if (!artifactId) return;
    openArtifact(artifactId);
    reloadMainThread();
  }, [artifactId, openArtifact, reloadMainThread]);
  if (!result) return null;
  const project = query.data;
  if (!project) {
    // Keep a failed project lookup visible through the shipped progress
    // Element, so a lost poll does not leave the person with silence.
    if (query.isError) {
      return <JobProgress title="Project" stages={[]} stageIndex={0} stageProgress={0} outcome={{ status: "failed", summary: "Couldn't check on this project right now." }} />;
    }
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
    const id = project.posted_artifact.id;
    const data = artifactQuery.data;
    const meta = data ? `${data.kind} · v${data.version}` : artifactQuery.isError ? "Not available right now" : "Loading…";
    const onOpen = () => openArtifact(id);
    return (
      <ArtifactCard
        title={data?.title ?? "Document"}
        meta={meta}
        generating={artifactQuery.isLoading}
        onClick={onOpen}
        actions={
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
        }
      />
    );
  }
  const stages = projectStages(project.steps);
  const stageIndex = projectStageIndex(project.steps);
  if (project.state === "failed" || project.state === "cancelled") {
    return (
      <JobProgress
        title={project.title}
        stages={stages}
        stageIndex={stageIndex}
        stageProgress={0}
        outcome={project.state === "failed"
          ? { status: "failed", summary: project.error ?? "This project didn't finish." }
          : { status: "cancelled", summary: "This project was cancelled." }}
      />
    );
  }
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
// through `ConfirmAskAnswerContext` - mounted at the top of
// `AssistantRuntimeProvider` as a sibling of `Thread`, never nested
// inside it, the place `useAui()` resolves to the thread-level composer
// rather than a message/part-scoped one (`ConfirmAskAnswerContext`'s own
// doc comment has the live "Composer is not available" failure this
// fixed). `askAnswerRef` is armed here, synchronously, before the
// composer send - the same single-shot shape `pendingSpeechRef` already
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
// live today - covered by chatModelAdapter.test.ts and ChatPage.
// test.tsx's own scripted-stream cases instead.
// `label` (COORDINATOR, 2026-09-22): spec-v0.1.17 will add an optional
// human label to `tool_call` (a manifest's own `tool_label`, "Checking
// the weather for Seattle" - the gap this file's own comment above named
// back to the lane). Not on the currently pinned spec-v0.1.16 shape, so
// `chatModelAdapter.ts` never sets it and this always falls back to the
// package id today - the seam is here so the chip starts reading a real
// label automatically the moment a later pin bump's adapter change
// starts providing one, with no render-side change needed then.
export type TimelineCall = { callId: string; packageId: string; label?: string; state: "running" | "ok" | "error"; failureKind?: string; sites?: { host: string; url: string }[] };
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
  if (!result?.length) return null;
  const running = result.some((call) => call.state === "running");
  // CHAT-CALM-ERRORS-01c (design section 10): a failed call's raw details
  // live in the action bar's one details control (chatThreadSlots.tsx),
  // never in a box under the timeline.
  return (
    <ToolTimeline
      steps={result.map((call) => ({ verb: TIMELINE_VERB[call.state], chip: call.label ?? call.packageId, icon: ToolTimelineIcon, sites: call.sites }))}
      visibleSteps={result.length}
      streaming={running}
      open={open}
      onOpenChange={setOpen}
      activeLabel="Working…"
      restingLabel={toolTimelineRestingLabel(result.length, stats)}
      // No producer for a per-file diff-stat summary anywhere in Home
      // today (the kit's own upstream use is a coding-agent timeline) -
      // a named gap, not invented data.
      stats={[]}
      // SRC-ICON-01's own proxy (never the shipped default).
      faviconUrl={faviconUrl}
    />
  );
};
