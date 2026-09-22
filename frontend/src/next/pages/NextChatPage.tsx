import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FocusEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionBarMorePrimitive, AssistantRuntimeProvider, useAssistantToolUI, useAui, useAuiState, useLocalRuntime, useRemoteThreadListRuntime, type ThreadAssistantMessagePart, type ThreadMessage, type ToolCallMessagePartComponent } from "@assistant-ui/react";
import { Thread } from "@maipai/ui/src/elements/thread.aui";
import { ThreadListItems, ThreadListNew, ThreadListRoot, ThreadListSearch } from "@maipai/ui/src/elements/thread-list.aui";
import { SpecSheet } from "@maipai/ui/src/elements/spec-sheet";
import { ArtifactCard } from "@maipai/ui/src/elements/artifact-card";
import { Sources, SourceGlyph } from "@maipai/ui/src/elements/sources";
import { ToolTimeline } from "@maipai/ui/src/elements/tool-timeline";
import { ThinkingIndicator } from "@maipai/ui/src/elements/thinking-indicator";
import { MessageTiming, type TimingStat } from "@maipai/ui/src/elements/message-timing";
import { ContextDisplay } from "@maipai/ui/src/elements/context-display";
// The Elements' own smaller `Button` (not the dashboard `Button` this
// file otherwise uses), because this one renders as a sibling of Copy/
// Reload/etc INSIDE the assistant-ui action bar itself (matching what
// TooltipIconButton, thread.aui.tsx's own action-bar button, wraps) -
// the dashboard Button belongs to the surrounding page chrome, not this
// row.
import { Button as ElementsButton } from "@maipai/ui/src/elements/ui/button";
import { CanvasSplit, CanvasSplitBody, CanvasSplitDocument, CanvasSplitHeader, CanvasSplitLine, CanvasSplitMessage, CanvasSplitThread } from "@maipai/ui/src/elements/canvas-split";
import { Alert, AlertDescription } from "@maipai/ui/src/dashboard/components/ui/alert";
import { Button } from "@maipai/ui/src/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@maipai/ui/src/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@maipai/ui/src/ui/tooltip";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { getIcon } from "@maipai/ui/src/icons";
import { cn } from "@maipai/ui/src/utils";
import { api, ApiError, isOwnerOrAdminRole, readBareCompareStream, type BareCompareTrace, type Roster, type StructuredPart, type TurnStats } from "@/lib/api";
import type { Source } from "@maipai/spec/gen/ts/source.js";
import { createChatModelAdapter } from "@/apps/chat/chatModelAdapter";
import { createChatThreadListAdapter } from "@/apps/chat/chatThreadListAdapter";
import { createChatFeedbackAdapter } from "@/apps/chat/chatActionBar";
import { createChatSpeechAdapter } from "@/apps/chat/chatSpeechAdapter";
import { messageText } from "@/apps/chat/chatMessageText";
import { useTurnActivity } from "@/apps/chat/chatTurnActivity";
import type { SentenceSpeechScheduler } from "@/lib/sentenceSpeechScheduler";

const HistoryIcon = getIcon("history");
// CHAT-UI-03 (3): the app rail's own toggle (sidebar.tsx's
// SidebarTrigger) already uses `panel-left` - the chat column's own
// toggle read as a mistake sharing the identical glyph in a different
// row/alignment. A distinct one here, never touching the app rail's
// own (that one stays exactly where the template puts it).
const RailToggleIcon = getIcon("message-square");
// ADMIN-COMPARE-01: no icon in the kit's own registry reads as "compare"
// specifically - grid-2x2 (a two-pane split) is the closest already-
// registered fit, chosen over adding a new one to keep this item to the
// one kit tag it already needed for the action bars themselves.
const CompareIcon = getIcon("grid-2x2");
const DetailsIcon = getIcon("gauge");

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
const SpecSheetToolRender: ToolCallMessagePartComponent<Record<string, never>, StructuredPart> = ({ result }) => {
  if (!result) return null;
  return <SpecSheet title={result.title} subtitle={result.subtitle} rows={result.rows} visibleCount={result.rows.length} />;
};

function StructuredResultTools() {
  // `display: "standalone"` (AssistantToolUIProps's own option): without
  // it, Thread's own chain-of-thought grouping tucks a tool-call part
  // behind a collapsed "1 tool call" trigger by default (found live -
  // a weather card nobody can see without an extra click is a real
  // regression for a family hub, not a cosmetic nit).
  useAssistantToolUI({ toolName: "weather", render: SpecSheetToolRender, display: "standalone" });
  useAssistantToolUI({ toolName: "almanac-date", render: SpecSheetToolRender, display: "standalone" });
  return null;
}

// SHELL-02 slice 4: the artifact-card row of the wiring table.
// `useAssistantToolUI`'s own `result` is only ever `{id, version}`
// (chatModelAdapter.ts/chatHistoryAdapter.ts's own comment on why: the
// wire and the reload row both name a version, never carry its body) -
// the card fetches the CURRENT version itself (`api.artifactCurrent`,
// not the bare per-version read) so its own title/kind stay fresh the
// same way the open canvas does, if a later turn updates this exact
// artifact before the card is ever clicked.
const ArtifactOpenContext = createContext<(id: string) => void>(() => {});

// ADMIN-COMPARE-01: the same two-context shape as the artifact panel
// above (an "open" callback threaded down through context, since
// AssistantMoreItems is a bare ComponentType slot with no props of its
// own) - `AdminContext` for the one gate this whole action needs, so it
// never shows for anyone who'd just get a 403 from the route.
const AdminContext = createContext(false);
type CompareTarget = { turnId: string; conversationId: string; ourText: string };
const CompareOpenContext = createContext<(target: CompareTarget) => void>(() => {});

/** Shared by `SourcesActionBarTrigger` and `SourcesFooterContent` below -
 * the lifted open/closed state, keyed by `turnId` (see `NextChatPage`'s
 * own `sourcesOpenValue`). `close` (not just `toggle`) exists for
 * `SourcesActionBarTrigger`'s own unmount cleanup: `AssistantActionBar`
 * sits inside `ActionBarPrimitive.Root`'s `autohide="not-last"`
 * (thread.aui.tsx), which truly unmounts the whole bar - trigger
 * included - on any earlier message once the pointer/focus leaves it.
 * Without closing on that unmount, `SourcesFooterContent` (a plain
 * sibling outside the bar, so it doesn't autohide) would keep the panel
 * open with its own trigger gone - a review-caught orphaned-open state. */
const SourcesOpenContext = createContext<{
  isOpen: (turnId: string) => boolean;
  toggle: (turnId: string) => void;
  close: (turnId: string) => void;
}>({ isOpen: () => false, toggle: () => {}, close: () => {} });

/** Slice 5(d): the "..." menu's second entry, Details (the stats
 * reveal) - the same lifted-by-turnId shape `SourcesOpenContext` above
 * already uses, simpler here since the trigger lives inside the "More"
 * menu itself, not the bar's own row, so it isn't exposed to that
 * menu's own autohide unmount risk. */
const DetailsOpenContext = createContext<{
  isOpen: (turnId: string) => boolean;
  toggle: (turnId: string) => void;
}>({ isOpen: () => false, toggle: () => {} });

/** slice 5(e): the "..." menu's second entry (Details, the stats reveal -
 * slice 5(d), landed 2026-09-22) - COORDINATOR named both for this same
 * menu so it's touched once. Admin-only on both sides: hidden here for
 * anyone else, and POST /api/turn/bare itself 403s regardless, so this
 * is convenience, not the real gate. */
