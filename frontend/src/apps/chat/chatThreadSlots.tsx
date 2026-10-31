// The chat thread's slot components (more-menu items, composer extras,
// thinking indicator, welcome, reasoning group, sources and message footer),
// moved verbatim out of ChatPage.tsx (SHARED-THREAD-01). ChatThread.tsx
// hands them to the kit Thread.
import { useMakingAvailability } from "@/apps/chat/useMakingAvailability";
import { useReplyFeedbackForm } from "@/apps/chat/chatFeedbackDialog";
import { Avatar } from "@maipai/ui/src/primitives/Avatar";
import { starterGreeting } from "@/apps/chat/starterGreeting";
import { FeedbackDialog } from "@maipai/ui/src/elements/feedback-dialog";
import { MemoryChips } from "@maipai/ui/src/elements/memory-chips";
import { memoryChipsAllowed, useReplyMemoryChips } from "@/apps/chat/chatMemoryChips";
import { ChatActorContext, rememberMessage } from "@/apps/chat/chatMemoryActions";
import { RetryWithCurrentCompanionSetterContext } from "@/apps/chat/chatThreadContexts";
import { useContext, useEffect, useState, type PropsWithChildren } from "react";
import { GuardrailNotice } from "@maipai/ui/src/elements/guardrail-notice";
import type { CrisisSupport } from "@maipai/home-backend/src/wire";
import { ActionBarMorePrimitive, ComposerPrimitive, useAui, useAuiState, type ThreadAssistantMessagePart, type ThreadMessage } from "@assistant-ui/react";
import { type ThreadGroupPart } from "@maipai/ui/src/elements/thread.aui";
// APPROVE-CARD-02: confirmation is rendered by the named approval-card
// binding; the lifted context below lets it send an answer as a new turn.
import { useReasoningOpen } from "@/apps/chat/useReasoningOpen";
import { ReasoningRoot, ReasoningTrigger, ReasoningContent, ReasoningText } from "@maipai/ui/src/elements/reasoning.aui";
import { thoughtForLabel } from "@maipai/ui/src/elements/reasoning";
import { useThinkingWord } from "@/apps/chat/useThinkingWord";
import { DONE_THINKING_ANNOUNCEMENT, STATIC_THINKING_WORD } from "@/apps/chat/thinkingWords";
import { Sources as SourcesCard } from "@maipai/ui/src/elements/sources";
import { ThinkingIndicator } from "@maipai/ui/src/elements/thinking-indicator";
import { EmptyState, EmptyStateGreeting, EmptyStateSuggestion, EmptyStateSuggestions } from "@maipai/ui/src/elements/empty-state";
import { STARTER_SUGGESTIONS } from "@/apps/chat/chatStarterSuggestions";
import { GenerationLoader } from "@maipai/ui/src/elements/loading-state";
import { MessageTiming, type TimingStat } from "@maipai/ui/src/elements/message-timing";
import { MessageQueue } from "@maipai/ui/src/elements/message-queue";
import { StoppedRun } from "@maipai/ui/src/elements/stopped-run";
import { ContextDisplay } from "@maipai/ui/src/elements/context-display";
import { BackgroundInbox } from "@maipai/ui/src/elements/background-inbox";
import { TaskCard } from "@maipai/ui/src/elements/task-card";
import { ModelSelectorRoot, ModelSelectorTrigger, ModelSelectorContent, ModelSelectorEffort } from "@maipai/ui/src/elements/model-selector";
// The Elements' own smaller `Button` (not the dashboard `Button` this
// file otherwise uses), because this one renders as a sibling of Copy/
// Reload/etc INSIDE the assistant-ui action bar itself (matching what
// TooltipIconButton, thread.aui.tsx's own action-bar button, wraps) -
// the dashboard Button belongs to the surrounding page chrome, not this
// row.
import { Button as ElementsButton } from "@maipai/ui/src/elements/ui/button";
import { Button as KitButton } from "@maipai/ui/src/ui/button";
import { Badge } from "@maipai/ui/src/dashboard/components/ui/badge";
import { getIcon } from "@maipai/ui/src/icons";
import { api, type StatusAppsResponse, type TurnErrorDetail, type TurnStats } from "@/lib/api";
import { CONTEXT_SEGMENT_KEYS, type ContextSegmentKey } from "@maipai/home-backend/src/wire";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@maipai/ui/src/ui/tooltip";
import { StatusIndicator } from "@maipai/ui/src/ui/status";
import { useStatusApps } from "@/shell/useStatusApps";
import { appStatusToSidebar } from "@/shell/statusApps";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { picturesApi } from "@/lib/picturesApi";
import { videosApi } from "@/lib/videosApi";
import { ReloadMainThreadContext } from "@/apps/chat/chatThreadContexts";
import { Link, useSearchParams } from "react-router-dom";
import { sourcesFromMessage } from "@/apps/chat/chatSources";
import { messageText } from "@/apps/chat/chatMessageText";
import { useStoppedRun } from "@/apps/chat/chatStoppedRun";
import { useTurnActivity } from "@/apps/chat/chatTurnActivity";
import { BranchInNewChatMenuItem } from "@/apps/chat/branchInNewChatMenuItem";
import { useChatActivity } from "@/apps/chat/chatActivity";
import { ComposerVoiceControls } from "@/apps/chat/composerVoiceControls";
import { AdminContext, ChatAgeBandContext, ChatComposerNoticeContext, CompareOpenContext, SourcesOpenContext, DetailsOpenContext, ThinkingModeContext, ThinkingModeCapabilityContext, BareModeContext, TemporaryChatContext, WakeWordPersonContext } from "@/apps/chat/chatThreadContexts";
import { ChatAvailabilityContext, useEngineDownReason } from "@/apps/chat/useChatAvailability";
import { TurnErrorDetails, hasErrorFacts } from "@/shell/pages/TurnErrorDetails";
import { useCompanionPresence } from "@/apps/chat/useCompanionPresence";
import { CompanionAvatar } from "@maipai/ui/src/elements/companion-avatar";
import { DraftConversationContext } from "@/apps/chat/chatThreadContexts";

