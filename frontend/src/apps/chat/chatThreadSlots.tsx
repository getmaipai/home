// The chat thread's slot components (more-menu items, composer extras,
// thinking indicator, welcome, reasoning group, sources and message footer),
// moved verbatim out of ChatPage.tsx (SHARED-THREAD-01). ChatThread.tsx
// hands them to the kit Thread.
import { useReplyFeedbackForm } from "@/apps/chat/chatFeedbackDialog";
import { FeedbackDialog } from "@maipai/ui/src/elements/feedback-dialog";
import { MemoryChips } from "@maipai/ui/src/elements/memory-chips";
import { memoryChipsAllowed, useReplyMemoryChips } from "@/apps/chat/chatMemoryChips";
import { ChatActorContext, rememberMessage } from "@/apps/chat/chatMemoryActions";
import { useContext, useEffect, useState, type PropsWithChildren } from "react";
import { GuardrailNotice } from "@maipai/ui/src/elements/guardrail-notice";
import type { CrisisSupport } from "@maipai/home-backend/src/wire";
import { ActionBarMorePrimitive, ComposerPrimitive, useAui, useAuiState, type ThreadAssistantMessagePart, type ThreadMessage } from "@assistant-ui/react";
import { type ThreadGroupPart } from "@maipai/ui/src/elements/thread.aui";
// APPROVE-CARD-01: the same vendored Element `thread.aui.tsx`'s own
// default `ToolFallback` renders (its own `import { ToolFallback } from
// "@maipai/ui/src/assistant-ui/tool-fallback.aui"`) - used here directly
// so a "confirm" card renders through `ToolFallback.Approval` exactly as
// it ships, never a hand-built card (the kit's own `approval-card.tsx`
// is built for a terminal command and can't be relabeled, per the org's
// "no hand-built UI" rule).
import { ReasoningRoot, ReasoningTrigger, ReasoningContent, ReasoningText } from "@maipai/ui/src/elements/reasoning.aui";
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
import { ComposerModelPicker } from "@maipai/ui/src/elements/composer-model-picker.aui";
import { ModelSelectorRoot, ModelSelectorTrigger, ModelSelectorValue, ModelSelectorContent, ModelSelectorEffort } from "@maipai/ui/src/elements/model-selector";
import { RegenerateMenu } from "@maipai/ui/src/elements/regenerate-menu";
// The Elements' own smaller `Button` (not the dashboard `Button` this
// file otherwise uses), because this one renders as a sibling of Copy/
// Reload/etc INSIDE the assistant-ui action bar itself (matching what
// TooltipIconButton, thread.aui.tsx's own action-bar button, wraps) -
// the dashboard Button belongs to the surrounding page chrome, not this
// row.
import { Button as ElementsButton } from "@maipai/ui/src/elements/ui/button";
import { Button as KitButton } from "@maipai/ui/src/ui/button";
import { Badge } from "@maipai/ui/src/dashboard/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@maipai/ui/src/ui/tooltip";
import { getIcon } from "@maipai/ui/src/icons";
import { api, type StatusAppsResponse, type TurnErrorDetail, type TurnStats } from "@/lib/api";
import { StatusIndicator } from "@maipai/ui/src/ui/status";
import { useStatusApps } from "@/shell/useStatusApps";
import { appStatusToSidebar } from "@/shell/statusApps";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { sourcesFromMessage } from "@/apps/chat/chatSources";
import { messageText } from "@/apps/chat/chatMessageText";
import { useStoppedRun } from "@/apps/chat/chatStoppedRun";
import { useTurnActivity } from "@/apps/chat/chatTurnActivity";
import { BranchInNewChatMenuItem } from "@/apps/chat/branchInNewChatMenuItem";
import { useChatActivity } from "@/apps/chat/chatActivity";
import { ComposerVoiceControls } from "@/apps/chat/composerVoiceControls";
import { ComposerWakeWordControl } from "@/apps/chat/ComposerWakeWordControl";
import { AdminContext, ChatAgeBandContext, ChatComposerNoticeContext, CompareOpenContext, SourcesOpenContext, DetailsOpenContext, ThinkingModeContext, ThinkingModeCapabilityContext, ModelPickerContext, ModelChoiceAllowedContext, BareModeContext, TemporaryChatContext, WakeWordPersonContext } from "@/apps/chat/chatThreadContexts";
import { ChatAvailabilityContext, useEngineDownReason } from "@/apps/chat/useChatAvailability";
import { TurnErrorDetails, hasErrorFacts } from "@/shell/pages/TurnErrorDetails";

// ADMIN-COMPARE-01: no icon in the kit's own registry reads as "compare"
// specifically - grid-2x2 (a two-pane split) is the closest already-
// registered fit, chosen over adding a new one to keep this item to the
// one kit tag it already needed for the action bars themselves.
export const CompareIcon = getIcon("grid-2x2");
export const DetailsIcon = getIcon("gauge");
const QueueSendIcon = getIcon("arrow-up");