function CompareWithBareModelMenuItem() {
  const isAdmin = useContext(AdminContext);
  const openCompare = useContext(CompareOpenContext);
  const turnId = useAuiState((s) => s.message.metadata?.custom?.turnId as string | undefined);
  const conversationId = useAuiState((s) => s.message.metadata?.custom?.conversationId as string | undefined);
  const text = useAuiState((s) => messageText(s.message));
  if (!isAdmin) return null;
  return (
    <ActionBarMorePrimitive.Item
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
 * own `ContextDisplay.Bar` piece IS admin-gated further down, since it
 * needs `api.engines()`, an owner/admin-only route. */
function MessageDetailsMenuItem() {
  const { toggle } = useContext(DetailsOpenContext);
  const turnId = useAuiState((s) => s.message.metadata?.custom?.turnId as string | undefined);
  const stats = useAuiState((s) => s.message.metadata?.custom?.stats as TurnStats | undefined);
  if (!stats) return null;
  return (
    <ActionBarMorePrimitive.Item
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

function AssistantMoreItems() {
  return (
    <>
      <CompareWithBareModelMenuItem />
      <MessageDetailsMenuItem />
    </>
  );
}

const ArtifactCardToolRender: ToolCallMessagePartComponent<Record<string, never>, { id: string; version: number }> = ({ result }) => {
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
    <ArtifactCard
      title={data?.title ?? "Document"}
      meta={meta}
      generating={query.isLoading}
      onClick={() => openArtifact(result.id)}
    />
  );
};

function ArtifactTool() {
  useAssistantToolUI({ toolName: "write_document", render: ArtifactCardToolRender, display: "standalone" });
  return null;
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
type TimelineCall = { callId: string; packageId: string; label?: string; state: "running" | "ok" | "error" };
const TIMELINE_VERB: Record<TimelineCall["state"], string> = {
  running: "Running",
  ok: "Ran",
  error: "Failed",
};
const ToolTimelineIcon = getIcon("wrench");
const ToolTimelineToolRender: ToolCallMessagePartComponent<Record<string, never>, TimelineCall[]> = ({ result }) => {
  const [open, setOpen] = useState(false);
  if (!result?.length) return null;
  const running = result.some((call) => call.state === "running");
  return (
    <ToolTimeline
      steps={result.map((call) => ({ verb: TIMELINE_VERB[call.state], chip: call.label ?? call.packageId, icon: ToolTimelineIcon }))}
      visibleSteps={result.length}
      streaming={running}
      open={open}
      onOpenChange={setOpen}
      activeLabel="Working…"
      restingLabel={`${result.length} tool call${result.length === 1 ? "" : "s"}`}
      // No producer for a per-file diff-stat summary anywhere in Home
      // today (the kit's own upstream use is a coding-agent timeline) -
      // a named gap, not invented data.
      stats={[]}
    />
  );
};

function ToolTimelineTool() {
  useAssistantToolUI({ toolName: "tool_timeline", render: ToolTimelineToolRender, display: "standalone" });
  return null;
}

// Slice 5(c), "thinking before the reply" (2026-09-22): `/chat`'s own
// hand-rolled thread.aui.tsx already has this exact behavior (its own
// "indicator" case, `useTurnActivity()` plus a 45s "still working"
// timer) - `status` IS a real wire event (CHAT-16, `backend/src/wire.ts`,
// BACKLOG.md's own "Engine emits `status` events at lookup start" item,
// done 2026-09-15), unlike TOOL-EVENTS-01's tool events. `/next/chat`
// just never got this port. The kit's own `ThinkingIndicator` Element
// (thinking-indicator.tsx) replaces its bare pulsing dot via the new
// `Indicator` slot (ui-v0.5.29) - ported, not reinvented: same signal,
// same 45s threshold, real Element instead of hand-drawn `<span>●</span>`
// prose. No `elapsed`: Home has no turn-elapsed source for a running
// message today (the message-timing row owns finished-turn timing) - a
// named gap, not invented data.
function ChatThinkingIndicator() {
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

// Slice 5(a): the kit's own `Sources` (elements/sources.tsx), used exactly
// as it ships - never the retired page's `blocks/chat/SourcesCard`, the
// pre-2026-09-21 kit block this shell rebuild is retiring page by page.
// Its own `Source` shape (`{domain, title}`) is narrower than spec's real
// citation record - `domain` reads spec's `site` field (source.schema.json's
// own description of `site`: "the hostname a citation chip shows," exactly
// what `domain` means here); `url`/`snippet`/`kind`/`id` have nowhere to go
// in the shipped card. Two real gaps in the shipped Element itself, named
// in docs/dev.md rather than reached around: its rows are `<div>`s with no
// `href` (a source can't be opened - filed as a kit ask), and it keys each
// row by `domain` (`elements/sources.tsx:53`), which collides when a reply
// cites two different pages on the same site - not deduped here (that
// would drop a real citation), filed as a kit ask (key by index instead).
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
const sourcesCache = new WeakMap<object, { domain: string; title: string }[]>();
const NO_SOURCES: { domain: string; title: string }[] = [];
function sourcesFromMessage(message: ThreadMessage | undefined): { domain: string; title: string }[] {
  const part = message?.content.find(
    (p): p is Extract<ThreadAssistantMessagePart, { type: "tool-call" }> =>
      p.type === "tool-call" && p.toolName === "sources",
  );
  if (!part) return NO_SOURCES;
  const cached = sourcesCache.get(part);
  if (cached) return cached;
  const result = (part.result as Source[] | undefined)?.map((source) => ({ domain: source.site, title: source.title })) ?? NO_SOURCES;
  sourcesCache.set(part, result);
  return result;
}

// Jesse's own screenshots (2026-09-22): the trigger moves INTO the
// assistant message's action bar, as the last item after "..." - subtle,
// the bar's own ghost style, stacked favicons of the first few sources
// plus the word "Sources", no pill, no count badge, no chevron (the
// count lives in the tooltip instead). The shipped `Sources` Element
// bundles its own trigger+content as one `Collapsible`; splitting them
// across two DOM locations (this bar row vs. the block-level space below
// the whole footer) needed the kit's own `hideTrigger` prop (ui-v0.5.27)
// rather than a hand-built collapsible - `SourceGlyph` is the same kit
// export the content list itself uses, not a second hand-rolled glyph.
// `Tooltip`/`TooltipTrigger`/`TooltipContent` and the Elements' own
// `Button` directly, not the kit's `TooltipIconButton` its bar siblings
// (Copy, Reload, More) use: that wrapper is a fixed square icon button
// with an sr-only label, and this trigger needs a visible text label
// ("Sources") beside the icon stack at its own natural width - the same
// reasoning `inlineToggle`/`collapsedToggle` above already give for not
// using it on the rail toggle, just on this file's other side of the
// page. Still every piece a shipped primitive, composed, not forked.
function SourcesActionBarTrigger() {
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
              <SourceGlyph key={index} domain={source.domain} className={index === 0 ? "ring-2 ring-background" : "-ml-1.5 ring-2 ring-background"} />
            ))}
          </span>
          <span>Sources</span>
        </ElementsButton>
      </TooltipTrigger>
      <TooltipContent>{sources.length === 1 ? "1 source" : `${sources.length} sources`}</TooltipContent>
    </Tooltip>
  );
}

function SourcesFooterContent() {
  const turnId = useAuiState((s) => s.message.metadata?.custom?.turnId as string | undefined);
  const sources = useAuiState((s) => sourcesFromMessage(s.message));
  const { isOpen, toggle } = useContext(SourcesOpenContext);
  if (!turnId || !sources.length) return null;
  return (
    <div className="ms-2 pb-2">
      <Sources sources={sources} open={isOpen(turnId)} onOpenChange={() => toggle(turnId)} layout="list" hideTrigger />
    </div>
  );
}

function buildTimingStats(stats: TurnStats): TimingStat[] {
  const list: TimingStat[] = [];
  if (stats.time_to_first_token_ms !== null) list.push({ label: "First token", value: `${(stats.time_to_first_token_ms / 1000).toFixed(1)}s` });
  if (stats.total_time_ms !== null) list.push({ label: "Total", value: `${(stats.total_time_ms / 1000).toFixed(1)}s` });
  if (stats.tokens_per_second !== null) list.push({ label: "Speed", value: `${stats.tokens_per_second.toFixed(0)} tok/s` });
  if (stats.engine) list.push({ label: "Engine", value: stats.engine });
  return list;
}

/** Slice 5(d): admin-only (`api.engines()` itself is owner/admin-gated) -
 * `modelContextWindow` comes from the currently-loaded chat role's own
 * `measuredContextLength` (the Stack roles API, the wiring table's own
 * "Model choice" row's source). No fallback derivation from
 * `context_used_percent`: that field is a permanent `null` in the
 * backend today (`turnStats.ts` never computes it - `context_tokens` is
 * a bare alias for `prompt_tokens`, not a real percentage-of-window
 * measurement), so dividing by it would be dividing by nothing, not a
 * real number. When the Stack isn't configured (`roles` empty, the
 * common case today per `routes/engines.ts`'s own header) or the chat
 * role's own context length hasn't been measured yet, this piece is
 * left out rather than shown with an invented window - CTX-SEG-01
 * (getmaipai/home#133) is the real fix (a segment breakdown that
 * doesn't need a window at all), and `context-breakdown` replaces this
 * piece the day it lands. */
function MessageDetailsContextBar({ stats }: { stats: TurnStats }) {
  const isAdmin = useContext(AdminContext);
  // `["engines"]`, not a slice-local key: `NextEnginesPage.tsx` already
  // queries the identical `api.engines()` call under this exact key - a
  // review caught the first version using its own `["engines-overview"]`,
  // which meant an admin who'd already loaded Engines got a second,
  // independently-caching network round trip here instead of reusing
  // react-query's own cache entry.
  const enginesQuery = useQuery({
    queryKey: ["engines"],
    queryFn: api.engines,
    enabled: isAdmin,
    staleTime: 60_000,
  });
  if (!isAdmin) return null;
  const modelContextWindow = enginesQuery.data?.roles?.find((role) => role.id === "chat")?.model?.measuredContextLength ?? null;
  if (!modelContextWindow || stats.prompt_tokens === null) return null;
  // A review caught this: `context_tokens` is a bare alias for
  // `prompt_tokens` (`turnStats.ts`), not a real total, so using it
  // alone as `totalTokens` left every turn's own `predicted_tokens`
  // outside the percent-full reading entirely - the sum of both is
  // what's actually sitting in context once a reply has generated.
  // `cachedInputTokens` is left out on purpose: `cache_reuse_tokens` is
  // ADDITIVE to `prompt_tokens` in this backend's own math
  // (`turnStats.ts`'s own `cacheDenominator = cacheTokens + promptTokens`),
  // not a subset of it the way `ContextDisplay`'s own contract assumes a
  // provider's cached-token count is - mapping it in showed a "Cached
  // input" segment that could read larger than "Input" itself, a
  // self-contradictory number for the admin reading it.
  const usage = {
    totalTokens: stats.prompt_tokens + (stats.predicted_tokens ?? 0),
    inputTokens: stats.prompt_tokens,
    outputTokens: stats.predicted_tokens ?? undefined,
  };
  return <ContextDisplay.Bar modelContextWindow={modelContextWindow} usage={usage} />;
}

function MessageDetailsReveal() {
  const turnId = useAuiState((s) => s.message.metadata?.custom?.turnId as string | undefined);
  const stats = useAuiState((s) => s.message.metadata?.custom?.stats as TurnStats | undefined);
  const { isOpen } = useContext(DetailsOpenContext);
  if (!turnId || !stats || !isOpen(turnId)) return null;
  const timingStats = buildTimingStats(stats);
  if (timingStats.length === 0) return null;
  return (
    <div className="ms-2 flex flex-col gap-1.5 pb-2">
      <MessageTiming stats={timingStats} />
      <MessageDetailsContextBar stats={stats} />
    </div>
  );
}

// One `AssistantMessageFooterExtra` slot, two independent reveals
// (sources, Details) - each keyed by its own turnId-scoped open state
// and rendering (or not) on its own, so this wrapper is pure
// composition, no shared logic between the two.
function MessageFooterExtra() {
  return (
    <>
      <SourcesFooterContent />
      <MessageDetailsReveal />
    </>
  );
}

// The tool call still needs SOME registration or assistant-ui's own
// fallback UI renders it inline in the message content - same no-op
// shape as ChatPage.tsx's `SuppressLegacySourcesFallback` (`623878a6`),
// for the identical reason: the real render now happens in the two
// slots above, not in the message body.
function SuppressSourcesFallback() {
  useAssistantToolUI({ toolName: "sources", render: () => null, display: "standalone" });
  return null;
}

/** canvas-split's own acceptance: opens beside the thread, closing
 * keeps the thread, a later turn's update to the same artifact
 * replaces the pane's content. The last one comes free of any id
 * bookkeeping: `api.artifactCurrent()` always resolves through the
 * artifact's own key server-side (routes/artifacts.ts's `/current`),
 * so re-fetching the SAME `openArtifactId` after a new turn completes
 * is enough - `NextChatPage`'s own effect invalidates the query
 * whenever the thread's message count changes, the simplest real
 * signal "a turn just finished." No mini transcript reconstruction
 * (`CanvasSplitThread`/`CanvasSplitMessage`, used exactly as shipped
 * below): fetching the triggering turn's own user message would be a
 * second round trip this slice doesn't need yet, so this shows the
 * document's own title as the one assistant-side line instead of
 * inventing dialogue. */
function ArtifactCanvasPanel({ artifactId, onClose }: { artifactId: string; onClose: () => void }) {
  const query = useQuery({ queryKey: ["artifact-current", artifactId], queryFn: () => api.artifactCurrent(artifactId) });
  return (
    <CanvasSplit>
      <CanvasSplitThread>
        <CanvasSplitMessage speaker="assistant">{query.data ? `Wrote "${query.data.title}."` : "Wrote the document."}</CanvasSplitMessage>
      </CanvasSplitThread>
      <CanvasSplitDocument>
        <AsyncState
          data={query.data}
          error={query.isError}
          isFetching={query.isFetching}
          onRetry={() => void query.refetch()}
          errorMessage={query.error instanceof ApiError ? query.error.message : "Could not load this document."}
          loadingLabel="Loading document"
        >
          {(artifact) => (
            <>
              <CanvasSplitHeader title={artifact.title} version={artifact.version} saved onCopy={() => void navigator.clipboard.writeText(artifact.body)} onClose={onClose} />
              <CanvasSplitBody>
                {artifact.body.split("\n").map((line, index) => (
                  // No stable id in a plain-text body: index is fine,
                  // this list never reorders itself, only refetches as
                  // a whole.
                  <CanvasSplitLine key={index}>{line || " "}</CanvasSplitLine>
                ))}
              </CanvasSplitBody>
            </>
          )}
        </AsyncState>
      </CanvasSplitDocument>
    </CanvasSplit>
  );
}

/** ADMIN-COMPARE-01: "Compare with the bare model" opens this beside the
 * thread, the same `CanvasSplit` the artifact panel above uses - a bare
 * container (`flex ... md:flex-row`, nothing hardwired to one document)
 * composed TWICE here, ours and the bare model's own reply side by side,
 * rather than forked or given a second Element. `version`/`saved` on
 * `CanvasSplitHeader` are the artifact shape's own fields (no real
 * "version" concept for either side of a compare) - both panes read
 * `version={1} saved` so the shipped header renders its normal "saved"
 * state instead of a half-finished "editing" one neither pane is ever
 * actually in. */
function BareCompareCanvasPanel({ target, onClose }: { target: CompareTarget; onClose: () => void }) {
  const [trace, setTrace] = useState<BareCompareTrace | null>(null);
  const [bareText, setBareText] = useState("");
  const [refused, setRefused] = useState(false);
  const [status, setStatus] = useState<"loading" | "streaming" | "done" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setTrace(null);
    setBareText("");
    setRefused(false);
    setStatus("loading");
    setErrorMessage(null);
    (async () => {
      try {
        const response = await api.compareTurnBare(target.conversationId, target.turnId, controller.signal);
        for await (const event of readBareCompareStream(response)) {
          if (event.type === "trace") {
            setTrace(event.trace);
            setStatus("streaming");
          } else if (event.type === "delta") {
            setBareText((text) => text + event.text);
            setStatus("streaming");
          } else if (event.type === "refused") {
            setRefused(true);
          } else if (event.type === "done") {
            setStatus("done");
          }
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setStatus("error");
        setErrorMessage(err instanceof ApiError ? err.message : "Could not compare with the bare model.");
      }
    })();
    return () => controller.abort();
  }, [target.conversationId, target.turnId]);

  return (
    <CanvasSplit>
      <CanvasSplitDocument>
        <CanvasSplitHeader title="Ours" version={1} saved onCopy={() => void navigator.clipboard.writeText(target.ourText)} onClose={onClose} />
        <CanvasSplitBody>
          <CanvasSplitLine>{target.ourText}</CanvasSplitLine>
          {trace ? (
            <>
              <CanvasSplitLine heading>Trace</CanvasSplitLine>
              <CanvasSplitLine>Rung: {trace.rung ?? "none"}</CanvasSplitLine>
              <CanvasSplitLine>
                Route: {trace.routing_tier ?? "model"}
                {trace.routing_score !== null ? ` (${trace.routing_score.toFixed(2)})` : ""}
              </CanvasSplitLine>
              <CanvasSplitLine>Rules fired: {trace.rules.length > 0 ? trace.rules.join(", ") : "none"}</CanvasSplitLine>
              <CanvasSplitLine>Guard: {trace.guard_reason ?? "none"}</CanvasSplitLine>
              <CanvasSplitLine>Thinking: {trace.stats?.thinking ? "on" : "off"}</CanvasSplitLine>
              <CanvasSplitLine>Model: {trace.stats?.engine ?? "unknown"}</CanvasSplitLine>
              <CanvasSplitLine>Persona in effect: {trace.persona_fragments || "none"}</CanvasSplitLine>
            </>
          ) : null}
        </CanvasSplitBody>
      </CanvasSplitDocument>
      <CanvasSplitDocument>
        <CanvasSplitHeader title="Bare model" version={1} saved onCopy={() => void navigator.clipboard.writeText(bareText)} onClose={onClose} />
        <CanvasSplitBody writing={status === "streaming"}>
          {status === "loading" ? <CanvasSplitLine>Asking the bare model…</CanvasSplitLine> : null}
          {status === "error" ? <CanvasSplitLine>{errorMessage}</CanvasSplitLine> : null}
          {bareText ? <CanvasSplitLine>{bareText}</CanvasSplitLine> : null}
          {refused ? <CanvasSplitLine>The bare reply was refused by the same safety pass a real turn uses.</CanvasSplitLine> : null}
        </CanvasSplitBody>
      </CanvasSplitDocument>
    </CanvasSplit>
  );
}