// ADMIN-COMPARE-01: no icon in the kit's own registry reads as "compare"
// specifically - grid-2x2 (a two-pane split) is the closest already-
// registered fit, chosen over adding a new one to keep this item to the
// one kit tag it already needed for the action bars themselves.
export const CompareIcon = getIcon("grid-2x2");
export const DetailsIcon = getIcon("gauge");
const QueueSendIcon = getIcon("arrow-up");

export function ComposerExtraControls() {
  const engineDown = useEngineDownReason();
  const isRunning = useAuiState((s) => s.thread.isRunning && s.thread.voice === undefined && s.thread.capabilities.queue);
  const writtenTurnBusy = useAuiState((s) => s.thread.isRunning || s.composer.queue.length > 0);
  return (
    <>
      <ComposerVoiceControls disabled={writtenTurnBusy} engineDown={engineDown} />
      {isRunning ? (
        <ComposerPrimitive.Send asChild>
          <ElementsButton type="button" size="icon" className="size-7 rounded-full" aria-label="Queue message" title="Queue message" disabled={engineDown !== undefined}>
            <QueueSendIcon className="size-4" />
          </ElementsButton>
        </ComposerPrimitive.Send>
      ) : null}
    </>
  );
}

/** The notice's dot colour from the same state the rail's Chat icon reads
 * (the status board's Chat app, via appStatusToSidebar). A notice only shows
 * while chat cannot answer, so no reading yet is amber. */
function chatNoticeLevel(apps: StatusAppsResponse | undefined): "amber" | "red" {
  const chat = Array.isArray(apps) ? apps.find((app) => app.name.toLocaleLowerCase() === "chat") : undefined;
  return (chat ? appStatusToSidebar(chat.state) : null) ?? "amber";
}

/** CHAT-CALM-ERRORS-01d (design sections 2 and 7): the kit Thread's
 * ComposerNotice slot, the one place chat says it cannot answer right now.
 * The kit draws the muted frame; this fills it with the band's line from the
 * health row and, for an owner or admin, the Repairs link. Nothing while chat
 * is ready. */
export function ChatComposerNotice() {
  const notice = useContext(ChatComposerNoticeContext);
  const apps = useStatusApps().data;
  if (!notice) return null;
  const level = chatNoticeLevel(apps);
  return (
    // CHAT-NOTICE-LED-01 (owner, 2026-10-06): ChatGPT's quiet status line, a small
    // LED dot then one sentence in the normal foreground. The dot is the
    // kit's StatusIndicator (degraded or offline, no ping), the same dot as the
    // header status pill, on the kit's attention and destructive tokens,
    // chosen by the status-board state the rail's Chat icon reads; every notice, for
    // every age band, goes through this one presentation.
    <span data-chat-notice data-level={level} role="status" aria-live="polite" title={notice.text}>
      <StatusIndicator data-slot="chat-notice-dot" status={level === "red" ? "offline" : "degraded"} ping={false} inline />
      {" "}
      <span data-chat-notice-text>{notice.text}</span>
      {notice.repairsLink ? (
        <>
          {" "}
          <KitButton variant="quiet-link" size="xs" asChild>
            <Link to="/repairs">{notice.repairsLink}</Link>
          </KitButton>
        </>
      ) : null}
      {notice.actionLabel && notice.onAction ? <><span> </span><KitButton variant="quiet-link" size="xs" onClick={notice.onAction}>{notice.actionLabel}</KitButton></> : null}
    </span>
  );
}

/** The kit MessageQueue Element at Thread's ComposerQueue footer slot.
 * Removing a queued message places its text back into the kit composer,
 * where the person can edit and resend it. Queue state lives in the
 * assistant-ui runtime and is never written by this slot. */
function ChatQueueRow() {
  const aui = useAui();
  const queue = useAuiState((s) => s.composer.queue);
  if (queue.length === 0) return null;
  return (
    <MessageQueue
      running=""
      queued={queue.map((item) => ({ id: item.id, text: item.prompt }))}
      onCancel={(id) => {
        const item = queue.find((candidate) => candidate.id === id);
        if (!item) return;
        aui.composer.queueItem({ id }).remove();
        aui.composer.setText(item.prompt);
      }}
    />
  );
}

/** The ComposerQueue footer slot holds activity Elements and queued messages. */
export function ChatMessageQueue() {
  const { pick, backgroundRuns, busy, act, dismiss } = useChatActivity();
  const row = pick?.row;
  const actions = row ? [
    ...row.actions.map((key) => (
      <KitButton
        key={key}
        type="button"
        variant={key === "approve" ? "default" : "outline"}
        disabled={busy && key !== "open"}
        aria-label={`${key === "stop" ? "Stop" : key === "approve" ? "Approve" : key === "deny" ? "Deny" : "Open"} ${row.title}`}
        onClick={() => act(key)}
      >
        {key === "stop" ? "Stop" : key === "approve" ? "Approve" : key === "deny" ? "Deny" : "Open"}
      </KitButton>
    )),
    ...(pick.kind === "done" || pick.kind === "failed"
      ? [<KitButton key="dismiss" type="button" variant="ghost" onClick={dismiss}>Dismiss</KitButton>]
      : []),
  ] : [];
  const result = pick && row
    ? [row.detail, pick.more > 0 ? `and ${pick.more} more` : undefined].filter(Boolean).join(" · ")
    : undefined;
  const state = pick?.kind === "waiting"
    ? "waiting"
    : pick?.kind === "running"
      ? "working"
      : pick?.kind === "failed"
        ? "failed"
        : pick?.kind === "done" && row?.status === "Stopped"
          ? "cancelled"
          : pick?.kind === "done"
            ? "done"
            : undefined;
  return (
    <>
      {pick && row && state ? (
        <TaskCard
          role="status"
          aria-live="polite"
          label={row.title}
          state={state}
          meta={row.status || undefined}
          calm
          size="comfortable"
          actions={actions.length > 0 ? actions : undefined}
          result={result || undefined}
        />
      ) : null}
      {backgroundRuns.length > 0 ? <BackgroundInbox runs={backgroundRuns} calm size="comfortable" /> : null}
      {/* A model download is shown once, by the shell install strip at the bottom of the page, never here. */}
      <ChatQueueRow />
    </>
  );
}