export function ComposerExtraControls() {
  const person = useContext(WakeWordPersonContext);
  const engineDown = useEngineDownReason();
  const isRunning = useAuiState((s) => s.thread.isRunning && s.thread.voice === undefined && s.thread.capabilities.queue);
  const writtenTurnBusy = useAuiState((s) => s.thread.isRunning || s.composer.queue.length > 0);
  return (
    <>
      <ComposerVoiceControls disabled={writtenTurnBusy} engineDown={engineDown} />
      {person ? <ComposerWakeWordControl person={person} /> : null}
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
  const { pick, backgroundRuns, announcement, busy, act, dismiss } = useChatActivity();
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
      <span role="status" aria-live="polite" className="sr-only">{announcement}</span>
      {pick && row && state ? (
        <TaskCard
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
      <ChatQueueRow />
    </>
  );
}

export const MODEL_EFFORTS = [{ id: "instant", name: "Instant" }, { id: "thinking", name: "Thinking" }] as const;

/** COMPOSER-01: ChatGPT puts the model label just left of the mic, so the one
 * selector rides the trailing ComposerExtraEnd slot in front of the existing
 * trailing controls instead of the leading ComposerExtra slot beside Add. */
export function ComposerTrailingWithThinkingMode() {
  const { mode, setMode } = useContext(ThinkingModeContext);
  const capability = useContext(ThinkingModeCapabilityContext);
  const band = useContext(ChatAgeBandContext);
  const modelChoiceAllowed = useContext(ModelChoiceAllowedContext);
  const { models, value, setValue } = useContext(ModelPickerContext);
  const selected = models.find((model) => model.id === value) ?? models[0];
  const composerModels = models.map((model) => ({ name: model.name, meta: model.description ?? model.id }));
  return (
    <>
      {band === "adult" && modelChoiceAllowed && models.length >= 2 && selected ? (
        <ComposerModelPicker
          key={selected.id}
          models={composerModels}
          defaultModel={selected.name}
          onChange={(name) => {
            const choice = models.find((model) => model.name === name);
            if (choice) setValue(choice.id);
          }}
        />
      ) : null}
      {capability === "none" || capability === "always" ? (
        <ModelSelectorRoot
          models={[{ id: "mode", name: capability === "always" ? "Thinking" : "Instant" }]}
          value="mode"
        >
          <ModelSelectorValue showEffort={false} />
        </ModelSelectorRoot>
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

export function AssistantMoreItems() {
  const temporary = useContext(TemporaryChatContext).on;
  return (
    <>
      <RememberThisMenuItem />
      {temporary ? null : <BranchInNewChatMenuItem />}
      <CompareWithBareModelMenuItem />
      <BareModeSwitchMenuItem />
      <MessageDetailsMenuItem />
    </>
  );
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

// Incognito is controlled from the global /next header; this welcome
// slot only reflects the shared state and does not add a second toggle.
export function ChatWelcome() {
  const { on } = useContext(TemporaryChatContext);
  const aui = useAui();
  const engineDown = useEngineDownReason();
  return (
    <>
      <EngineStartingLoader />
      <EmptyState>
        <EmptyStateGreeting>{on ? "Temporary chat" : "How can I help you today?"}</EmptyStateGreeting>
        {on ? <p className="text-muted-foreground text-center text-sm">This chat won&apos;t be saved to your history.</p> : null}
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
      </EmptyState>
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
export function ReasoningGroup({ children, group }: PropsWithChildren<{ group: ThreadGroupPart }>) {
  const running = group.status.type === "running";
  return (
    <ReasoningRoot streaming={running} defaultOpen={false} variant="ghost">
      <ReasoningTrigger active={running} />
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
  const { models, value } = useContext(ModelPickerContext);
  const aui = useAui();
  const eligible = useContext(ModelChoiceAllowedContext);
  const engineDown = useEngineDownReason();
  const [open, setOpen] = useState(false);
  return (
    <>
      {eligible && models.length >= 2 && value ? (
        <RegenerateMenu
          options={models.map((model) => ({ id: model.id, label: model.name, detail: model.description ?? model.id }))}
          open={open}
          currentId={value}
          disabled={engineDown}
          onOpenChange={setOpen}
          onPick={(model) => {
            setOpen(false);
            aui.message().reload({ runConfig: { custom: { model } } });
          }}
        />
      ) : null}
      <FailedTurnErrorDetailsAction />
    </>
  );
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
  const labels = { prefix: "Prefix", tools: "Tools", memory: "Memory", history: "History", reply: "Reply" } as const;
  return Object.entries(stats.context_segments ?? {}).flatMap(([key, tokens]) => {
    if (!(key in labels) || typeof tokens !== "number" || !Number.isFinite(tokens) || tokens < 0) return [];
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
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <ElementsButton type="button" variant="ghost" size="icon" aria-label={`${sources.length} ${sources.length === 1 ? "Source" : "Sources"}`} aria-expanded={sourceOpen.isOpen(turnId)} onClick={() => sourceOpen.toggle(turnId)}>
                {sources.length}
              </ElementsButton>
            </TooltipTrigger>
            <TooltipContent>{sources.length} {sources.length === 1 ? "Source" : "Sources"}</TooltipContent>
          </Tooltip>
          <SourcesCard sources={sources} open={sourceOpen.isOpen(turnId)} onOpenChange={(open) => {
            if (sourceOpen.isOpen(turnId) !== open) sourceOpen.toggle(turnId);
          }} layout="list" hideTrigger />
        </>
      ) : null}
      <MessageDetailsReveal />
      {memoryChips ? <MemoryChips {...memoryChips} /> : null}
      {stoppedRun ? <StoppedRun {...stoppedRun} /> : null}
      {crisisSupport ? <GuardrailNotice tone="support" title={crisisSupport.title} explanation={crisisSupport.text} actions={crisisSupport.actions} alternatives={[]} /> : null}
      {feedbackForm ? <FeedbackDialog {...feedbackForm} /> : null}
    </>
  );
}
