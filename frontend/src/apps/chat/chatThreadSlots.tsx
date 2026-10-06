// The chat thread's slot components (more-menu items, composer extras,
// thinking indicator, welcome, reasoning group, sources and message footer),
// moved verbatim out of NextChatPage.tsx (SHARED-THREAD-01). ChatThread.tsx
// hands them to the kit Thread.
import { useContext, useEffect, useState, type PropsWithChildren } from "react";
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
import { Source, SourceIcon, SourceTitle } from "@maipai/ui/src/elements/sources.aui";
import { Collapsible, CollapsibleContent } from "@maipai/ui/src/ui/collapsible";
import { collapsePanel } from "@maipai/ui/src/elements/surfaces";
import { ThinkingIndicator } from "@maipai/ui/src/elements/thinking-indicator";
import { GenerationLoader } from "@maipai/ui/src/elements/loading-state";
import { MessageTiming, type TimingStat } from "@maipai/ui/src/elements/message-timing";
import { MessageQueue } from "@maipai/ui/src/elements/message-queue";
import { ContextDisplay } from "@maipai/ui/src/elements/context-display";
import { ModelSelectorRoot, ModelSelectorTrigger, ModelSelectorValue, ModelSelectorContent, ModelSelectorSearch, ModelSelectorList, ModelSelectorEffort } from "@maipai/ui/src/elements/model-selector";
import { RegenerateMenu } from "@maipai/ui/src/elements/regenerate-menu";
// The Elements' own smaller `Button` (not the dashboard `Button` this
// file otherwise uses), because this one renders as a sibling of Copy/
// Reload/etc INSIDE the assistant-ui action bar itself (matching what
// TooltipIconButton, thread.aui.tsx's own action-bar button, wraps) -
// the dashboard Button belongs to the surrounding page chrome, not this
// row.
import { Button as ElementsButton } from "@maipai/ui/src/elements/ui/button";
import { Badge } from "@maipai/ui/src/dashboard/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@maipai/ui/src/ui/tooltip";
import { getIcon } from "@maipai/ui/src/icons";
import { api, type TurnErrorDetail, type TurnStats } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { Source as SpecSource } from "@maipai/spec/gen/ts/source.js";
import { messageText } from "@/apps/chat/chatMessageText";
import { useTurnActivity } from "@/apps/chat/chatTurnActivity";
import { BranchInNewChatMenuItem } from "@/apps/chat/branchInNewChatMenuItem";
import { ChatActivityCard } from "@/apps/chat/ChatActivityCard";
import { ComposerVoiceControls } from "@/apps/chat/composerVoiceControls";
import { ComposerWakeWordControl } from "@/apps/chat/ComposerWakeWordControl";
import { AdminContext, ChatComposerNoticeContext, CompareOpenContext, SourcesOpenContext, DetailsOpenContext, ThinkingModeContext, ModelPickerContext, ModelChoiceAllowedContext, BareModeContext, TemporaryChatContext, WakeWordPersonContext } from "@/apps/chat/chatThreadContexts";
import { ChatAvailabilityContext } from "@/apps/chat/useChatAvailability";
import { TurnErrorDetails, hasErrorFacts } from "@/next/pages/TurnErrorDetails";

// ADMIN-COMPARE-01: no icon in the kit's own registry reads as "compare"
// specifically - grid-2x2 (a two-pane split) is the closest already-
// registered fit, chosen over adding a new one to keep this item to the
// one kit tag it already needed for the action bars themselves.
export const CompareIcon = getIcon("grid-2x2");
export const DetailsIcon = getIcon("gauge");
const QueueSendIcon = getIcon("arrow-up");

export function ComposerExtraControls() {
  const person = useContext(WakeWordPersonContext);
  const isRunning = useAuiState((s) => s.thread.isRunning && s.thread.voice === undefined && s.thread.capabilities.queue);
  const writtenTurnBusy = useAuiState((s) => s.thread.isRunning || s.composer.queue.length > 0);
  return (
    <>
      <ComposerVoiceControls disabled={writtenTurnBusy} />
      {person ? <ComposerWakeWordControl person={person} /> : null}
      {isRunning ? (
        <ComposerPrimitive.Send asChild>
          <ElementsButton type="button" size="icon" className="size-7 rounded-full" aria-label="Queue message" title="Queue message">
            <QueueSendIcon className="size-4" />
          </ElementsButton>
        </ComposerPrimitive.Send>
      ) : null}
    </>
  );
}