const ALWAYS_THINKS_REASON = "This model thinks before every reply, so there is no Instant switch.";

export const MODEL_EFFORTS = [{ id: "instant", name: "Instant" }, { id: "thinking", name: "Thinking" }] as const;

/** ELT-MODE-01: the trailing composer slot contains the mode control only;
 * model names and model choice stay out of the chat surface. */
export function ComposerTrailingWithThinkingMode() {
  const { mode, setMode } = useContext(ThinkingModeContext);
  const capability = useContext(ThinkingModeCapabilityContext);
  return (
    <>
      {capability === "always" ? (
        // INSTANT-01: a model that reasons on every turn has no Instant, so
        // nothing here is a control or claims a choice. The chip is the short
        // word "Thinking" (it must fit unclipped); the reason is a tooltip and
        // the accessible description. A model that never reasons (capability
        // "none") shows nothing at all.
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" aria-description={ALWAYS_THINKS_REASON}>Thinking</Badge>
            </TooltipTrigger>
            <TooltipContent side="top">{ALWAYS_THINKS_REASON}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : null}
      {capability === "switchable" ? (
        <ModelSelectorRoot
          models={[{ id: "mode", name: "", efforts: MODEL_EFFORTS }]}
          value="mode"
          onValueChange={() => {}}
          effort={mode}
          onEffortChange={(effort) => setMode(effort === "thinking" ? "thinking" : "instant")}
        >
          <ModelSelectorTrigger variant="ghost" size="sm" aria-label="Thinking mode" />
          <ModelSelectorContent side="top" align="start">
            <ModelSelectorEffort label="Mode" />
          </ModelSelectorContent>
        </ModelSelectorRoot>
      ) : null}
      <ComposerExtraControls />
    </>
  );
}
/** slice 5(e): the "..." menu's second entry (Details, the stats reveal -
 * slice 5(d), landed 2026-09-22) - COORDINATOR named both for this same
 * menu so it's touched once. Admin-only on both sides: hidden here for
 * anyone else, and POST /api/turn/bare itself 403s regardless, so this
 * is convenience, not the real gate. */
export function CompareWithBareModelMenuItem() {
  const isAdmin = useContext(AdminContext);
  const engineDown = useEngineDownReason();
  const openCompare = useContext(CompareOpenContext);
  const turnId = useAuiState((s) => s.message.metadata?.custom?.turnId as string | undefined);
  const conversationId = useAuiState((s) => s.message.metadata?.custom?.conversationId as string | undefined);
  const text = useAuiState((s) => messageText(s.message));
  if (!isAdmin) return null;
  return (
    <ActionBarMorePrimitive.Item
      // eslint-disable-next-line shadcn/no-unknown-classes -- aui-action-bar-more-item is a kit ActionBarMorePrimitive class, not a Tailwind utility
      className="aui-action-bar-more-item hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none disabled:pointer-events-none disabled:opacity-50"
      disabled={!turnId || !conversationId || engineDown !== undefined}
      onSelect={(e) => {
        e.preventDefault();
        if (!turnId || !conversationId) return;
        openCompare({ turnId, conversationId, ourText: text });
      }}
    >
      <CompareIcon className="size-4" />
      {!turnId || !conversationId ? "Compare (available once saved)" : engineDown !== undefined ? `Compare with the bare model. ${engineDown}` : "Compare with the bare model"}
    </ActionBarMorePrimitive.Item>
  );
}

/** Slice 5(d): the "..." menu's own Details entry - no admin gate on
 * this ONE (unlike Compare above): `TurnStats` (timing, token counts)
 * isn't sensitive the way "compare against the bare model" is, and
 * every household member already sees the reply itself. The reveal's
 * context display uses the window saved on this turn's own stats. */
export function MessageDetailsMenuItem() {
  const { toggle } = useContext(DetailsOpenContext);
  const turnId = useAuiState((s) => s.message.metadata?.custom?.turnId as string | undefined);
  const stats = useAuiState((s) => s.message.metadata?.custom?.stats as TurnStats | undefined);
  if (!stats) return null;
  return (
    <ActionBarMorePrimitive.Item
      // eslint-disable-next-line shadcn/no-unknown-classes -- aui-action-bar-more-item is a kit ActionBarMorePrimitive class, not a Tailwind utility
      className="aui-action-bar-more-item hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none disabled:pointer-events-none disabled:opacity-50"
      disabled={!turnId}
      onSelect={(e) => {
        e.preventDefault();
        if (!turnId) return;
        toggle(turnId);
      }}
    >
      <DetailsIcon className="size-4" />
      Details
    </ActionBarMorePrimitive.Item>
  );
}

/** ADMIN-COMPARE-01 (b): the conversation-wide sibling to
 * CompareWithBareModelMenuItem above, same menu, same concept family
 * (COORDINATOR, 2026-09-22). Admin-only for the identical reason - the
 * backend 403s a non-admin's `bare: true` request regardless, this is
 * convenience. Unlike Compare above, this one doesn't need a
 * per-message turnId: it toggles a conversation-wide switch, so it
 * renders (and reads the same on-state) on every assistant message's
 * own menu. */
export function BareModeSwitchMenuItem() {
  const isAdmin = useContext(AdminContext);
  const { on, toggle } = useContext(BareModeContext);
  if (!isAdmin) return null;
  return (
    <ActionBarMorePrimitive.Item
      // eslint-disable-next-line shadcn/no-unknown-classes -- aui-action-bar-more-item is a kit ActionBarMorePrimitive class, not a Tailwind utility
      className="aui-action-bar-more-item hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none"
      onSelect={(e) => {
        e.preventDefault();
        toggle();
      }}
    >
      <CompareIcon className="size-4" />
      {on ? "Turn off bare mode for this conversation" : "Turn on bare mode for this conversation"}
    </ActionBarMorePrimitive.Item>
  );
}

const RememberIcon = getIcon("brain");
const TraceIcon = getIcon("activity");

/** DOCS-GAP-07: "Turn trace" in a reply's More menu opens `/trace/:turnId`,
 * the step-by-step timing page. Owners and admins only (AdminContext), and
 * never in Incognito, which keeps no trace. The page is a plain link, so it
 * also opens in a new tab. */
export function TurnTraceMenuItem() {
  const isAdmin = useContext(AdminContext);
  const temporary = useContext(TemporaryChatContext).on;
  const turnId = useAuiState((s) => s.message.metadata?.custom?.turnId as string | undefined);
  if (!isAdmin || temporary || !turnId) return null;
  return (
    <ActionBarMorePrimitive.Item
      asChild
      // eslint-disable-next-line shadcn/no-unknown-classes -- aui-action-bar-more-item is a kit ActionBarMorePrimitive class, not a Tailwind utility
      className="aui-action-bar-more-item hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none"
    >
      <Link to={`/trace/${encodeURIComponent(turnId)}`}>
        <TraceIcon className="size-4" />
        Turn trace
      </Link>
    </ActionBarMorePrimitive.Item>
  );
}

/** ELEMENTS-ADOPT-02: "Remember this" in a reply's More menu saves the
 * reply as one of the person's own memories, filed under this turn so the
 * reply's memory chips show it. Adults and teens only; never in
 * Incognito (it never remembers), never before the reply is saved. */
export function RememberThisMenuItem() {
  const band = useContext(ChatAgeBandContext);
  const temporary = useContext(TemporaryChatContext).on;
  const actorId = useContext(ChatActorContext);
  const turnId = useAuiState((s) => s.message.metadata?.custom?.turnId as string | undefined);
  const conversationId = useAuiState((s) => s.message.metadata?.custom?.conversationId as string | undefined);
  const text = useAuiState((s) => messageText(s.message));
  // "Remembered" only after this item saved the reply: a fact the judge took
  // from the same reply does not stop the person saving the reply itself.
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saved = state === "saved";
  if (!memoryChipsAllowed(band, temporary) || !actorId || !turnId || !conversationId || !text.trim()) return null;
  return (
    <ActionBarMorePrimitive.Item
      // eslint-disable-next-line shadcn/no-unknown-classes -- aui-action-bar-more-item is a kit ActionBarMorePrimitive class, not a Tailwind utility
      className="aui-action-bar-more-item hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none disabled:pointer-events-none disabled:opacity-50"
      disabled={saved || state === "saving"}
      onSelect={(e) => {
        e.preventDefault();
        if (saved) return;
        setState("saving");
        rememberMessage({ text, turnId, conversationId, actorId })
          .then(() => setState("saved"))
          .catch(() => setState("error"));
      }}
    >
      <RememberIcon className="size-4" />
      {saved ? "Remembered" : state === "error" ? "Couldn't remember - try again" : "Remember this"}
    </ActionBarMorePrimitive.Item>
  );
}

/** IMGGEN-UI-01: "Make a variation" in the More menu of a reply that started a picture: another picture from the same
 * words with a new seed, added to the same card. Shown only once nothing is being made on that card. */
const VariationIcon = getIcon("refresh-cw");
export function MakeVariationMenuItem() {
  const queryClient = useQueryClient();
  const pictureId = useAuiState((s) => {
    const part = s.message.content.find((p) => p.type === "tool-call" && p.toolName === "picture");
    return part && part.type === "tool-call" ? (part.result as { id?: string } | undefined)?.id : undefined;
  });
  const card = useQuery({ queryKey: ["picture", pictureId], queryFn: () => picturesApi.card(pictureId!), enabled: pictureId !== undefined, staleTime: 5_000 });
  const [busy, setBusy] = useState(false);
  // ENGINE-STATUS-MEDIA-01: greyed out with the reason while the picture engine cannot take work.
  const making = useMakingAvailability("image");
  if (!pictureId || !card.data?.can_vary) return null;
  return (
    <ActionBarMorePrimitive.Item
      // eslint-disable-next-line shadcn/no-unknown-classes -- aui-action-bar-more-item is a kit ActionBarMorePrimitive class, not a Tailwind utility
      className="aui-action-bar-more-item hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none disabled:pointer-events-none disabled:opacity-50"
      disabled={busy || making.disabled}
      title={making.reason ?? undefined}
      onSelect={(e) => {
        e.preventDefault();
        setBusy(true);
        void picturesApi.again(pictureId).then(() => queryClient.invalidateQueries({ queryKey: ["picture", pictureId] })).catch(() => undefined).finally(() => setBusy(false));
      }}
    >
      <VariationIcon className="size-4" />
      Make a variation
    </ActionBarMorePrimitive.Item>
  );
}

/** VIDEO-GEN-06: "Animate this picture" in the More menu of a reply that made a picture: a 5 second clip that starts
 * from the newest finished picture of that card. Shown only to a person who may make videos here, once the picture is
 * done. The Stack accepts only a picture it made itself, so this is never offered on a picture the person uploaded. */
const AnimateIcon = getIcon("sparkles");
export function AnimatePictureMenuItem() {
  const reload = useContext(ReloadMainThreadContext);
  const queryClient = useQueryClient();
  const pictureId = useAuiState((s) => {
    const part = s.message.content.find((p) => p.type === "tool-call" && p.toolName === "picture");
    return part && part.type === "tool-call" ? (part.result as { id?: string } | undefined)?.id : undefined;
  });
  const turnId = useAuiState((s) => (s.message.metadata?.custom as { turnId?: string } | undefined)?.turnId);
  const hasVideo = useAuiState((s) => s.message.content.some((p) => p.type === "tool-call" && p.toolName === "video"));
  const card = useQuery({ queryKey: ["picture", pictureId], queryFn: () => picturesApi.card(pictureId!), enabled: pictureId !== undefined, staleTime: 5_000 });
  const status = useQuery({ queryKey: ["video-status"], queryFn: () => videosApi.status(), enabled: pictureId !== undefined, staleTime: 30_000 });
  const [busy, setBusy] = useState(false);
  const making = useMakingAvailability("video");
  const latest = card.data?.files[card.data.files.length - 1];
  if (!pictureId || !turnId || hasVideo || !latest || !card.data?.conversation_id || !status.data?.can_make) return null;
  const conversationId = card.data.conversation_id;
  return (
    <ActionBarMorePrimitive.Item
      // eslint-disable-next-line shadcn/no-unknown-classes -- aui-action-bar-more-item is a kit ActionBarMorePrimitive class, not a Tailwind utility
      className="aui-action-bar-more-item hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none disabled:pointer-events-none disabled:opacity-50"
      disabled={busy || making.disabled}
      title={making.reason ?? undefined}
      onSelect={(e) => {
        e.preventDefault();
        setBusy(true);
        void videosApi.animate({ conversation_id: conversationId, turn_id: turnId, file_id: latest.id })
          .then(() => { void queryClient.invalidateQueries({ queryKey: ["video-status"] }); reload(); })
          .catch(() => undefined)
          .finally(() => setBusy(false));
      }}
    >
      <AnimateIcon className="size-4" />
      Animate this picture
    </ActionBarMorePrimitive.Item>
  );
}

export function AssistantMoreItems() {
  const temporary = useContext(TemporaryChatContext).on;
  return (
    <>
      <RememberThisMenuItem />
      <MakeVariationMenuItem />
      <AnimatePictureMenuItem />
      <RetryWithCurrentCompanionMenuItem />
      {temporary ? null : <BranchInNewChatMenuItem />}
      <CompareWithBareModelMenuItem />
      <BareModeSwitchMenuItem />
      <MessageDetailsMenuItem />
      <TurnTraceMenuItem />
    </>
  );
}

const RetryCurrentIcon = getIcon("rotate-ccw");

export function RetryWithCurrentCompanionMenuItem() {
  const temporary = useContext(TemporaryChatContext).on;
  const original = useAuiState((s) => s.message.metadata?.custom?.answered_by as { companion_id?: string } | null | undefined);
  const conversationId = useAuiState((s) => s.message.metadata?.custom?.conversationId as string | undefined);
  const conversation = useQuery({ queryKey: ["conversation", conversationId], queryFn: () => api.conversation(conversationId!), enabled: Boolean(conversationId) });
  const currentId = conversation.data?.companion_id ?? null;
  const retryChoice = useContext(RetryWithCurrentCompanionSetterContext);
  const aui = useAui();
  if (!original?.companion_id || !currentId || original.companion_id === currentId || temporary) return null;
  return <ActionBarMorePrimitive.Item
    // eslint-disable-next-line shadcn/no-unknown-classes -- aui-action-bar-more-item is a kit ActionBarMorePrimitive class, not a Tailwind utility
    className="aui-action-bar-more-item hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none"
      onSelect={(event) => { event.preventDefault(); retryChoice.arm(); void Promise.resolve(aui.message().reload()).catch(() => { retryChoice.consume(); }); }}
  ><RetryCurrentIcon className="size-4" />Retry with current companion</ActionBarMorePrimitive.Item>;
}


// Slice 5(c), "thinking before the reply" (2026-09-22): `/chat`'s own
// hand-rolled thread.aui.tsx already has this exact behavior (its own
// "indicator" case, `useTurnActivity()` plus a 45s "still working"
// timer) - `status` IS a real wire event (CHAT-16, `backend/src/wire.ts`,
// BACKLOG.md's own "Engine emits `status` events at lookup start" item,
// done 2026-09-15), unlike TOOL-EVENTS-01's tool events. `/chat`
// just never got this port. The kit's own `ThinkingIndicator` Element
// (thinking-indicator.tsx) replaces its bare pulsing dot via the new
// `Indicator` slot (ui-v0.5.29) - ported, not reinvented: same signal,
// same 45s threshold, and the Element's elapsed slot reads only the live
// message's own creation time. Minors do not receive the indicator or its
// elapsed value.
export function ChatThinkingIndicator() {
  const band = useContext(ChatAgeBandContext);
  const running = useAuiState((s) => s.message.status?.type === "running");
  const createdAt = useAuiState((s) => s.message.createdAt);
  const activity = useTurnActivity();
  const [slow, setSlow] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setSlow(false);
    if (!running) return;
    const timer = setTimeout(() => setSlow(true), 45_000);
    return () => clearTimeout(timer);
  }, [running]);
  useEffect(() => {
    if (!running || band !== "adult" || !createdAt) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [band, createdAt, running]);
  if (!running || band !== "adult") return null;
  const elapsedSeconds = createdAt ? Math.max(0, Math.floor((now - createdAt.getTime()) / 1_000)) : undefined;
  return (
    <ThinkingIndicator
      role="status"
      aria-live="polite"
      label={slow ? "Still working. This is taking longer than usual." : (activity ?? "Thinking…")}
      elapsed={elapsedSeconds === undefined ? undefined : `${elapsedSeconds}s`}
    />
  );
}