/** /next/chat: SHELL-02's slice 2 (docs/plans/shell-on-shadcndashboard-
 * 2026-09-21.md's own wiring table) - the Elements thread LIST
 * (ui/src/elements/thread-list.aui.tsx, self-contained: New Thread,
 * search, grouped items, rename, delete) joins slice 1's thread on
 * Home's existing thread-list adapter (chatThreadListAdapter.ts,
 * already proven by ChatPage.tsx): open a past conversation, continue
 * it, start a new one, delete one. `getConversationId` is real now
 * (`useRemoteThreadListRuntime`'s own `runtimeHook`, ChatPage.tsx's
 * exact pattern) - slice 1's "no thread list, so no id to resolve"
 * comment no longer applies.
 *
 * No Pin here: the shipped Element's own "more" menu is Rename /
 * Archive / Delete, not Rename / Pin / Delete - the OLD shell's own
 * `assistant-ui/thread-list.aui.tsx` (Home's own product composition,
 * outside the vendored path) added Pin by hand against
 * `updateCustom({pinned})`; the vendored Elements version never grew
 * that action, and forking it to add one would be exactly what "the
 * kit wraps and composes, it does not fork" forbids. Archive itself
 * stays wired to `chatThreadListAdapter.ts`'s own deliberate refusal
 * ("the shared record has no archive state") - that decision predates
 * this slice and isn't this slice's call to revisit.
 *
 * Slice 3 (tools and generative UI): weather's and almanac-date's own
 * structured result renders through the shipped `SpecSheet` Element
 * (`StructuredResultTools` above), keyed on the producing package's
 * real name - a package with a plain-text result is unaffected, and
 * every other tool call still renders through Thread's own built-in
 * `ToolFallback` (running/complete/fallback states, already shipped,
 * no wiring needed). Known gap, found in review, not this slice's own
 * call to fix (getmaipai/home#130): `structured_part` is computed
 * fresh on the live `done` event (chatModelAdapter.ts) but never
 * persisted - `conversation_turns` has no column for it, so
 * chatHistoryAdapter.ts's own reload path has nothing to rebuild a
 * tool-call part from. A spec-sheet card renders for the live turn,
 * then reverts to plain text the moment the page reloads or the
 * thread is reopened.
 *
 * Slice 4 (artifacts): the `write_document` package's own record
 * (`TurnValue.artifact`/the reload row's own `artifact` field, both
 * `{id, version}` only) renders as `ArtifactCard` inline
 * (`ArtifactTool` below), keyed on the one bundled package that
 * writes this record today. Clicking it opens `ArtifactCanvasPanel`
 * beside the thread on desktop, as a bottom Sheet on phone/tablet
 * (mirroring the retired `chatDocumentPane.tsx`'s own split); closing
 * it clears `openArtifactId`, never touches the thread. Unlike
 * `structured_part` (getmaipai/home#130), this survives reload: the
 * artifact record is really stored, so `api.artifactCurrent()`
 * resolves it fresh every time, live turn or history alike.
 *
 * Suggestions and attachments are each their own follow-up slice (the
 * wiring table's remaining rows). `speakReplies: false` still holds -
 * no "stop speaking" control on screen yet. */