/** CHAT-CALM-ERRORS-01d (design sections 2 and 7): the kit Thread's
 * ComposerNotice slot, the one place chat says it cannot answer right now.
 * The kit draws the muted one-line frame; this fills it with the band's line
 * from the health row and, for an owner or admin, the Repairs link (the link
 * the old full-width banner carried, ported here). Nothing while chat is
 * ready. */
export function ChatComposerNotice() {
  const notice = useContext(ChatComposerNoticeContext);
  if (!notice) return null;
  return (
    // The kit frame is one truncated line; on a phone the Repairs link goes
    // first so it is never the part that is cut off.
    <span data-chat-notice role="status" aria-live="polite" title={notice.text} className="inline-flex max-w-full items-baseline gap-1">
      <span className="min-w-0 truncate">{notice.text}</span>
      {/* Deliberate touch-target-floor exception (docs/UI.md): a text link
          inside the notice's one sentence (WCAG 2.5.8's inline exception).
          The design caps this line at 24 px, so a 48 px link would undo it;
          Repairs is also one tap away in Settings. */}
      {notice.repairsLink ? <Link to="/repairs" data-touch-target-exempt className="order-first shrink-0 underline underline-offset-2 sm:order-none">{notice.repairsLink}</Link> : null}
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

/** The ComposerQueue footer slot holds both calm rows above the field: the
 * activity card (ChatActivityCard) and the queued messages. */
export function ChatMessageQueue() {
  return (
    <>
      <ChatActivityCard />
      <ChatQueueRow />
    </>
  );
}

export const MODEL_EFFORTS = [{ id: "instant", name: "Instant" }, { id: "thinking", name: "Thinking" }] as const;

export function ComposerModelSelector() {
  const { models, value, setValue } = useContext(ModelPickerContext);
  const { mode, setMode } = useContext(ThinkingModeContext);
  if (models.length < 2) return null;
  return (
    <ModelSelectorRoot
      models={models}
      value={value}
      onValueChange={setValue}
      effort={mode}
      onEffortChange={(effort) => setMode(effort === "thinking" ? "thinking" : "instant")}
    >
      <ModelSelectorTrigger variant="ghost" size="sm" aria-label="Choose model" className="max-w-48">
        <ModelSelectorValue showEffort />
      </ModelSelectorTrigger>
      <ModelSelectorContent side="top" align="start">
        <ModelSelectorSearch />
        <ModelSelectorList />
        <ModelSelectorEffort label="Mode" />
      </ModelSelectorContent>
    </ModelSelectorRoot>
  );
}

/** Per-reply alternate model choice, rendered by the shipped kit Element. */
export function RegenerateAction() {
  const { models, value } = useContext(ModelPickerContext);
  const aui = useAui();
  const eligible = useContext(ModelChoiceAllowedContext);
  const [open, setOpen] = useState(false);
  if (!eligible || models.length < 2 || !value) return null;
  return <RegenerateMenu
    options={models.map((model) => ({ id: model.id, label: model.name, detail: model.id }))}
    open={open}
    currentId={value}
    onOpenChange={setOpen}
    onPick={(model) => {
      setOpen(false);
      aui.message().reload({ runConfig: { custom: { model } } });
    }}
  />;
}

/** slice 5(e): the "..." menu's second entry (Details, the stats reveal -
 * slice 5(d), landed 2026-09-22) - COORDINATOR named both for this same
 * menu so it's touched once. Admin-only on both sides: hidden here for
 * anyone else, and POST /api/turn/bare itself 403s regardless, so this
 * is convenience, not the real gate. */
export function CompareWithBareModelMenuItem() {
  const isAdmin = useContext(AdminContext);
  const openCompare = useContext(CompareOpenContext);
  const turnId = useAuiState((s) => s.message.metadata?.custom?.turnId as string | undefined);
  const conversationId = useAuiState((s) => s.message.metadata?.custom?.conversationId as string | undefined);
  const text = useAuiState((s) => messageText(s.message));
  if (!isAdmin) return null;
  return (
    <ActionBarMorePrimitive.Item
      // eslint-disable-next-line shadcn/no-unknown-classes -- aui-action-bar-more-item is a kit ActionBarMorePrimitive class, not a Tailwind utility
      className="aui-action-bar-more-item hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none disabled:pointer-events-none disabled:opacity-50"
      disabled={!turnId || !conversationId}
      onSelect={(e) => {
        e.preventDefault();
        if (!turnId || !conversationId) return;
        openCompare({ turnId, conversationId, ourText: text });
      }}
    >
      <CompareIcon className="size-4" />
      {!turnId || !conversationId ? "Compare (available once saved)" : "Compare with the bare model"}
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

export function AssistantMoreItems() {
  const temporary = useContext(TemporaryChatContext).on;
  return (
    <>
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
// same 45s threshold, real Element instead of hand-drawn `<span>●</span>`
// prose. No `elapsed`: Home has no turn-elapsed source for a running
// message today (the message-timing row owns finished-turn timing) - a
// named gap, not invented data.
export function ChatThinkingIndicator() {
  const running = useAuiState((s) => s.message.status?.type === "running");
  const activity = useTurnActivity();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!running) return;
    const timer = setTimeout(() => setSlow(true), 45_000);
    return () => clearTimeout(timer);
  }, [running]);
  return (
    <ThinkingIndicator
      role="status"
      aria-live="polite"
      label={slow ? "Still working. This is taking longer than usual." : (activity ?? "Thinking…")}
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
export function NextChatWelcome() {
  const { on } = useContext(TemporaryChatContext);
  return (
    <div className="relative mb-6 flex flex-col px-2">
      <EngineStartingLoader />
      {on ? (
        <div className="flex flex-col gap-1">
          <p className="fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-2xl font-medium tracking-tight duration-200">
            Temporary chat
          </p>
          <p className="text-muted-foreground fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-sm duration-200">
            This chat won&apos;t be saved to your history.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <p className="fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-2xl font-medium tracking-tight duration-200">
            How can I help you today?
          </p>
          <p className="text-muted-foreground fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-sm duration-200">
            Runs on your own hub. Your chats stay at home.
          </p>
        </div>
      )}
    </div>
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
export function NextReasoningGroup({ children, group }: PropsWithChildren<{ group: ThreadGroupPart }>) {
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

// SRC-ICON-01: `elements/sources.tsx`'s own `Sources` card (Slice 5(a))
// had no `href` (a source could never be opened) and rendered a bare
// letter glyph for every row, never the site's real icon - both filed
// as kit asks in docs/dev.md. Fixed at the source: `sources.aui.tsx`
// (vendored from assistant-ui, c-99e5a) gives `Source` (a real `<a
// target="_blank" rel="noopener noreferrer">`) and `SourceIcon` (a
// favicon `<img>` with a letter fallback on error), composed by hand
// below inside the kit's own `Collapsible` - see `SourcesFooterContent`.
// `domain` still reads spec's `site` field (source.schema.json's own
// description: "the hostname a citation chip shows"); `url` now carries
// straight through instead of being dropped. Keyed by `url`, not index or
// domain: `composer.ts`'s `sourceRows()` already dedupes by `url`
// (`byUrl.has(source.url)`), so it's a stable, collision-free key, unlike
// `domain` (two pages on the same site) or index (would miskey across a
// re-render that reorders).
// Reads the CURRENT message's own "sources" tool-call result straight off
// message state (not a prop) - `SourcesActionBarTrigger` and
// `SourcesFooterContent` below are both bare `ComponentType` slots (the
// same `AssistantMoreItems`/`CompareWithBareModelMenuItem` shape a few
// lines up), rendered by the kit with no props of their own.
// `.find()`, not `.filter()`: `chatModelAdapter.ts`/`chatHistoryAdapter.ts`
// both emit at most one "sources" tool-call part per message, from the
// turn's own single `sources`/`row.sources` array field (never two calls
// in one turn) - the same "complete snapshot" invariant the comment
// above cites for the index-key fix.
// `useAuiState` is a `useSyncExternalStore` selector: it needs the SAME
// call, with the SAME underlying content, to return the SAME reference,
// or React sees "changed on every read" and loops rather than settling
// (found live: this shipped without the cache first and threw "Maximum
// update depth exceeded" the moment any assistant message rendered).
// `messageText` a few lines up gets away with no cache because it
// returns a primitive string, equal by value; an array needs one.
// Keyed by the tool-call part itself (stable across renders unless its
// own content changes, same as any other assistant-ui message part) -
// a cache miss just recomputes, so a wrong assumption about that
// stability would cost renders, never wrong data.
// A code review caught this (2026-09-27): ProjectResultReload's own
// artifact lookup (below) duplicated this exact find-by-toolName shape
// with a different toolName and no caching - one definition instead,
// used by both. The caching this file's own WeakMaps add (sourcesCache
// just below) is specific to each CALLER's own transform, not to the
// find itself, so it stays out of this shared helper.
export function toolCallPartFromMessage(message: ThreadMessage | undefined, toolName: string): Extract<ThreadAssistantMessagePart, { type: "tool-call" }> | undefined {
  return message?.content.find(
    (p): p is Extract<ThreadAssistantMessagePart, { type: "tool-call" }> => p.type === "tool-call" && p.toolName === toolName,
  );
}

interface ChatSource {
  domain: string;
  title: string;
  url: string;
}
export const sourcesCache = new WeakMap<object, ChatSource[]>();
export const NO_SOURCES: ChatSource[] = [];
export function sourcesFromMessage(message: ThreadMessage | undefined): ChatSource[] {
  const part = toolCallPartFromMessage(message, "sources");
  if (!part) return NO_SOURCES;
  const cached = sourcesCache.get(part);
  if (cached) return cached;
  const result = (part.result as SpecSource[] | undefined)?.map((source) => ({ domain: source.site, title: source.title, url: source.url })) ?? NO_SOURCES;
  sourcesCache.set(part, result);
  return result;
}

// The hub's own favicon route (SRC-ICON-01 part 2, backend/src/routes/
// favicon.ts): never the upstream Element's default (a third-party
// `icons.duckduckgo.com` call straight from the browser, exactly what
// the privacy promise on source.schema.json's own `url` field rules
// out) - `SourceIcon`'s `faviconUrl` prop swaps that default for this.
export function faviconUrl(domain: string): string {
  return `/api/favicon?domain=${encodeURIComponent(domain)}`;
}

// Jesse's own screenshots (2026-09-22): the trigger moves INTO the
// assistant message's action bar, as the last item after "..." - subtle,
// the bar's own ghost style, stacked favicons of the first few sources
// plus the word "Sources", no pill, no count badge, no chevron (the
// count lives in the tooltip instead). Splitting the trigger and the
// open content across two DOM locations (this bar row vs. the block-
// level space below the whole footer) means composing the kit's own
// `Collapsible` directly here rather than the shipped `Sources` card's
// own bundled trigger+content - `SourceIcon` is the same kit export the
// open content list below uses, not a second hand-rolled glyph.
// `Tooltip`/`TooltipTrigger`/`TooltipContent` and the Elements' own
// `Button` directly, not the kit's `TooltipIconButton` its bar siblings
// (Copy, Reload, More) use: that wrapper is a fixed square icon button
// with an sr-only label, and this trigger needs a visible text label
// ("Sources") beside the icon stack at its own natural width - the same
// reasoning `inlineToggle`/`collapsedToggle` above already give for not
// using it on the rail toggle, just on this file's other side of the
// page. Still every piece a shipped primitive, composed, not forked.
export function SourcesActionBarTrigger() {
  const turnId = useAuiState((s) => s.message.metadata?.custom?.turnId as string | undefined);
  const sources = useAuiState((s) => sourcesFromMessage(s.message));
  const { isOpen, toggle, close } = useContext(SourcesOpenContext);
  // A review caught this: `AssistantActionBar` sits inside
  // `ActionBarPrimitive.Root`'s `autohide="not-last"` (thread.aui.tsx),
  // which truly unmounts the whole bar - this trigger included - on any
  // earlier message once the pointer/focus leaves it. `SourcesFooterContent`
  // below is a plain sibling outside that root, so it doesn't autohide -
  // without this, the panel it renders would stay open with its own
  // trigger gone, no visible way left to close it. Closing on unmount
  // matches the rest of the bar: every other control in this row already
  // disappears on the same condition.
  useEffect(() => {
    return () => {
      if (turnId) close(turnId);
    };
  }, [turnId, close]);
  if (!turnId || !sources.length) return null;
  const open = isOpen(turnId);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ElementsButton
          variant="ghost"
          size="xs"
          aria-expanded={open}
          onClick={() => toggle(turnId)}
          className="text-foreground/60 hover:text-foreground/90"
        >
          <span className="flex items-center" aria-hidden="true">
            {sources.slice(0, 3).map((source, index) => (
              <SourceIcon key={source.url} url={source.url} faviconUrl={faviconUrl} className={index === 0 ? "ring-2 ring-background" : "-ml-1.5 ring-2 ring-background"} />
            ))}
          </span>
          <span>{sources.length === 1 ? "1 Source" : `${sources.length} Sources`}</span>
        </ElementsButton>
      </TooltipTrigger>
      <TooltipContent>Show sources</TooltipContent>
    </Tooltip>
  );
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
  return (
    <>
      <SourcesActionBarTrigger />
      <FailedTurnErrorDetailsAction />
    </>
  );
}

// SRC-ICON-01: composed straight from the vendored Elements, no hand-
// built row - `Source` (a real `<a>`, target `_blank`, `rel="noopener
// noreferrer"` by default) plus an explicit `referrerPolicy="no-referrer"`
// (source.schema.json's own privacy promise on `url`: "a cited site
// learns nothing from the click but the click" - `rel="noreferrer"`
// alone already withholds the Referer header in every evergreen
// browser, but the schema names both attributes and this sets both
// rather than leaning on the overlap), `SourceIcon` pointed at the
// hub's own favicon route (never the shipped default, `faviconUrl`
// above), `SourceTitle`. The chip look (`variant`/`size` untouched) is
// the shipped Element's own, not a custom row shape - the kit's
// `Collapsible`/`CollapsibleContent` (the same primitive the old
// `Sources` card built on) gives the open/close chrome, styled with the
// same `collapsePanel` token that card's own content panel used.
export function SourcesFooterContent() {
  const turnId = useAuiState((s) => s.message.metadata?.custom?.turnId as string | undefined);
  const sources = useAuiState((s) => sourcesFromMessage(s.message));
  const { isOpen, toggle } = useContext(SourcesOpenContext);
  if (!turnId || !sources.length) return null;
  return (
    <div className="ms-2 pb-2">
      <Collapsible open={isOpen(turnId)} onOpenChange={() => toggle(turnId)}>
        <CollapsibleContent
          // eslint-disable-next-line shadcn/require-static-classes -- collapsePanel is a stable module-level constant, not a runtime-computed string
          className={collapsePanel}
        >
          <div className="flex flex-wrap gap-1.5 pt-2.5" data-slot="sources-list">
            {sources.map((source) => (
              <Source key={source.url} href={source.url} referrerPolicy="no-referrer" variant="secondary">
                <SourceIcon url={source.url} faviconUrl={faviconUrl} />
                <SourceTitle>{source.title}</SourceTitle>
              </Source>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
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
  const { isOpen } = useContext(DetailsOpenContext);
  if (!turnId || !stats || !isOpen(turnId)) return null;
  const timingStats = buildTimingStats(stats);
  timingStats.push(...buildContextSegmentStats(stats));
  if (timingStats.length === 0) return null;
  return (
    <div className="ms-2 flex flex-col gap-1.5 pb-2">
      <MessageTiming stats={timingStats} />
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

// One `AssistantMessageFooterExtra` slot, three independent reveals
// (the bare-model badge, sources, Details) - each keyed by its own
// state and rendering (or not) on its own, so this wrapper is pure
// composition, no shared logic between them.
export function MessageFooterExtra() {
  return (
    <>
      <BareModelBadge />
      <SourcesFooterContent />
      <MessageDetailsReveal />
    </>
  );
}