// Startup belongs in the empty thread's Welcome slot. The timer exists only
// while the engine is starting, so ready/unavailable states and unmounts
// clear it immediately.
export function EngineStartingLoader({ Loader = GenerationLoader }: {
  Loader?: typeof GenerationLoader;
} = {}) {
  const availability = useContext(ChatAvailabilityContext);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (availability !== "starting") {
      setTick(0);
      return;
    }
    const timer = setInterval(() => setTick((value) => value + 1), 1_000);
    return () => clearInterval(timer);
  }, [availability]);
  if (availability !== "starting") return null;
  return <Loader label="Starting your AI…" tick={tick} role="status" aria-live="polite" className="py-8" />;
}

// Incognito is controlled from the global shell header; this welcome
// slot only reflects the shared state and does not add a second toggle.
export function ChatWelcome() {
  const { on } = useContext(TemporaryChatContext);
  const person = useContext(WakeWordPersonContext);
  // One pick per new chat: the line holds still while the screen is up and is a different one next time.
  const [pick] = useState(() => Math.random());
  const conversationId = useContext(DraftConversationContext);
  const conversationQuery = useQuery({ queryKey: ["conversation", conversationId], queryFn: () => api.conversation(conversationId!), enabled: Boolean(conversationId) });
  const settingsQuery = useQuery({ queryKey: ["settingsValues", `person:${person?.id ?? ""}`], queryFn: () => api.settingsValues(`person:${person!.id}`), enabled: Boolean(person?.id) });
  const companionsQuery = useQuery({ queryKey: ["companions"], queryFn: api.companions });
  const settings = Array.isArray(settingsQuery.data) ? settingsQuery.data : [];
  const selectedId = settings.find((setting) => setting.key === "persona.active_id")?.value;
  const fallbackId = typeof selectedId === "string" && companionsQuery.data?.companions?.some(({ id }) => id === selectedId) ? selectedId : companionsQuery.data?.default_id;
  // "Test Conversation" opens /chat?try=<id>: the picture and name on this screen are that draft, not the person's usual companion.
  const [searchParams] = useSearchParams();
  const tryId = searchParams.get("try")?.trim() || null;
  const tryRecord = useQuery({ queryKey: ["companions", tryId, "edit"], queryFn: () => api.editCompanion(tryId!), enabled: Boolean(tryId), retry: false });
  const companionId = tryId ?? conversationQuery.data?.companion_id ?? fallbackId ?? null;
  const presence = useCompanionPresence(companionId);
  const companion = companionsQuery.data?.companions?.find(({ id }) => id === companionId);
  const name = presence?.name ?? companion?.name ?? (tryId ? tryRecord.data?.name : undefined);
  return (
    <>
      <EngineStartingLoader />
      <EmptyState>
        {name ? (
          <div className="flex size-40 items-center justify-center overflow-hidden rounded-full">
            {presence ? <CompanionAvatar name={presence.name} clips={presence.clips} wanted={presence.wanted} once={presence.once} size="lg" onFail={presence.onFail} /> : <Avatar name={name} seed={companionId} size="profile" className="size-full text-4xl" />}
          </div>
        ) : null}
        <EmptyStateGreeting>{on ? "Temporary chat" : starterGreeting(person?.display_name ?? "", new Date().getHours(), pick)}</EmptyStateGreeting>
        {on ? <p className="text-muted-foreground text-center text-sm">This chat won&apos;t be saved to your history.</p> : null}
      </EmptyState>
      {/* Room between the greeting and the composer now that the chips no longer sit there. */}
      <div aria-hidden className="h-8" />
    </>
  );
}