// The shipped `<ThreadList>` (thread-list.aui.tsx's own default export)
// hardcodes its own `<ThreadListNew>` with no way to hand it a click
// handler - composed here instead from that same file's other exported
// pieces (its own implementation, mirrored exactly) so New Thread can
// also close the phone/tablet Sheet, the same way selecting an
// existing thread already does. `ThreadListPrimitive.New`'s own onClick
// is composed with (not replaced by) the one passed here
// (radix-ui's composeEventHandlers, confirmed in the installed
// package) - both fire, so this changes nothing about starting a new
// thread itself.
// CHAT-UI-02: the desktop rail-collapse toggle rides in this row,
// beside New Thread, rather than a row of its own above the column.
// Jesse's own literal spec (22:22, after 22:04's "no floating placement"
// landed the column itself but left the toggle floating and oversized):
// in the open and peeked states the toggle is an INLINE element of this
// row, in normal flow, the same size as the row's other icon buttons -
// never absolutely positioned, never painted over New Thread or
// anything else. Only the collapsed state (this row isn't rendered at
// all - the column is `hidden`) gets a second, identically-sized
// floating button at the row's own former top-left, since there's
// nothing left in flow to place it inline with. The mobile Sheet's own
// instance passes no `collapseToggle` (it has no collapse of its own),
// so nothing renders there.
function NextThreadList({ onNewThread, collapseToggle }: { onNewThread: () => void; collapseToggle?: ReactNode }) {
  const [search, setSearch] = useState("");
  const hasThreads = useAuiState((s) => s.threads.threadIds.length > 0);
  return (
    <ThreadListRoot>
      {/* CHAT-UI-03 (2): Jesse's own ChatGPT comparison - "New Thread"
          read as stretched full width beside the toggle; it keeps the
          Element's own natural button width instead (no `flex-1`). */}
      <div className="flex items-center gap-1">
        {collapseToggle}
        <ThreadListNew onClick={onNewThread} />
      </div>
      {hasThreads && <ThreadListSearch value={search} onValueChange={setSearch} />}
      <ThreadListItems searchQuery={hasThreads ? search : ""} />
    </ThreadListRoot>
  );
}

function useNextChatRuntime(person: Roster, closeSheet: () => void) {
  const turnSchedulerRef = useRef<SentenceSpeechScheduler | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const threadListAdapter = useMemo(() => createChatThreadListAdapter(person.display_name), [person.display_name]);

  // A named, `use`-prefixed function, not an inline arrow - ChatPage.tsx's
  // own comment on why: `useRemoteThreadListRuntime` calls `runtimeHook`
  // from inside its own render, so react-hooks/rules-of-hooks needs the
  // naming convention to recognize this as a real hook call.
  function useChatRuntimeHook() {
    const aui = useAui();
    const chatModelAdapter = useMemo(
      () =>
        createChatModelAdapter({
          getConversationId: async () => {
            const { remoteId } = await aui.threadListItem().initialize();
            await api.resumeConversation(remoteId);
            return remoteId;
          },
          consumeThinking: () => true,
          consumeSupersedes: () => undefined,
          onCrisisResources: setBanner,
          turnSchedulerRef,
          speakReplies: false,
        }),
      [aui],
    );
    // slice 5(e): thumbs and read-aloud both ride the shipped
    // capability/adapter mechanism (`s.thread.capabilities.feedback`/
    // `.speech`), the reason the kit's own AssistantActionBar can just
    // render ActionBarPrimitive.FeedbackPositive/Negative and .Speak/
    // .StopSpeaking with no Home-side plumbing beyond these two - the
    // feedback adapter is the old chat's own (chatActionBar.tsx, its
    // real POST /api/conversations/turns/:id/feedback route), unchanged;
    // the speech adapter is new (chatSpeechAdapter.ts), the identical
    // POST /api/tts pieces chatListenStore.ts's own "Listen" replay
    // already uses, wired through the runtime instead of a second store.
    const adapters = useMemo(() => ({ feedback: createChatFeedbackAdapter(), speech: createChatSpeechAdapter() }), []);
    return useLocalRuntime(chatModelAdapter, { adapters });
  }

  const runtime = useRemoteThreadListRuntime({
    runtimeHook: useChatRuntimeHook,
    adapter: threadListAdapter,
    threadId: searchParams.get("conversation") ?? undefined,
    onThreadIdChange: (id) => {
      setSearchParams(id ? { conversation: id } : {}, { replace: true });
      closeSheet();
    },
  });

  return { runtime, banner };
}