/** The kit's below-composer slot takes a component, so this connects the kit's chips to the composer: data (the generic list, the same for
 * everyone, never drawn from memory, history or a profile: see chatStarterSuggestions), the engine-down state and the send handler. It
 * adds no box or style of its own. */
export function ChatStarterPills() {
  const aui = useAui();
  const engineDown = useEngineDownReason();
  return (
    <>
    <EmptyStateSuggestions>
      {STARTER_SUGGESTIONS.map((suggestion, index) => (
        <EmptyStateSuggestion
          key={suggestion.title}
          index={index}
          disabled={engineDown !== undefined}
          aria-label={engineDown === undefined ? undefined : `${suggestion.title} ${suggestion.label}. ${engineDown}`}
          onClick={() => {
            if (engineDown !== undefined) return;
            aui.composer().setText(suggestion.prompt);
            aui.composer().send();
          }}
        >
          {suggestion.title} {suggestion.label}
        </EmptyStateSuggestion>
      ))}
    </EmptyStateSuggestions>
    </>
  );
}

// Live finding, 2026-09-22 (Jesse): the shipped `Thread`'s own default
// reasoning-group rendering (no `variant` passed to `ReasoningRoot`)
// renders the "outline" variant - a bordered, padded card whose left
// edge and width don't match the reply text beside it. The shipped
// Element's own `ghost` variant is the flush, borderless look (its own
// `mb-4 w-full` base only) - the same look `Thread`'s default already
// gives `ToolGroupRoot` two cases over in its own switch. Composed
// through the documented `components.ReasoningGroup` slot (never a
// fork of the vendored file): the shipped Root/Trigger/Content/Text
// primitives, unstyled beyond the variant choice.
//
// 2026-10-31 (Jesse): while the model reasons the group starts closed, and
// a click opens it live without changing the saved preference. After the
// answer, that message stays open if it was opened while running; otherwise
// it follows the saved preference. A finished-state click updates the saved
// preference as usual. While reasoning, the Element keeps its own shimmer on its
// label (one calm status line, no stream); when it ends the label gains the
// measured seconds through the trigger's own `duration` prop. Open/closed is
// the Element's controlled `open` prop, remembered per person in
// `ui.reasoning_open` (default collapsed). While it runs the label is one
// rotating plain word (`useThinkingWord`, list in `thinkingWords.ts`) with a
// cross-fade; a screen reader hears "Thinking" once and "Done thinking" at the
// end, never each word. Finished, the kit's `thoughtForLabel` gives
// "Thought for Ns". Words reveal nothing, so every age band gets them.
export function ReasoningGroup({ children, group }: PropsWithChildren<{ group: ThreadGroupPart }>) {
  const running = group.status.type === "running";
  const person = useContext(WakeWordPersonContext);
  const [preferOpen, setPreferOpen] = useReasoningOpen(person);
  const [openedWhileRunning, setOpenedWhileRunning] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [seconds, setSeconds] = useState<number | undefined>(undefined);
  const word = useThinkingWord(running);
  useEffect(() => {
    if (running) {
      setStartedAt((t) => t ?? Date.now());
    } else if (startedAt !== null) {
      setSeconds(Math.max(1, Math.round((Date.now() - startedAt) / 1000)));
      setStartedAt(null);
    }
  }, [running, startedAt]);
  return (
    <ReasoningRoot
      streaming={running}
      open={running ? openedWhileRunning : (openedWhileRunning || preferOpen)}
      onOpenChange={(next) => {
        if (running || openedWhileRunning) setOpenedWhileRunning(next);
        else setPreferOpen(next);
      }}
      variant="ghost"
    >
      <ReasoningTrigger
        active={running}
        label={running ? word : undefined}
        duration={running ? undefined : seconds}
        doneLabel={thoughtForLabel}
        announce={running ? STATIC_THINKING_WORD : seconds !== undefined ? DONE_THINKING_ANNOUNCEMENT : undefined}
      />
      <ReasoningContent aria-busy={running}>
        {/* Live finding, 2026-09-22 (Jesse, in Firefox): the shipped
            ReasoningText carries `ps-6` (room under the trigger's own
            icon+label) but no `pe-*` at all - wrapped text can reach
            the exact right edge of the scrollable content, worse once
            `overflow-y-auto`'s own scrollbar claims some of that width.
            A small `pe-2` through the Element's own exposed className,
            never a fork of the file - just enough buffer that the last
            character on a wrapped line never touches the edge. */}
        <ReasoningText className="pe-2">{children}</ReasoningText>
      </ReasoningContent>
    </ReasoningRoot>
  );
}

// Read the current message's native source parts; no synthetic tool call
// or cached transform is needed.
export function toolCallPartFromMessage(message: ThreadMessage | undefined, toolName: string): Extract<ThreadAssistantMessagePart, { type: "tool-call" }> | undefined {
  return message?.content.find(
    (p): p is Extract<ThreadAssistantMessagePart, { type: "tool-call" }> => p.type === "tool-call" && p.toolName === toolName,
  );
}

// The hub's own favicon route for the tool timeline (never the upstream
// Element's default third-party favicon service).
export function faviconUrl(domain: string): string {
  return `/api/favicon?domain=${encodeURIComponent(domain)}`;
}

/** Failed-turn diagnostics are appended by the shipped action-bar slot, so
 * they stay in the same row as Copy, feedback and Refresh. CHAT-CALM-ERRORS-01c:
 * the one details control per failed reply, drawn only for an admin and only
 * when there is something to show: the detail the turn's error event carried,
 * a stored reply marked failed (a failed generation or tool call), or, for a
 * reply that errored with neither, a stored row the hub reports with facts
 * (read ahead, so an empty control is never drawn). */
export function FailedTurnErrorDetailsAction() {
  const isAdmin = useContext(AdminContext);
  // An errored live reply carries its id on the thrown ChatTurnError, not in metadata.
  const turnId = useAuiState((s) => {
    const fromMetadata = s.message.metadata?.custom?.turnId as string | undefined;
    if (fromMetadata) return fromMetadata;
    const status = s.message.status;
    const error = status?.type === "incomplete" && status.reason === "error" ? status.error : undefined;
    return error && typeof error === "object" && "turnId" in error && typeof error.turnId === "string" ? error.turnId : undefined;
  });
  const streamed = useAuiState((s) => s.message.metadata?.custom?.failureDetail as TurnErrorDetail | undefined);
  const failed = useAuiState((s) => s.message.metadata?.custom?.failedGeneration === true || s.message.metadata?.custom?.failedTool === true);
  const errored = useAuiState((s) => s.message.status?.type === "incomplete" && s.message.status.reason === "error");
  const live = streamed && hasErrorFacts(streamed) ? streamed : undefined;
  const lookAhead = isAdmin && !live && !failed && errored && Boolean(turnId);
  const stored = useQuery<TurnErrorDetail>({ queryKey: ["turn-error-detail", turnId], queryFn: () => api.turnErrorDetail(turnId!), enabled: lookAhead, retry: false });
  if (!isAdmin) return null;
  if (live) return <TurnErrorDetails turnId={turnId} streamed={live} />;
  if (failed && turnId) return <TurnErrorDetails turnId={turnId} />;
  if (lookAhead && stored.data && hasErrorFacts(stored.data)) return <TurnErrorDetails turnId={turnId} streamed={stored.data} />;
  return null;
}