/** Mounted inside AssistantRuntimeProvider only for its side effect: a
 * later turn's own message lands in the thread, and that is the signal
 * ("a turn just finished") that any open artifact-canvas query should
 * refetch, since a reply may have updated the exact artifact id it's
 * showing. No thread-id bookkeeping needed - `api.artifactCurrent()`
 * resolves through the artifactKey server-side either way. */
function ArtifactCacheInvalidator() {
  const queryClient = useQueryClient();
  const messageCount = useAuiState((s) => s.thread.messages.length);
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ["artifact-current"] });
  }, [messageCount, queryClient]);
  return null;
}

export function NextChatPage({ person }: { person: Roster }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [openArtifactId, setOpenArtifactId] = useState<string | null>(null);
  // ADMIN-COMPARE-01: the identical desktop-pane/mobile-sheet split
  // openArtifactId already has, one state slot instead of a whole second
  // "which panel is open" enum - only ever one of the two is non-null in
  // practice (comparing a message closes the artifact view and vice
  // versa would be reasonable too, but nothing forces it; both panels
  // rendering at once on a wide enough screen is a fine, harmless state).
  const [compareTarget, setCompareTarget] = useState<CompareTarget | null>(null);
  // Sources trigger-in-bar (2026-09-22, Jesse's own screenshots): the
  // trigger lives in the assistant message's own action bar
  // (`AssistantActionBarExtra`), the compact list it opens renders below
  // the whole footer row (`AssistantMessageFooterExtra`) - two separate
  // slots the kit renders at two different points in the same message's
  // tree, so the open/closed state can't just be a `useState` local to
  // either one; it's lifted here and keyed by `turnId`, the same id
  // `CompareWithBareModelMenuItem` already reads off message metadata.
  const [openSourceIds, setOpenSourceIds] = useState<ReadonlySet<string>>(new Set());
  // `useCallback` with no deps (not inline closures in the `useMemo`
  // below): `SourcesActionBarTrigger`'s own unmount-cleanup effect keys
  // its dependency array on `close`, and `setOpenSourceIds` itself is
  // already React-stable, so these never need to change identity when
  // `openSourceIds` does. Found live: without this, EVERY toggle gave
  // `close` a fresh identity, which re-armed the effect and ran the
  // OLD closure's cleanup immediately - closing the panel the same
  // click had just opened.
  const toggleSourceOpen = useCallback((turnId: string) => {
    setOpenSourceIds((prev) => {
      const next = new Set(prev);
      if (next.has(turnId)) next.delete(turnId);
      else next.add(turnId);
      return next;
    });
  }, []);
  const closeSourceOpen = useCallback((turnId: string) => {
    setOpenSourceIds((prev) => {
      if (!prev.has(turnId)) return prev;
      const next = new Set(prev);
      next.delete(turnId);
      return next;
    });
  }, []);
  const sourcesOpenValue = useMemo(
    () => ({
      isOpen: (turnId: string) => openSourceIds.has(turnId),
      toggle: toggleSourceOpen,
      close: closeSourceOpen,
    }),
    [openSourceIds, toggleSourceOpen, closeSourceOpen],
  );
  // Slice 5(d): the same lifted-by-turnId shape as sources above, no
  // `close` needed - the Details trigger lives inside the "More" menu
  // itself (`MessageDetailsMenuItem`), not the bar's own row, so it's
  // never exposed to `AssistantActionBar`'s own autohide unmount.
  const [openDetailsIds, setOpenDetailsIds] = useState<ReadonlySet<string>>(new Set());
  const toggleDetailsOpen = useCallback((turnId: string) => {
    setOpenDetailsIds((prev) => {
      const next = new Set(prev);
      if (next.has(turnId)) next.delete(turnId);
      else next.add(turnId);
      return next;
    });
  }, []);
  const detailsOpenValue = useMemo(
    () => ({
      isOpen: (turnId: string) => openDetailsIds.has(turnId),
      toggle: toggleDetailsOpen,
    }),
    [openDetailsIds, toggleDetailsOpen],
  );
  // CHAT-UI-01 finding 4 / CHAT-UI-02: a ChatGPT-style collapse for the
  // desktop thread-list column. The shipped Sidebar primitive's own
  // collapsible modes (threadlist-sidebar.aui.tsx's own composition)
  // render `position: fixed` against the viewport's own left edge -
  // built for being the page's ONE top-level sidebar, not a second
  // column nested beside one that's already there (it would render
  // under or over the app rail, not after it). Nothing here forks that
  // primitive or hand-builds a new one: this toggles the same plain
  // column this file already had, the identical pattern `sheetOpen`
  // already uses for the phone/tablet Sheet.
  //
  // Jesse's literal spec for the peek (22:04), after floating-placement
  // attempts against the kit's HoverCard (Base UI's PreviewCard, whose
  // own floating-ui portal never lands on a DIFFERENT sibling element's
  // box in general - tried side/align/offset math against the trigger,
  // then overriding the portal's own Positioner element directly, both
  // measured live and wrong): no floating placement at all. The column
  // is one node that always lives in this page's own layout at its own
  // slot - open is normal flow, collapsed is `hidden` (width 0, out of
  // the accessibility tree, same as before CHAT-UI-02), peeked is the
  // SAME node repositioned with `position: absolute; inset-y-0; left-0`
  // inside the row below (`relative`, sitting below the app header, so
  // the overlay can never leave the chat area), at its normal open
  // width, layered above the thread. No JS-measured rect, no portal, no
  // effect: plain Tailwind classes keyed off two booleans, so the peeked
  // box is pixel-identical to the open box by construction rather than
  // by measurement.
  //
  // The toggle itself, refined again (22:22): a first pass floated one
  // button over the column's own top-left in every state, which read as
  // an oversized control painted on top of New Thread instead of
  // belonging to the row. Open and peeked now render an INLINE toggle
  // (`NextThreadList`'s own `collapseToggle` slot, first cell of its
  // header row, the same icon-button size as its other controls) - true
  // flow, not absolute, so it never floats over anything. Only the
  // collapsed state has no row to be inline WITH (the column is
  // `hidden`), so that state alone gets a second, identically-styled
  // button positioned at the row's own former top-left. Exactly one of
  // the two is ever mounted. Closing the peek keys off pointer-leave of
  // the column itself (`next-chat-rail`): the inline toggle is now a
  // real DESCENDANT of it (not a `display: contents` sibling, the
  // approach a review on an earlier draft found never received the
  // browser's own pointerleave - `display: contents` drops an element
  // from the rendered box tree Chromium's own hover-tracking hit-tests
  // against), so the ancestor-chain firing native pointerleave already
  // does works with no dead zone and no manual relatedTarget check
  // needed for this pair.
  // CHAT-UI-03 (6): Jesse's own side-by-side at a narrow window -
  // ChatGPT never lets the sidebar cover the conversation, collapsing
  // it below the width where the rail, the column, and a usable pane
  // no longer all fit; ours kept both open and let the column cover the
  // greeting and composer. Below this width the column now starts
  // collapsed instead of open - a DEFAULT, not a lock: hover-to-peek
  // and click-to-pin-open still work exactly as at any width, so a
  // person who wants it open at 768px can still have it. A lazy
  // initializer, not a resize-reactive effect: this sets where the
  // column STARTS, once, not an ongoing constraint that would snap a
  // deliberately-reopened column shut again on a later resize.
  const RAIL_AUTO_COLLAPSE_MAX_WIDTH = 1024;
  const [railCollapsed, setRailCollapsed] = useState(
    () => typeof window !== "undefined" && window.matchMedia(`(max-width: ${RAIL_AUTO_COLLAPSE_MAX_WIDTH}px)`).matches,
  );
  const [railPeeked, setRailPeeked] = useState(false);
  const closeRailPeek = (relatedTarget: EventTarget | null) => {
    if (!railCollapsed) return;
    const rail = document.getElementById("next-chat-rail");
    if (relatedTarget instanceof Node && rail?.contains(relatedTarget)) return;
    setRailPeeked(false);
  };
  // A review caught this: since the inline and collapsed toggles are two
  // separate `Button` instances (never both mounted at once), a keyboard
  // user who Tabs onto whichever one is visible and triggers the state
  // change that swaps them (focus opens the peek, same as hover) loses
  // focus outright when the DOM node they were on unmounts - the browser
  // has nothing to transfer it to on its own, so it reverts to `<body>`,
  // and the next Tab restarts from the top of the document instead of
  // continuing into the now-visible column.
  // A first fix (`document.activeElement === document.body` as the
  // signal that focus was just lost) went back on re-review: that check
  // can't tell "a focused node just unmounted" apart from "nothing has
  // ever been focused," true for both the initial mount and every
  // mouse-only interaction (`onPointerEnter` shares the same
  // peek-opening logic as `onFocus`) - a mouse user hovering the
  // collapsed toggle to peek, then moving the pointer away, would have
  // had keyboard focus silently forced onto them, and the very first
  // render would have stolen it on load. Fixed with an explicit intent
  // flag instead of inferring one: only `onFocus` and `onClick` (real
  // interactions with the toggle itself, never the passive
  // `onPointerEnter` a hover also fires) set it, so the effect only ever
  // follows focus after a person actually interacted with the specific
  // node that's about to unmount.
  // A second bug, found only by actually running this: the effect's own
  // `target.focus()` call fires that button's real `onFocus` handler
  // too (a programmatic `.focus()` dispatches the same event a person
  // tabbing in would), so `handleToggleFocus` immediately re-armed
  // `pendingToggleFocusRef` and re-ran `handleToggleEnter()` - on a
  // COLLAPSED toggle, that opened the peek as a side effect of merely
  // restoring focus to it, which flipped `railPeeked` again, which
  // re-ran this same effect: a real cascade, live and in the test suite
  // both. A transient boolean guard around the `.focus()` call was tried
  // first and dropped: it assumes the resulting `focus` event dispatches
  // synchronously, which happy-dom doesn't do, so the guard was already
  // cleared by the time the handler ran. Fixed with identity instead of
  // timing: `programmaticFocusTargetRef` records WHICH node the effect
  // is about to focus, and `handleToggleFocus` ignores an event whose
  // `currentTarget` is that exact node - correct no matter when the
  // event actually fires, since nothing else in this component calls
  // `.focus()` in between.
  // A re-review caught one more gap: if `target.focus()` never actually
  // moves focus (below the `lg` breakpoint, `collapsedToggle` is
  // `hidden`, so calling `.focus()` on it is a no-op in every real
  // browser - no `focus` event ever fires), nothing ever clears
  // `programmaticFocusTargetRef`, so a LATER genuine Tab onto that same
  // node (the viewport grown back past `lg`) would be silently
  // swallowed as "my own doing." A `requestAnimationFrame` fallback
  // clears it a frame later if the real focus event hasn't already done
  // so first - long enough for any real dispatch (sync or the next
  // microtask, either one lands well within a frame), short enough that
  // a node that was never actually focusable doesn't stay masked.
  // `target` itself is never null in practice: it's read from the same
  // conditional this effect's own dependencies mirror, and React
  // attaches refs during commit, strictly before effects run in that
  // same pass - by the time this runs, whichever toggle the condition
  // names has already mounted.
  const inlineToggleRef = useRef<HTMLButtonElement>(null);
  const collapsedToggleRef = useRef<HTMLButtonElement>(null);
  const pendingToggleFocusRef = useRef(false);
  const programmaticFocusTargetRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!pendingToggleFocusRef.current) return;
    pendingToggleFocusRef.current = false;
    const target = railCollapsed && !railPeeked ? collapsedToggleRef.current : inlineToggleRef.current;
    if (!target) return;
    programmaticFocusTargetRef.current = target;
    target.focus();
    const raf = requestAnimationFrame(() => {
      if (programmaticFocusTargetRef.current === target) programmaticFocusTargetRef.current = null;
    });
    return () => cancelAnimationFrame(raf);
  }, [railCollapsed, railPeeked]);
  // A code review caught this: switching threads (onThreadIdChange,
  // inside useNextChatRuntime) left a previous thread's artifact
  // canvas open over the newly-loaded one - the panel has to close on
  // the same signal the phone/tablet Sheet already does.
  const { runtime, banner } = useNextChatRuntime(person, () => {
    setSheetOpen(false);
    setOpenArtifactId(null);
    setCompareTarget(null);
  });
  // One base element, rendered at the phone/tablet Sheet and the
  // collapsed rail's own peek overlay - ChatPage.tsx's own fix for
  // exactly this (a code review caught two call sites drifting once one
  // grew props the other didn't). The persistent desktop rail gets its
  // own instance below, since it alone carries the collapse toggle.
  const threadList = <NextThreadList onNewThread={() => setSheetOpen(false)} />;
  const closeArtifact = () => setOpenArtifactId(null);
  const closeCompare = () => setCompareTarget(null);
  // The toggle (see the CHAT-UI-02 comment above the state
  // declarations): open and peeked render it inline, in
  // `NextThreadList`'s own header row; collapsed alone falls back to a
  // second, identically-styled instance positioned at that row's own
  // former top-left, since there's no row left to be inline with. Same
  // aria-label/expanded/handlers either way. Hover/focus opens the peek
  // while collapsed; the click always pins the rail fully open
  // (independent of hover) and clears `railPeeked` so a later collapse
  // never mounts already "peeked" from a stale hover.
  // A real defect Jesse found (Firefox, hard reload): clicking the open
  // toggle to collapse it left the pointer sitting over the exact spot
  // where the collapsed toggle instance now mounts - a browser
  // recomputes what's under a stationary pointer whenever the DOM
  // changes there, so it fired a "phantom" pointerenter on the new node
  // with no real mouse movement, which `handleToggleEnter` read as a
  // hover and immediately re-opened the peek, undoing the collapse's own
  // visible effect in the same frame (from Jesse's own eyes, the click
  // did nothing). `suppressHoverPeekRef` closes this: every click (either
  // direction, collapsing or pinning open - the SAME phantom-enter risk
  // exists for the inline/collapsed instance swap either way) sets it,
  // and only a REAL pointer-leave of whichever toggle instance is
  // currently mounted clears it, so the peek stays suppressed until the
  // pointer genuinely leaves and a later hover is a real one again. Only
  // `onPointerEnter` is gated by it - a genuine keyboard Tab onto the
  // toggle right after that same click (`handleToggleFocus` below) has
  // no phantom-recomputation risk analogous to a stationary mouse, and
  // must still open the peek immediately.
  const suppressHoverPeekRef = useRef(false);
  // Jesse found the suppression above regressed: a click-triggered DOM
  // swap fires a pointerleave on the OUTGOING toggle too, not just a
  // phantom pointerenter on the incoming one - the same stationary
  // pointer, no real transition, but `handleToggleLeave` cleared the
  // suppression flag on ANY leave, so that incidental event raced ahead
  // of the swap's own phantom enter and defeated it. `relatedTarget`
  // can't tell the two apart here (an environment quirk found writing
  // this fix's own test: happy-dom never reports an unspecified
  // `relatedTarget` as falsy the way a real browser does, so a leave
  // fired with no real destination is indistinguishable, in a test,
  // from one with a genuine one). Real pointer MOVEMENT is unambiguous
  // either way: the incidental leave/enter pair a DOM swap fires under
  // a stationary pointer report the exact same client coordinates the
  // click itself had (the OS cursor hasn't moved), while any leave that
  // follows a genuine hand movement reports different ones. Recorded at
  // click time, compared at leave time.
  const suppressPointerOriginRef = useRef<{ x: number; y: number } | null>(null);
  // Jesse's third report of this exact pane-jitter: `transition-[width]`
  // used to sit unconditionally on the rail's own base className, so
  // *any* width change animated - including closing the peek, which
  // flips the node from `absolute w-64` (out of flow, harmless) to
  // `static w-0` (in flow, so the chat pane gets squeezed for the
  // animation's own 200ms). Only a real click should ever ease the
  // width; hover opening or closing the peek must jump instantly. The
  // transition classes now ride this flag instead of the base string,
  // true only across a click-driven width change - `cn()` drops a
  // falsy entry, so when it's false the transition property is
  // genuinely absent from the rail's className, not merely overridden.
  // Must match the rail's own `duration-200` Tailwind class in its
  // className below - Tailwind's JIT needs that class as a literal
  // string there, so this can't be interpolated in; a change to one
  // needs the other updated by hand.
  const RAIL_WIDTH_TRANSITION_MS = 200;
  // A hard, rAF-independent ceiling - found live on 8787 (2026-09-22),
  // not by either review pass: this session's own automation tab is
  // genuinely backgrounded (`document.visibilityState === "hidden"`,
  // `document.hasFocus() === false`), and `requestAnimationFrame`
  // confirmed NOT firing within 1000ms there - the spec's own throttle
  // for a tab that isn't actively painting. The rAF-deferred fallback
  // below would never run in that state, leaving `railWidthAnimating`
  // stuck true (silently reintroducing the original bug for hover on
  // that tab) until the next real click's own transitionend happened to
  // clear it. A plain `setTimeout`, scheduled with no rAF in between,
  // always eventually fires regardless of tab visibility - padded well
  // past the transition's real ~200ms so it never wins the race in the
  // normal foregrounded case.
  const RAIL_WIDTH_ANIMATION_BACKSTOP_MS = 600;
  const [railWidthAnimating, setRailWidthAnimating] = useState(false);
  const railWidthAnimatingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const railWidthAnimatingRafRef = useRef<number | null>(null);
  const railWidthAnimatingBackstopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearRailWidthAnimationTimers = () => {
    if (railWidthAnimatingRafRef.current !== null) {
      cancelAnimationFrame(railWidthAnimatingRafRef.current);
      railWidthAnimatingRafRef.current = null;
    }
    if (railWidthAnimatingTimeoutRef.current !== null) {
      clearTimeout(railWidthAnimatingTimeoutRef.current);
      railWidthAnimatingTimeoutRef.current = null;
    }
    if (railWidthAnimatingBackstopRef.current !== null) {
      clearTimeout(railWidthAnimatingBackstopRef.current);
      railWidthAnimatingBackstopRef.current = null;
    }
  };
  const stopRailWidthAnimation = () => {
    clearRailWidthAnimationTimers();
    setRailWidthAnimating(false);
  };
  const startRailWidthAnimation = () => {
    setRailWidthAnimating(true);
    clearRailWidthAnimationTimers();
    // `onTransitionEnd` below is the normal clear path; this is the net
    // for a transition that never fires - `motion-reduce` drops it, and
    // a peeked-then-click-to-open goes absolute-w-64 -> static-w-64 (no
    // width VALUE change at all, so no "width" transitionend either).
    // A code review caught this racing ahead of the real transition
    // when it started here synchronously: a CSS transition's own clock
    // begins at the next paint, not the moment this class flips in JS,
    // so a plain `setTimeout(200)` fired a few ms before the genuine
    // transitionend and truncated the animation early on every click,
    // not just the no-value-change case this fallback exists for.
    // Deferred one rAF (the same "wait for the committed frame" pattern
    // this file's own toggle-focus effect above already uses) so the
    // fallback's own clock starts close to when the real one does.
    railWidthAnimatingRafRef.current = requestAnimationFrame(() => {
      railWidthAnimatingRafRef.current = null;
      railWidthAnimatingTimeoutRef.current = setTimeout(() => {
        railWidthAnimatingTimeoutRef.current = null;
        setRailWidthAnimating(false);
      }, RAIL_WIDTH_TRANSITION_MS);
    });
    railWidthAnimatingBackstopRef.current = setTimeout(() => {
      railWidthAnimatingBackstopRef.current = null;
      setRailWidthAnimating(false);
    }, RAIL_WIDTH_ANIMATION_BACKSTOP_MS);
  };
  useEffect(() => {
    return () => clearRailWidthAnimationTimers();
  }, []);
  const openPeekIfCollapsed = () => {
    if (railCollapsed) setRailPeeked(true);
  };
  const handleToggleEnter = () => {
    if (suppressHoverPeekRef.current) return;
    openPeekIfCollapsed();
  };
  const handleToggleLeave = (e: PointerEvent<HTMLButtonElement>) => {
    const origin = suppressPointerOriginRef.current;
    if (origin && e.clientX === origin.x && e.clientY === origin.y) return;
    suppressHoverPeekRef.current = false;
  };
  // Only a genuine interaction with the toggle itself - focusing it or
  // clicking it - ever sets the pending-focus flag the effect above
  // reads; `onPointerEnter` (a passive hover) shares `openPeekIfCollapsed`
  // for opening the peek but never touches the flag, exactly the
  // distinction the re-review's two false-positive cases needed.
  const handleToggleFocus = (e: FocusEvent<HTMLButtonElement>) => {
    if (programmaticFocusTargetRef.current === e.currentTarget) {
      programmaticFocusTargetRef.current = null;
      return;
    }
    pendingToggleFocusRef.current = true;
    openPeekIfCollapsed();
  };
  const handleToggleClick = (e: MouseEvent<HTMLButtonElement>) => {
    suppressHoverPeekRef.current = true;
    startRailWidthAnimation();
    // A review caught this: `e.detail === 0` is a keyboard-synthesized
    // click (Enter/Space on the focused toggle, per spec) - its own
    // `clientX`/`clientY` are always (0, 0), unrelated to wherever the
    // real mouse actually is, so there's no meaningful origin to compare
    // a later leave against. `null` here means "no origin recorded" -
    // `handleToggleLeave`'s own `if (origin && ...)` then clears
    // suppression on the very first leave that follows, the same
    // unconditional behavior this mechanism had before the coordinate
    // check existed, correct for a keyboard-driven collapse where a real
    // mouse position was never part of the interaction to begin with.
    suppressPointerOriginRef.current = e.detail === 0 ? null : { x: e.clientX, y: e.clientY };
    pendingToggleFocusRef.current = true;
    if (railCollapsed) {
      setRailCollapsed(false);
      setRailPeeked(false);
    } else {
      setRailCollapsed(true);
    }
  };
  const toggleLabel = railCollapsed ? "Show conversations" : "Hide conversations";
  const toggleExpanded = !railCollapsed || railPeeked;
  const inlineToggle = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          ref={inlineToggleRef}
          variant="ghost"
          size="icon"
          aria-label={toggleLabel}
          aria-expanded={toggleExpanded}
          aria-controls="next-chat-rail"
          onPointerEnter={handleToggleEnter}
          onPointerLeave={handleToggleLeave}
          onFocus={handleToggleFocus}
          onClick={handleToggleClick}
        >
          <RailToggleIcon className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Conversations</TooltipContent>
    </Tooltip>
  );
  const collapsedToggle = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          ref={collapsedToggleRef}
          variant="ghost"
          size="icon"
          aria-label={toggleLabel}
          aria-expanded={toggleExpanded}
          aria-controls="next-chat-rail"
          className="absolute top-0 left-0 z-20 hidden lg:flex"
          onPointerEnter={handleToggleEnter}
          onPointerLeave={handleToggleLeave}
          onFocus={handleToggleFocus}
          onClick={handleToggleClick}
        >
          <RailToggleIcon className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Conversations</TooltipContent>
    </Tooltip>
  );

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ArtifactOpenContext.Provider value={setOpenArtifactId}>
      <AdminContext.Provider value={isOwnerOrAdminRole(person.role)}>
      <CompareOpenContext.Provider value={setCompareTarget}>
      <SourcesOpenContext.Provider value={sourcesOpenValue}>
      <DetailsOpenContext.Provider value={detailsOpenValue}>
        <StructuredResultTools />
        <ArtifactTool />
        <ToolTimelineTool />
        <SuppressSourcesFallback />
        <ArtifactCacheInvalidator />
        {/* CHAT-UI-01 finding 3: `overflow-hidden` keeps this box's own
            height a hard ceiling, not a floor a growing composer or a
            streaming reply could push past - FullLayout.tsx's own
            wrapper around Outlet used to be `min-h-*`, not `h-*`, so any
            overflow here became real extra page height, and the page
            gaining and losing scroll range as content settled read as
            the composer bouncing. The thread viewport (Thread's own
            child) stays the only real scroller on this page.
            `h-full`, not a guessed `h-[calc(100vh-Npx)]`: tokens.css's
            own full-height rule block (keyed on this element's own
            `data-slot`) turns FullLayout.tsx's entire chain above this
            div into a real flex conduit down to the true available
            height, so this just reads it off that chain instead of
            re-deriving the same number a second, guessable way. */}
        <div data-slot="next-chat-shell" className="flex h-full flex-col overflow-hidden">
          {/* CHAT-UI-02: the desktop collapse toggle used to live in this
              row on its own, above the column, wasting a full row that
              only ever showed one button (this row's OTHER button, the
              mobile Sheet trigger, is `lg:hidden` - nothing here has ever
              been visible on desktop). It now floats over the column's own
              first cell at a fixed spot in every state (`railToggle`,
              below), so this row is mobile-only. */}
          <div className="flex items-center gap-1 border-b border-border pb-2 lg:hidden">
            <Button variant="ghost" size="icon" aria-label={sheetOpen ? "Hide threads" : "Show threads"} aria-expanded={sheetOpen} aria-controls="next-chat-threads" onClick={() => setSheetOpen((open) => !open)}>
              <HistoryIcon className="size-4" />
            </Button>
          </div>
          {banner ? (
            <Alert className="mx-4 mt-2 mb-2">
              <AlertDescription>{banner}</AlertDescription>
            </Alert>
          ) : null}
          <div className="relative flex min-h-0 flex-1">
            {/* `lg:` not `sm:` - tokens.css's own --breakpoint-lg note
                (the kit's 960px default reopens a squeeze at tablet
                width), the same reason ChatPage.tsx's own persistent
                column uses it. This row is `relative`: the peeked
                rail's own `absolute inset-y-0 left-0` (below) resolves
                against IT, not the chat area, so the peeked box starts
                at this row's own left edge - exactly where the open
                rail sits - by construction, with nothing measured. */}
            {/* A code review caught this: `railCollapsed ? null : ...`
                unmounted the div entirely, so the toggle button's own
                `aria-controls="next-chat-rail"` pointed at an id absent
                from the DOM the moment it mattered most - the instant a
                screen reader announces the new collapsed state. Hidden
                via CSS instead (the same `hidden`/`lg:block` pattern
                already used for the phone/tablet breakpoint split), so
                the id always exists.
                Peeked: the SAME node, repositioned in place (Jesse's
                literal spec, 22:04) - `absolute inset-y-0 left-0` at its
                normal open width, inside this row's own `relative` box,
                above the thread (`z-20`). No portal, no measured rect:
                the peeked box is the open box's own CSS, so it's
                pixel-identical by construction. The toggle inside its
                header row is a real descendant now (22:22's inline
                fix), so `onPointerLeave`/`onBlur` here need no dead-zone
                handling beyond checking that the pointer/focus actually
                left this element altogether. */}
            <div
              id="next-chat-rail"
              // CHAT-UI-03 (1): ChatGPT eases both the column and the
              // chat pane during collapse/expand; this used to jump-cut
              // (`hidden` <-> `block`, a `display` swap CSS can't
              // transition). Collapsed-not-peeked is now `w-0
              // overflow-hidden` instead of `hidden` at the `lg`
              // breakpoint - still zero width, but a real box a
              // `transition-[width]` can animate to and from - the
              // app rail's own duration and curve (`sidebar.tsx`:
              // `transition-[width] duration-200 ease-linear`), reduced
              // motion honoured via `motion-reduce:transition-none`.
              // `inert` (not `aria-hidden` alone) while collapsed-not-
              // peeked: a zero-width box is still visually reachable by
              // Tab without it, since `overflow-hidden` doesn't remove
              // its children from focus order the way `display: none`
              // used to.
              inert={railCollapsed && !railPeeked}
              // A review caught this: `border-r`/`pr-2` used to sit on
              // this same element unconditionally, alongside the
              // animated `w-0` - `box-sizing: border-box` can't shrink
              // a box's own padding/border below 0 along with its
              // content, so the collapsed-not-peeked state rendered a
              // persistent ~9px strip with a visible border instead of
              // truly vanishing (invisible while it was `display: none`,
              // real once it became a genuine zero-width box). Border
              // and padding now ride the SAME conditional as the width
              // itself, present only in the two states that actually
              // have width to put them in.
              className={cn(
                "overflow-y-auto bg-background",
                // Only a click (`startRailWidthAnimation`) ever puts this
                // back on the element - see that function's own comment.
                // Hovering the peek open or closed must jump, never ease.
                railWidthAnimating && "transition-[width] duration-200 ease-linear motion-reduce:transition-none",
                railCollapsed
                  ? railPeeked
                    ? "absolute inset-y-0 left-0 z-20 block w-64 border-r border-border pr-2 shadow-lg animate-in slide-in-from-left-4 fade-in motion-reduce:animate-none"
                    : "hidden w-0 lg:block lg:overflow-hidden"
                  : "hidden w-64 shrink-0 border-r border-border pr-2 lg:block",
              )}
              onPointerLeave={(e) => closeRailPeek(e.relatedTarget)}
              onBlur={(e) => closeRailPeek(e.relatedTarget)}
              onTransitionEnd={(e) => {
                if (e.target === e.currentTarget && e.propertyName === "width") stopRailWidthAnimation();
              }}
            >
              <NextThreadList onNewThread={() => { setSheetOpen(false); setRailPeeked(false); }} collapseToggle={inlineToggle} />
            </div>
            {railCollapsed && !railPeeked ? collapsedToggle : null}
            {/* Jesse found this: the row's own `gap-4` (removed above)
                used to space the pane off the rail, but `gap` only
                applies to a FLOW sibling - the rail is flow when open
                or collapsed-not-peeked (`w-0`, still a real flex
                participant even at zero width) but `position: absolute`
                when peeked (removed from flow entirely, so it stops
                claiming a gap). That flow/absolute swap fired on every
                hover, not just a click, so the pane's own left edge
                bumped right on peek-in and back on peek-out even though
                nothing about the pane itself should move for a pure
                overlay. Spacing now lives on the pane directly, keyed
                on `railCollapsed` alone (never `railPeeked`): identical
                whether collapsed-not-peeked or peeked, and animated in
                step with the rail's own `transition-[width]` so a real
                click (the only thing that changes `railCollapsed`)
                still slides smoothly. */}
            <div
              data-slot="next-chat-pane"
              className={cn(
                "min-w-0 flex-1 transition-[margin-inline-start] duration-200 ease-linear motion-reduce:transition-none",
                railCollapsed ? "ms-0" : "ms-4",
              )}
            >
              <Thread
                components={{
                  AssistantMoreItems,
                  AssistantActionBarExtra: SourcesActionBarTrigger,
                  AssistantMessageFooterExtra: MessageFooterExtra,
                  Indicator: ChatThinkingIndicator,
                }}
              />
            </div>
            {openArtifactId !== null ? (
              // Desktop only - the phone/tablet Sheet below covers the
              // same panel under `lg:hidden`, mirroring
              // chatDocumentPane.tsx's own split.
              <div className="ms-4 hidden w-full max-w-xl shrink-0 overflow-y-auto lg:block">
                <ArtifactCanvasPanel artifactId={openArtifactId} onClose={closeArtifact} />
              </div>
            ) : null}
            {compareTarget !== null ? (
              <div className="ms-4 hidden w-full max-w-3xl shrink-0 overflow-y-auto lg:block">
                <BareCompareCanvasPanel target={compareTarget} onClose={closeCompare} />
              </div>
            ) : null}
          </div>
        </div>
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent id="next-chat-threads" side="left" className="w-80 max-w-[calc(100vw-2rem)] gap-0 p-2 lg:hidden">
            <SheetHeader className="sr-only">
              <SheetTitle>Conversations</SheetTitle>
              <SheetDescription>Past conversations</SheetDescription>
            </SheetHeader>
            {threadList}
          </SheetContent>
        </Sheet>
        <Sheet open={openArtifactId !== null} onOpenChange={(next) => { if (!next) closeArtifact(); }}>
          <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto lg:hidden">
            <SheetHeader className="sr-only">
              <SheetTitle>Document</SheetTitle>
              <SheetDescription>The document from this reply</SheetDescription>
            </SheetHeader>
            {openArtifactId !== null ? <ArtifactCanvasPanel artifactId={openArtifactId} onClose={closeArtifact} /> : null}
          </SheetContent>
        </Sheet>
        <Sheet open={compareTarget !== null} onOpenChange={(next) => { if (!next) closeCompare(); }}>
          <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto lg:hidden">
            <SheetHeader className="sr-only">
              <SheetTitle>Compare with the bare model</SheetTitle>
              <SheetDescription>Our reply beside the same model with no routing, packages, persona or guards</SheetDescription>
            </SheetHeader>
            {compareTarget !== null ? <BareCompareCanvasPanel target={compareTarget} onClose={closeCompare} /> : null}
          </SheetContent>
        </Sheet>
      </DetailsOpenContext.Provider>
      </SourcesOpenContext.Provider>
      </CompareOpenContext.Provider>
      </AdminContext.Provider>
      </ArtifactOpenContext.Provider>
    </AssistantRuntimeProvider>
  );
}