/** Compose both controls in the kit's single action-bar append point. */
export function FailedTurnActionBarExtras() {
  return <FailedTurnErrorDetailsAction />;
}

export function buildTimingStats(stats: TurnStats): TimingStat[] {
  const list: TimingStat[] = [];
  if (stats.time_to_first_token_ms !== null) list.push({ label: "First token", value: `${(stats.time_to_first_token_ms / 1000).toFixed(1)}s` });
  if (stats.total_time_ms !== null) list.push({ label: "Total", value: `${(stats.total_time_ms / 1000).toFixed(1)}s` });
  if (stats.tokens_per_second !== null) list.push({ label: "Speed", value: `${stats.tokens_per_second.toFixed(0)} tok/s` });
  if (stats.engine) list.push({ label: "Engine", value: stats.engine });
  return list;
}

export function buildContextSegmentStats(stats: TurnStats): TimingStat[] {
  const labels: Record<ContextSegmentKey, string> = { prefix: "Prefix", tools: "Tools", memory: "Memory", history: "History", message: "This message", reply: "Reply" };
  return Object.entries(stats.context_segments ?? {}).flatMap(([key, tokens]) => {
    if (!(CONTEXT_SEGMENT_KEYS as readonly string[]).includes(key) || typeof tokens !== "number" || !Number.isFinite(tokens) || tokens < 0) return [];
    return [{ label: labels[key as keyof typeof labels], value: `${tokens.toLocaleString()} tokens` }];
  });
}

/** THIN-3E: use the per-turn context captured by THIN-3A and the
 * engine's own prompt token count. The safe window fallback is never
 * presented as a measured engine size. */
export function MessageDetailsContextBar({ stats }: { stats: TurnStats }) {
  if (!stats.context_window_tokens || stats.context_tokens === null) return null;
  const outputTokens = stats.predicted_tokens ?? 0;
  return <ContextDisplay.Bar modelContextWindow={stats.context_window_tokens} usage={{ totalTokens: stats.context_tokens + outputTokens, inputTokens: stats.context_tokens, outputTokens }} />;
}

export function MessageDetailsReveal() {
  const turnId = useAuiState((s) => s.message.metadata?.custom?.turnId as string | undefined);
  const stats = useAuiState((s) => s.message.metadata?.custom?.stats as TurnStats | undefined);
  const streaming = useAuiState((s) => s.message.status?.type === "running");
  const { isOpen } = useContext(DetailsOpenContext);
  if (!turnId || !stats || !isOpen(turnId)) return null;
  const timingStats = buildTimingStats(stats);
  timingStats.push(...buildContextSegmentStats(stats));
  if (timingStats.length === 0) return null;
  return (
    <div className="ms-2 flex flex-col gap-1.5 pb-2">
      <MessageTiming stats={timingStats} streaming={streaming} />
      <MessageDetailsContextBar stats={stats} />
    </div>
  );
}

/** ADMIN-COMPARE-01 (b): "the conversation history's own 'bare model'
 * badge on the message" - reads straight off the turn's own metadata
 * (chatModelAdapter.ts's live done-event mapping and
 * chatHistoryAdapter.ts's reload-path row both carry `bare`, the same
 * `conversation_turns.bare` column either way), so the badge shows
 * whether a live turn or one scrolled back to. No admin gate needed: a
 * bare turn can only ever exist inside a conversation the admin who
 * triggered it owns (resolveOrCreateConversation()'s own per-actor
 * check), so no other household member's history can ever carry one. */
export function BareModelBadge() {
  const bare = useAuiState((s) => s.message.metadata?.custom?.bare === true);
  if (!bare) return null;
  return (
    <Badge variant="destructive" className="mb-1">
      Bare model
    </Badge>
  );
}

// One `AssistantMessageFooterExtra` slot, five independent reveals
// (the bare-model badge, sources, Details, memory chips, the "What went
// wrong?" form) - each keyed by its own
// state and rendering (or not) on its own, so this wrapper is pure
// composition, no shared logic between them.
export function MessageFooterExtra() {
  const message = useAuiState((s) => s.message);
  const turnId = message.metadata?.custom?.turnId as string | undefined;
  const sources = sourcesFromMessage(message);
  const sourceOpen = useContext(SourcesOpenContext);
  const stoppedRun = useStoppedRun();
  // ELEMENTS-ADOPT-02: the kit feedback-dialog as it ships, fed by a hook.
  const feedbackForm = useReplyFeedbackForm();
  // ELEMENTS-ADOPT-02: the kit memory-chips as it ships, fed by a hook.
  const memoryChips = useReplyMemoryChips();
  // SAFETY-NOTICE-01: crisis resources a finished reply carried, beside it
  // ("offer, never block"), as the kit GuardrailNotice in its support tone.
  const crisisSupport = useAuiState((s) => s.message.metadata?.custom?.crisisSupport as CrisisSupport | undefined);
  return (
    <>
      <BareModelBadge />
      {turnId && sources.length ? (
        // SEARCH-ANSWER-04 (rule 9): the kit's own sources trigger as it ships
        // ("Sources", the count, a chevron), not a hand-made button that drew
        // a bare number.
        <SourcesCard sources={sources} open={sourceOpen.isOpen(turnId)} onOpenChange={(open) => {
          if (sourceOpen.isOpen(turnId) !== open) sourceOpen.toggle(turnId);
        }} layout="list" />
      ) : null}
      <MessageDetailsReveal />
      {memoryChips ? <MemoryChips {...memoryChips} /> : null}
      {stoppedRun ? <StoppedRun {...stoppedRun} /> : null}
      {crisisSupport ? <GuardrailNotice tone="support" title={crisisSupport.title} explanation={crisisSupport.text} actions={crisisSupport.actions} alternatives={[]} /> : null}
      {feedbackForm ? <FeedbackDialog {...feedbackForm} /> : null}
    </>
  );
}
