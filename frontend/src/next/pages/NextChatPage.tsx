import { useCallback, useContext, useEffect, useMemo, useRef, useState, type FocusEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AssistantRuntimeProvider, useAui, useAuiState, useLocalRuntime, useRemoteThreadListRuntime } from "@assistant-ui/react";
import { ChatThread } from "@/apps/chat/ChatThread";
import { MarkdownDocument } from "@/next/pages/MarkdownDocument";
// APPROVE-CARD-01: the same vendored Element `thread.aui.tsx`'s own
// default `ToolFallback` renders (its own `import { ToolFallback } from
// "@maipai/ui/src/assistant-ui/tool-fallback.aui"`) - used here directly
// so a "confirm" card renders through `ToolFallback.Approval` exactly as
// it ships, never a hand-built card (the kit's own `approval-card.tsx`
// is built for a terminal command and can't be relabeled, per the org's
// "no hand-built UI" rule).
import { ThreadListItems, ThreadListNew, ThreadListRoot, ThreadListSearch } from "@maipai/ui/src/elements/thread-list.aui";
import { type ModelOption } from "@maipai/ui/src/elements/model-selector";
// The Elements' own smaller `Button` (not the dashboard `Button` this
// file otherwise uses), because this one renders as a sibling of Copy/
// Reload/etc INSIDE the assistant-ui action bar itself (matching what
// TooltipIconButton, thread.aui.tsx's own action-bar button, wraps) -
// the dashboard Button belongs to the surrounding page chrome, not this
// row.
import { CanvasSplit, CanvasSplitBody, CanvasSplitDocument, CanvasSplitHeader, CanvasSplitLine, CanvasSplitMessage, CanvasSplitThread } from "@maipai/ui/src/elements/canvas-split";
import { Alert, AlertDescription, AlertTitle } from "@maipai/ui/src/dashboard/components/ui/alert";
import { Button } from "@maipai/ui/src/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@maipai/ui/src/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@maipai/ui/src/ui/tooltip";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { useBreakpoint } from "@maipai/ui/src/hooks/useBreakpoint";
import { getIcon } from "@maipai/ui/src/icons";
import { cn } from "@maipai/ui/src/utils";
import { api, ApiError, isOwnerOrAdminRole, canHaveTemporaryChatRole, readBareCompareStream, type BareCompareTrace, type EnginesOverview, type InstalledPackage, type Roster } from "@/lib/api";
import type { Conversation } from "@maipai/spec/gen/ts/conversation.js";
import { createChatModelAdapter } from "@/apps/chat/chatModelAdapter";
import { consumeSupersedes, setPendingSupersedes } from "@/apps/chat/chatEditSupersedes";
import { createChatThreadListAdapter } from "@/apps/chat/chatThreadListAdapter";
import { createChatFeedbackAdapter } from "@/apps/chat/chatActionBar";
import { createChatSpeechAdapter } from "@/apps/chat/chatSpeechAdapter";
import { PackageScopeContext } from "@/apps/chat/composerAddMenu";
import "@/next/pages/nextChatTouchTargets.css";
import "@/next/pages/chatReplyMarkdown.css";
import { WakeWordController } from "@/apps/chat/WakeWordController";
import { useSetChatHeaderData } from "@/apps/chat/chatHeaderData";
import { ChatHeaderBar } from "@/apps/chat/chatHeaderBar";
import { VoiceSessionProvider } from "@/apps/chat/voiceSessionContext";
import { DictationLevelMeterProvider } from "@/apps/chat/composerDictationWaveform";
import { ChatAvailabilityContext, useChatAvailability } from "@/apps/chat/useChatAvailability";
import { LiveVoiceSession } from "@/apps/chat/liveVoiceSession";
import { useHeaderExtra } from "@maipai/ui/src/dashboard/layouts/full/vertical/header/HeaderExtraContext";
import { createLocalImageAttachmentAdapter } from "@/apps/chat/localImageAttachmentAdapter";
import { createSttDictationAdapter } from "@/lib/voice/sttDictationAdapter";
import { createSttSocket } from "@/lib/voice/sttSocket";
import type { LevelMeter } from "@/lib/voice/audioLevelMeter";
import { CURRENT_LOCAL_VISION_CAPABILITY } from "@/apps/chat/visionCapability";
import { CompositeAttachmentAdapter, SimpleTextAttachmentAdapter } from "@assistant-ui/core";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import type { SentenceSpeechScheduler } from "@/lib/sentenceSpeechScheduler";
import { readRailCollapsePreference, writeRailCollapsePreference } from "@/next/railCollapsePreference";
import { INCOGNITO_DISCARDED_EVENT, useIncognitoContext } from "@/next/incognitoContext";
import { useNotificationsQuery } from "@/shell/NotificationBell";
import { readyRole } from "@/apps/chat/engineRoles";
import { ChatShortcutReference } from "@/next/pages/ChatShortcutReference";
import { ArtifactOpenContext, AdminContext, type CompareTarget, CompareOpenContext, SourcesOpenContext, DetailsOpenContext, ThinkingModeContext, ModelPickerContext, BareModeContext, TemporaryChatContext, DraftConversationContext, WakeWordPersonContext, ConnectionStateContext, type ConnectionState } from "@/apps/chat/chatThreadContexts";
import { ConfirmAskAnswerProvider, ReloadMainThreadProvider } from "@/apps/chat/chatToolUis";
import { CompareIcon, MODEL_EFFORTS, toolCallPartFromMessage } from "@/apps/chat/chatThreadSlots";
import { discardDraft } from "@/apps/chat/draftStore";

const HistoryIcon = getIcon("history");
// CHAT-UI-03 (3): the app rail's own toggle (sidebar.tsx's
// SidebarTrigger) already uses `panel-left` - the chat column's own
// toggle read as a mistake sharing the identical glyph in a different
// row/alignment. A distinct pair here, never touching the app rail's
// own (that one stays exactly where the template puts it).
// CHAT-FIND-0923-02: `message-square` never read as a column toggle at
// all (Jesse's own live finding). `panel-left-close`/`panel-left-open`
// (commons ui-v0.5.44) are the closest already-in-the-library state-
// aware pair - still distinct from the outer trigger's plain, static
// `panel-left` (no directional chevron), while actually showing which
// way the click goes, the same idiom the "Show conversations"/"Hide
// conversations" label pair already uses for the same two states.
const RailCloseIcon = getIcon("panel-left-close");
const RailOpenIcon = getIcon("panel-left-open");

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
    // Jesse found this: CanvasSplit's own shipped default is a fixed
    // `md:h-80` (its own upstream use is a small preview card, never a
    // full desktop side panel), so this panel stopped 320px down with
    // empty space below it instead of filling the row's real height
    // (NextChatPage.tsx's own wrapping div already stretches to the
    // row's full height via flexbox's default `align-items: stretch` -
    // CanvasSplit itself just never grew into it). Overridden here via
    // the component's own `className` passthrough (never editing the
    // vendored file) - `md:h-full` specifically, so `cn()`'s
    // `tailwind-merge` matches and replaces the shipped `md:h-80`
    // (same variant, same property) rather than adding a conflicting
    // rule beside it.
    //
    // Jesse also found this: CanvasSplit's own shipped `paper` surface
    // (bg-background, a border on all four sides) plus its own
    // `rounded-[20px]` reads as a floating card next to the thread,
    // where ChatGPT's own reference (a real split pane, edge to edge,
    // divided by a single hairline, never rounded) reads as an attached
    // panel. `rounded-none` clears the shipped radius; `border-0
    // border-l` clears the shipped all-sides border first, then adds
    // back only the left edge as the pane's own divider (tailwind-merge
    // tracks each side's border-width separately, so this is a real
    // override per side, not an extra border stacked on top of the
    // existing four). The wrapping `div` in NextChatPage.tsx dropped its
    // own `ms-4` gap to match - flush against the thread, the same way
    // the reference's pane sits with no gap before its own divider.
    <CanvasSplit className="rounded-none border-0 border-l md:h-full">
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
                {/* THIN-5F (rule 9): the chat's own MarkdownText, exactly as
                    shipped. MarkdownDocument gives the fetched body the
                    message scope the kit's code slot reads; a refetch swaps
                    the text in place. */}
                <MarkdownDocument text={artifact.body} />
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
function NextThreadList({
  onNewThread,
  collapseToggle,
}: {
  onNewThread: () => void;
  collapseToggle?: ReactNode;
}) {
  const [search, setSearch] = useState("");
  const availability = useContext(ChatAvailabilityContext);
  const hasThreads = useAuiState((s) => s.threads.threadIds.length > 0);
  return (
    <ThreadListRoot>
      <div className="flex items-center gap-1">
        {collapseToggle}
        <ThreadListNew label="New chat" className="min-h-12" onClick={onNewThread} disabled={availability === "unavailable"} />
      </div>
      {hasThreads && <ThreadListSearch value={search} onValueChange={setSearch} label="Search chats" />}
      <ThreadListItems searchQuery={hasThreads ? search : ""} />
    </ThreadListRoot>
  );
}

function useNextChatRuntime(person: Roster, closeSheet: () => void, temporaryNext: boolean, onArtifactReady: (artifactId: string) => void, setDraftConversationId: (id: string | undefined) => void) {
  const temporaryNextRef = useRef(temporaryNext);
  temporaryNextRef.current = temporaryNext;
  const turnSchedulerRef = useRef<SentenceSpeechScheduler | null>(null);
  // VOICE-LIVE-02: true only while the live voice session (below) is
  // open - the one gate on `speakReplies` above, and `spokenNextRef` the
  // one flag `consumeSpoken` reads and clears, the same single-shot
  // shape `temporaryNextRef`/`packageScopeRef` already use.
  const liveVoiceActiveRef = useRef(false);
  // HANDSFREE-01(a): automatic read-aloud is remembered per conversation.
  const [autoReadReplies, setAutoReadReplies] = useState(false);
  const autoReadRepliesRef = useRef(false);
  autoReadRepliesRef.current = autoReadReplies;
  const enginesQuery = useQuery<EnginesOverview>({ queryKey: ["engines"], queryFn: () => api.engines(), enabled: isOwnerOrAdminRole(person.role) });
  const chatRole = enginesQuery.data?.roles?.find((role) => role.id === "chat");
  const modelOptions = useMemo<ModelOption[]>(() => {
    if (!enginesQuery.data?.configured) return [];
    return (chatRole?.models ?? []).map((model) => ({ ...model, efforts: MODEL_EFFORTS }));
  }, [chatRole?.models, enginesQuery.data?.configured]);
  const ttsAvailable = readyRole(enginesQuery.data, "tts");
  const ttsAvailableRef = useRef(ttsAvailable);
  ttsAvailableRef.current = ttsAvailable;
  const spokenNextRef = useRef(false);
  const selectedModelRef = useRef<string | undefined>(undefined);
  // APPROVE-CARD-01: armed by ConfirmAskAnswerProvider's own `respond`
  // callback (ConfirmToolRender's respondToApproval, via
  // ConfirmAskAnswerContext), the same single-shot shape as
  // `spokenNextRef` above - `consumeAskAnswer` below reads and clears it.
  const askAnswerRef = useRef<{ turnId: string; approved: boolean } | undefined>(undefined);
  // VOICE-LIVE-02: chatModelAdapter.ts's own onSpeakingChange, relayed as
  // real state so LiveVoiceSession (a sibling component, not inside this
  // hook) can react to the live scheduler's own start/end - nothing else
  // in this file reads it today, so no other caller changes.
  const [isSpeaking, setIsSpeaking] = useState(false);
  // A code review caught this: `isSpeaking` alone misses the case where a
  // reply never spoke at all (empty, or every sentence's TTS failed) -
  // onFirstAudio never fires, so onSpeakingChange(false) arrives with
  // React state ALREADY false, a same-value setState that never
  // re-renders and never re-runs LiveVoiceSession's own effect, leaving
  // the call stuck on "Thinking" forever. Bumped on every `false` call
  // regardless of the previous value, so LiveVoiceSession can depend on
  // this instead of `isSpeaking` alone to notice "speaking is over."
  const [speakingEndedAt, setSpeakingEndedAt] = useState(0);
  const [banner, setBanner] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnectionState>({ phase: "online" });
  const [searchParams, setSearchParams] = useSearchParams();
  // Archive first switches an active remote thread to the blank thread
  // before calling the adapter. Keep the identity of that just-deselected
  // conversation so the adapter's synchronous unsupported-action signal
  // can put the URL back if it matches the thread that was showing.
  const visibleConversationIdRef = useRef(searchParams.get("conversation") ?? undefined);
  const deselectedConversationIdRef = useRef<string | undefined>(undefined);
  const previousThreadIdRef = useRef<string | undefined>(undefined);
  // useSearchParams recreates its setter when the search params change.
  // Keep the adapter callback stable so a thread switch doesn't rebuild
  // the thread-list adapter and restart its runtime.
  const setSearchParamsRef = useRef(setSearchParams);
  setSearchParamsRef.current = setSearchParams;
  const onArchiveUnavailable = useCallback((remoteId: string) => {
    if (visibleConversationIdRef.current !== undefined || deselectedConversationIdRef.current !== remoteId) return;
    visibleConversationIdRef.current = remoteId;
    setDraftConversationId(remoteId);
    deselectedConversationIdRef.current = undefined;
    previousThreadIdRef.current = remoteId;
    setSearchParamsRef.current({ conversation: remoteId }, { replace: true });
  }, [setDraftConversationId]);
  // PERSIST-CONV-01 / RESP-04: Thinking and the selected model hydrate
  // from the active conversation settings and save when changed. Refs
  // keep the memoized model adapter on their current values.
  const [thinking, setThinkingState] = useState(false);
  const thinkingRef = useRef(false);
  thinkingRef.current = thinking;
  const thinkingDirtyRef = useRef(false);
  const autoReadRepliesDirtyRef = useRef(false);
  const selectedModelDirtyRef = useRef(false);
  const pendingNewConversationReadAloudRef = useRef<boolean | undefined>(undefined);
  const pendingNewConversationThinkingRef = useRef<boolean | undefined>(undefined);
  const pendingNewConversationModelRef = useRef<string | undefined>(undefined);
  const settingsWriteRef = useRef<Promise<void>>(Promise.resolve());
  const queueReadAloudWrite = useCallback((conversationId: string, value: boolean) => {
    settingsWriteRef.current = settingsWriteRef.current
      .catch(() => {})
      .then(async () => {
        try {
          await api.setConversationSettings(conversationId, { read_aloud: value });
        } catch {
          toast.error("Could not save this chat's settings. Try again.");
        }
      });
  }, []);
  // Safety ruling, 2026-09-22: the same non-minor floor temporary chat
  // already uses (owner/admin/adult) - a minor's turn request never
  // carries `thinking` at all, belt and braces alongside the composer
  // control being hidden below (a client can be edited). A code review
  // found this is ROLE alone, while the backend's own real gate
  // (routes/turn.ts's isMinor, ageBand.ts's speakerAgeBand) takes the
  // STRICTER of role and birthdate - `Roster` never carries birthdate to
  // the frontend at all (wire.ts's own omission, a deliberate privacy
  // choice), so an account whose role says non-minor but whose
  // birthdate makes the real band stricter shows this control with no
  // effect (the backend still force-sets thinking:false and strips
  // reasoning regardless - no disclosure risk, just a confusing no-op
  // toggle). Fixing it for real needs the backend to expose a computed
  // age_band on the signed-in person's own profile, a wire addition out
  // of scope here - flagged, not silently accepted as correct.
  const thinkingAllowed = canHaveTemporaryChatRole(person.role);
  const applyConversationThinking = useCallback((value: boolean) => {
    thinkingRef.current = value;
    setThinkingState(value);
  }, []);
  const applyAutoReadReplies = useCallback((value: boolean) => {
    autoReadRepliesRef.current = value;
    setAutoReadReplies(value);
  }, []);
  const setConversationAutoReadReplies = useCallback((value: boolean) => {
    autoReadRepliesDirtyRef.current = true;
    applyAutoReadReplies(value);
    const conversationId = visibleConversationIdRef.current;
    if (!conversationId) {
      pendingNewConversationReadAloudRef.current = value;
      return;
    }
    pendingNewConversationReadAloudRef.current = undefined;
    queueReadAloudWrite(conversationId, value);
  }, [applyAutoReadReplies, queueReadAloudWrite]);
  const setThinking = useCallback((value: boolean) => {
    thinkingDirtyRef.current = true;
    applyConversationThinking(value);
    const conversationId = visibleConversationIdRef.current;
    if (!conversationId) {
      pendingNewConversationThinkingRef.current = value;
      return;
    }
    settingsWriteRef.current = settingsWriteRef.current
      .catch(() => {})
      .then(async () => {
        try {
          await api.setConversationSettings(conversationId, { thinking: value });
        } catch {
          toast.error("Could not save this chat's settings. Try again.");
        }
      });
  }, [applyConversationThinking]);
  const [selectedModel, setSelectedModelState] = useState<string | undefined>();
  const applySelectedModel = useCallback((value: string | undefined) => {
    selectedModelRef.current = value;
    setSelectedModelState(value);
  }, []);
  const setSelectedModel = useCallback((value: string) => {
    selectedModelDirtyRef.current = true;
    applySelectedModel(value);
    const conversationId = visibleConversationIdRef.current;
    if (!conversationId) {
      pendingNewConversationModelRef.current = value;
      return;
    }
    pendingNewConversationModelRef.current = undefined;
    settingsWriteRef.current = settingsWriteRef.current
      .catch(() => {})
      .then(async () => {
        try {
          await api.setConversationSettings(conversationId, { model: value });
        } catch {
          toast.error("Could not save this chat's settings. Try again.");
        }
      });
  }, [applySelectedModel]);
  const onConversationSettingsLoaded = useCallback((conversationId: string, settings: Conversation["settings"]) => {
    if (visibleConversationIdRef.current !== conversationId) {
      if (visibleConversationIdRef.current === undefined) {
        visibleConversationIdRef.current = conversationId;
        previousThreadIdRef.current = conversationId;
      } else return;
    }
    if (!thinkingDirtyRef.current) applyConversationThinking(settings?.thinking ?? false);
    if (!autoReadRepliesDirtyRef.current) applyAutoReadReplies(settings?.read_aloud ?? false);
    if (!selectedModelDirtyRef.current) applySelectedModel(settings?.model);
  }, [applyAutoReadReplies, applyConversationThinking, applySelectedModel]);
  const hydrateConversationSettings = useCallback(async (conversationId: string) => {
    const conversation = await api.conversation(conversationId);
    onConversationSettingsLoaded(conversationId, conversation.settings);
    return conversation;
  }, [onConversationSettingsLoaded]);
  const selectedModelValue = modelOptions.length >= 2
    ? (modelOptions.some((model) => model.id === selectedModel) ? selectedModel : modelOptions.some((model) => model.id === chatRole?.model?.id) ? chatRole?.model?.id : modelOptions[0]?.id)
    : undefined;
  const modelPickerAllowed = thinkingAllowed && enginesQuery.data?.configured === true && isOwnerOrAdminRole(person.role) && modelOptions.length >= 2;
  selectedModelRef.current = modelPickerAllowed ? selectedModelValue : undefined;
  const modelPickerAllowedRef = useRef(false);
  modelPickerAllowedRef.current = modelPickerAllowed;
  // ADMIN-COMPARE-01 (b): bare mode. Deliberately session-local, never
  // consumed/reset per turn the way `thinking` is - it stays on for
  // every send until the admin turns it off, or the conversation
  // changes (below), whichever comes first. COORDINATOR's own ruling:
  // a mode that silently changes what the assistant IS must not be
  // able to outlive the investigation that turned it on - reloading
  // the page or switching conversations both end that investigation,
  // so neither carries it forward.
  const [bareMode, setBareMode] = useState(false);
  const bareModeRef = useRef(false);
  bareModeRef.current = bareMode;
  // SHELL-02 slice 6: the Apps menu's choice (composerAddMenu.tsx's
  // `PackageScopeContext`), single-shot like `thinkingRef` above.
  const [packageScope, setPackageScope] = useState<InstalledPackage | null>(null);
  const packageScopeRef = useRef<InstalledPackage | null>(null);
  packageScopeRef.current = packageScope;
  // The remote-thread runtime reloads its list when this adapter changes.
  // Incognito is an exclusive data source: its sessions never merge with
  // durable conversation rows.
  const threadListAdapter = useMemo(() => createChatThreadListAdapter(person.display_name, { incognito: temporaryNext, onArchiveUnavailable, onSettingsLoaded: onConversationSettingsLoaded }), [person.display_name, temporaryNext, onArchiveUnavailable, onConversationSettingsLoaded]);
  // SHELL-02 slice 6: the same real adapters ChatPage.tsx's composer
  // already uses - images plus, new here, text/Markdown files through
  // the shipped `SimpleTextAttachmentAdapter` (client-side only, no
  // route: it reads the file's own text, same as the image adapter
  // reads bytes into a data URL, no backend change needed). PDF and
  // office documents stay unbuilt: `documentExtraction.ts`'s Tika path
  // exists server-side but nothing wires it to a route or the turn
  // (COMPOSER-DOC-ATTACH-01, docs/BACKLOG.md) - a real gap, not this
  // slice's UI-composition scope.
  const imageAttachmentAdapter = useMemo(() => createLocalImageAttachmentAdapter({ capability: () => CURRENT_LOCAL_VISION_CAPABILITY }), []);
  const attachmentsAdapter = useMemo(() => new CompositeAttachmentAdapter([imageAttachmentAdapter, new SimpleTextAttachmentAdapter()]), [imageAttachmentAdapter]);
  // DICT-01: read fresh (not cached at mount) since an install can finish
  // while this page is already open - `sttInstalled` below reads
  // `sttStatusQuery.data` live on every mic click, not this render's
  // snapshot. Defaults to installed while the query is still loading
  // (a one-time, near-instant fs check) rather than flashing the
  // not-installed message on a page that hasn't heard back yet.
  const sttStatusQuery = useQuery({ queryKey: ["stt-status"], queryFn: api.sttStatus });
  // VOICE-LIVE-04: a live AnalyserNode-backed meter, present only while
  // dictation is actually recording - composerDictationWaveform.tsx's own
  // gate on rendering any bars at all.
  const [dictationLevelMeter, setDictationLevelMeter] = useState<LevelMeter | null>(null);
  const dictationAdapter = useMemo(
    () =>
      createSttDictationAdapter({
        createSocket: createSttSocket,
        turnSchedulerRef,
        sttInstalled: () => sttStatusQuery.data?.installed ?? true,
        // A stable id (a review finding): repeated mic clicks while
        // still uninstalled re-fire this every time, and without an id
        // sonner stacks a new toast per click instead of replacing the
        // one already showing.
        onNotInstalled: () => toast.error("Voice input needs a one-time download that hasn't finished on this hub yet.", { id: "stt-not-installed" }),
        // Unlike ChatPage.tsx's own dictation, no auto-send here yet -
        // the brief for this slice is "speech into the text box", not
        // the old page's own send-on-final behavior; a household member
        // reviews and sends it themselves. Real either way: the
        // transcript lands in the composer through the adapter's own
        // `onSpeech`, independent of this callback.
        onFinalReady: () => {},
        onLevelMeter: setDictationLevelMeter,
      }),
    [sttStatusQuery.data],
  );

  // A named, `use`-prefixed function, not an inline arrow - ChatPage.tsx's
  // own comment on why: `useRemoteThreadListRuntime` calls `runtimeHook`
  // from inside its own render, so react-hooks/rules-of-hooks needs the
  // naming convention to recognize this as a real hook call.
  function useChatRuntimeHook() {
    const aui = useAui();
    const chatModelAdapter = useMemo(
      () =>
        createChatModelAdapter({
          onDraftSent: () => { if (!temporaryNextRef.current) discardDraft(visibleConversationIdRef.current); },
          getConversationId: async () => {
            const { remoteId } = await aui.threadListItem().initialize();
            await settingsWriteRef.current;
            const conversation = await hydrateConversationSettings(remoteId);
            const pendingThinking = pendingNewConversationThinkingRef.current;
            if (pendingThinking !== undefined) {
              pendingNewConversationThinkingRef.current = undefined;
              // Instant is the default, so an untouched or explicitly
              // returned-to-default new thread needs no settings write.
              if (pendingThinking) {
                try {
                  await api.setConversationSettings(remoteId, { thinking: true });
                } catch {
                  toast.error("Could not save this chat's settings. Try again.");
                }
              }
            } else if (!thinkingDirtyRef.current) {
              applyConversationThinking(conversation.settings?.thinking ?? false);
            }
            const pendingReadAloud = pendingNewConversationReadAloudRef.current;
            if (pendingReadAloud !== undefined) {
              pendingNewConversationReadAloudRef.current = undefined;
              if (pendingReadAloud) queueReadAloudWrite(remoteId, true);
            }
            if (!autoReadRepliesDirtyRef.current) applyAutoReadReplies(conversation.settings?.read_aloud ?? false);
            const pendingModel = pendingNewConversationModelRef.current;
            if (pendingModel !== undefined) {
              pendingNewConversationModelRef.current = undefined;
              selectedModelDirtyRef.current = false;
              await settingsWriteRef.current;
              try {
                await api.setConversationSettings(remoteId, { model: pendingModel });
                await settingsWriteRef.current;
                applySelectedModel(pendingModel);
              } catch {
                toast.error("Could not save this chat's settings. Try again.");
              }
            } else {
              if (!selectedModelDirtyRef.current) applySelectedModel(conversation.settings?.model);
            }
            await settingsWriteRef.current;
            return remoteId;
          },
          // RESP-04's own design: "the choice... is remembered per
          // person with the conversation" - Jesse found this broken
          // live, 2026-09-22 (choosing Thinking reverted to Instant
          // right after sending). This used to reset per turn, copied
          // from ChatPage.tsx's own "Think longer" (a genuinely
          // per-message opt-in there); RESP-04's control is a mode. Its
          // current value is hydrated from the conversation settings,
          // saved by its setter, and used on every send until changed.
          getThinking: () => (thinkingAllowed ? thinkingRef.current : undefined),
          getModel: () => (modelPickerAllowedRef.current ? selectedModelRef.current : undefined),
          consumeSupersedes,
          consumePackageScope: () => {
            const value = packageScopeRef.current?.id;
            packageScopeRef.current = null;
            setPackageScope(null);
            return value;
          },
          consumeTemporary: () => {
            return temporaryNextRef.current || undefined;
          },
          // VOICE-LIVE-02: armed once, right before the live voice
          // session's own aui.composer.send() for its final transcript -
          // the single-shot shape every other per-send choice here
          // already uses.
          consumeSpoken: () => {
            const value = spokenNextRef.current || undefined;
            spokenNextRef.current = false;
            return value;
          },
          // APPROVE-CARD-01: armed once, right before ConfirmTool's own
          // respondToApproval handler calls aui.composer.send() - the
          // same single-shot shape consumeSpoken() above already uses.
          consumeAskAnswer: () => {
            const value = askAnswerRef.current;
            askAnswerRef.current = undefined;
            return value;
          },
          isBareMode: () => bareModeRef.current,
          onCrisisResources: setBanner,
          onConnection: setConnection,
          // Jesse, live-found 2026-09-27: a synchronous write_document
          // reply's own artifact card used to sit there unopened until
          // clicked - the default now is to open it, the same way a
          // background project's own live completion does (below,
          // ProjectFinishedArtifact).
          onArtifactReady,
          onSpeakingChange: (speaking) => {
            setIsSpeaking(speaking);
            if (!speaking) setSpeakingEndedAt((n) => n + 1);
          },
          turnSchedulerRef,
          // VOICE-LIVE-02: on only for the one send the live voice
          // session itself makes (liveVoiceActiveRef, set while the
          // session is open) - a typed message never speaks, unchanged
          // unless the conversation's session-local auto-read mode is
          // enabled and the TTS role is ready.
          speakReplies: () => liveVoiceActiveRef.current || (ttsAvailableRef.current && autoReadRepliesRef.current),
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
    // DICT-01: an empty deps array here used to be harmless only because
    // every adapter was itself already stably memoized forever - true of
    // `attachmentsAdapter`, no longer true of `dictationAdapter` once it
    // started reacting to `sttStatusQuery.data` (a query that has not
    // resolved yet on the render this whole tree first mounts on). A
    // real bug caught building this row's own test: with `[]` here, the
    // runtime keeps the FIRST `dictationAdapter` forever - the one built
    // before the STT status query ever answered - so `sttInstalled()`'s
    // permissive "assume installed while loading" default became
    // permanent for the rest of the page's life, not just the loading
    // window it was meant to cover.
    const adapters = useMemo(
      () => ({
        feedback: createChatFeedbackAdapter(),
        ...(ttsAvailable ? { speech: createChatSpeechAdapter() } : {}),
        attachments: attachmentsAdapter,
        dictation: dictationAdapter,
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps -- the rule's own static analysis can't see that dictationAdapter's *own* useMemo deps (sttStatusQuery.data) genuinely change across renders, and calls the dependencies "unnecessary" on that mistaken belief; removing them is exactly the bug named above, verified live by NextChatPage.test.tsx's DICT-01 describe block. The `ttsAvailable` dependency is also essential: it adds/removes the speech adapter so the shipped Speak action follows real TTS readiness.
      [attachmentsAdapter, dictationAdapter, ttsAvailable],
    );
    return useLocalRuntime(chatModelAdapter, { adapters });
  }

  // `onThreadIdChange` fires for two different reasons: a deliberate
  // switch (New Thread, picking a past conversation) AND a brand-new
  // conversation's own placeholder id resolving to the real one
  // `getConversationId` mints on its first send - found live fixing
  // RESP-04 (a test sending a first message in a fresh conversation
  // reset Thinking right back to Instant, the exact defect being
  // fixed, because this fired with no deliberate switch at all).
  // Tracked separately from `searchParams` so the very first
  // `undefined -> real id` transition (this conversation's own) never
  // reads as a switch away from it - a real switch AWAY from a real
  // conversation (any id, including New Thread's own `undefined`)
  // still resets right here, at the transition that leaves it, so a
  // later transition INTO the next conversation has nothing left to
  // reset: Thinking is already Instant by the time New Thread's own
  // `onThreadIdChange(undefined)` finishes, whatever gets picked next.
  // A review raised exactly this as a counter-example ("New Thread,
  // then pick a different existing conversation with nothing sent" -
  // both transitions start from `undefined`, so how does the second
  // tell them apart?) - it doesn't need to, since the first transition
  // (leaving the real conversation Thinking was set in) already reset
  // it. Verified by hand against a real sequence, not just reasoned
  // through: a version of this scenario as its own test passed
  // reliably alone but timed out intermittently only under the full
  // suite (a `bun test` process-wide flake this addition surfaced, not
  // a production bug - GATE-SPEED-02(b) territory), so it isn't kept
  // as a permanent test; the one below it (the reported defect itself)
  // is the regression test that stays.
  const runtime = useRemoteThreadListRuntime({
    runtimeHook: useChatRuntimeHook,
    adapter: threadListAdapter,
    threadId: searchParams.get("conversation") ?? undefined,
    onThreadIdChange: (id) => {
      if (id === undefined) {
        deselectedConversationIdRef.current = visibleConversationIdRef.current;
        visibleConversationIdRef.current = undefined;
        setDraftConversationId(undefined);
      } else {
        visibleConversationIdRef.current = id;
        setDraftConversationId(id);
        deselectedConversationIdRef.current = undefined;
      }
      setSearchParams(id ? { conversation: id } : {}, { replace: true });
      closeSheet();
      const isDeliberateSwitch = previousThreadIdRef.current !== undefined && id !== previousThreadIdRef.current;
      previousThreadIdRef.current = id;
      const pendingReadAloud = pendingNewConversationReadAloudRef.current;
      if (id && pendingReadAloud !== undefined && !isDeliberateSwitch) {
        pendingNewConversationReadAloudRef.current = undefined;
        if (pendingReadAloud) {
          queueReadAloudWrite(id, true);
        }
      }
      // A different conversation is a different investigation - bare
      // mode never silently follows the switch. (Left as the
      // unconditional reset it already was - this row's own fix is
      // scoped to the reported Thinking defect below, not a second,
      // unasked-for change to bareMode's own behavior.)
      setBareMode(false);
      // Thinking and model are hydrated from each conversation's
      // persisted settings.
      if (isDeliberateSwitch) {
        thinkingRef.current = false;
        setThinkingState(false);
        thinkingDirtyRef.current = false;
        pendingNewConversationThinkingRef.current = undefined;
        autoReadRepliesDirtyRef.current = false;
        selectedModelDirtyRef.current = false;
        pendingNewConversationReadAloudRef.current = undefined;
        pendingNewConversationModelRef.current = undefined;
        applyAutoReadReplies(false);
        applySelectedModel(undefined);
      }
      if (id) void hydrateConversationSettings(id).catch(() => {});
    },
  });

  return { runtime, banner, connection, setConnection, thinking, setThinking, thinkingAllowed, modelOptions, selectedModelValue, setSelectedModel, modelPickerAllowed, bareMode, setBareMode, autoReadReplies, setAutoReadReplies: setConversationAutoReadReplies, ttsAvailable, packageScope, setPackageScope, temporaryNext, turnSchedulerRef, liveVoiceActiveRef, spokenNextRef, askAnswerRef, isSpeaking, speakingEndedAt, dictationLevelMeter };
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

/** c-99f5: the tab's own title for this page - the open conversation's
 * title instead of a flat "Chat", so a tab opened on a past conversation
 * names that conversation. `s.threadListItem` is the threads scope's main
 * (open) item - read globally from the runtime state, no list-item context
 * needed - so this sits beside ArtifactCacheInvalidator's own side-effect
 * mount inside the provider. Falls back to "Chat" while no conversation is
 * open yet, and re-renders on thread switch and rename alike (the rename
 * path re-sets the item's own title through the adapter). */
function ChatDocumentTitle() {
  const title = useAuiState((s) => s.threadListItem.title) ?? "Chat";
  useDocumentTitle(title);
  return null;
}

/** CHAT-HEADER-01: the bridge chatHeaderData.tsx's own header comment
 * describes - reads the real runtime state ChatHeaderBar (rendered as
 * Header's own child, outside this provider) can't reach directly, and
 * pushes it into the data context. Same side-effect-mount shape as
 * ArtifactCacheInvalidator/ChatDocumentTitle above, just carrying data
 * instead of a DOM/browser-API side effect. */
function ChatHeaderDataBridge({ autoReadReplies, setAutoReadReplies, ttsAvailable }: {
  autoReadReplies: boolean;
  setAutoReadReplies: (enabled: boolean) => void;
  ttsAvailable: boolean;
}) {
  const aui = useAui();
  const title = useAuiState((s) => s.threadListItem.title) ?? "";
  useEffect(() => {
    const reloadThreads = () => void aui.threads.reload();
    window.addEventListener(INCOGNITO_DISCARDED_EVENT, reloadThreads);
    return () => window.removeEventListener(INCOGNITO_DISCARDED_EVENT, reloadThreads);
  }, [aui]);
  useSetChatHeaderData({
    title,
    ttsAvailable,
    autoReadReplies,
    onAutoReadRepliesChange: setAutoReadReplies,
    // A code review caught this: the vendored thread-list.aui.tsx's own
    // rename/delete already toast on failure (`toast.error("Could not
    // rename/delete this chat. Try again.")`) - this header's own
    // actions are the same operations on the same runtime and need the
    // same feedback, not a silent no-op the person has no way to notice.
    onRename: async (next) => {
      try {
        await aui.threadListItem.rename(next);
      } catch (error) {
        toast.error("Could not rename this chat. Try again.");
        throw error;
      }
    },
    onDelete: async () => {
      try {
        await aui.threadListItem.delete();
      } catch {
        toast.error("Could not delete this chat. Try again.");
        return;
      }
      // The deleted conversation was the one open in this very header -
      // the thread list's own row delete never needs this (a person
      // deletes a DIFFERENT row than the one they're reading), but here
      // the active conversation just stopped existing, so this moves
      // off it deliberately rather than leaving whatever the runtime
      // happens to fall back to.
      await aui.threads.switchToNewThread();
    },
  });
  return null;
}

/** getmaipai/home#181: a finished background project's document attaches
 * to the SAME turn row that already produced its "Starting…" reply
 * (backend/src/lib/projects/post.ts's postProjectResult()) - no new
 * message, no new turn row, so nothing already loaded ever refetches to
 * show it without a hard refresh. NotificationBell.tsx already polls
 * `project.done`/`project.failed` deliveries every 15s
 * (NOTIFICATIONS_QUERY_KEY); this is the one place that turns "a
 * delivery arrived" into "the open thread refetches," reusing that same
 * query (React Query dedupes the identical queryKey to one fetch/poll,
 * that file's own header comment) rather than standing up a second poll.
 * Matched by turn id against the messages already on screen
 * (`metadata.custom.turnId`, the same field chatActionBar.tsx already
 * reads off a message) rather than by conversation id - a notification
 * carries a `subjectTurnId`, never a conversationId, and every turn in
 * the currently open thread is already loaded right here, so a
 * notification whose turn isn't among them belongs to some OTHER
 * conversation and is left alone. Mounted beside ArtifactCacheInvalidator/
 * ChatDocumentTitle above - same provider scope, same "no thread-id
 * bookkeeping needed" posture. `reloadMainThread()` (@assistant-ui/core's
 * own "refetch the open thread's remote state for state that changed out
 * of band" method) reruns chatHistoryAdapter.ts's load() for the one
 * thread on screen - the incognito-discard listener below calls
 * `threads.reload()` instead, which refreshes the thread LIST, not this
 * thread's own messages, so it doesn't do the job here. */
function ProjectResultReload() {
  const aui = useAui();
  const messages = useAuiState((s) => s.thread.messages);
  const openArtifact = useContext(ArtifactOpenContext);
  // The open conversation's own id - a switch away and back re-scopes
  // `seen` below (a code review, 2026-09-27: a bare module-lifetime set
  // would leave a notification marked "seen" while a DIFFERENT thread
  // was open, permanently masking it if its own thread later became the
  // one on screen; in practice `switchToThread()` already does a full
  // fresh history load on its own, so this is defense in depth, not the
  // only thing standing between a switch and a stale card).
  const remoteId = useAuiState((s) => s.threadListItem.remoteId);
  const { data: notifications } = useNotificationsQuery();
  // Everything already pending the first time this runs for a given
  // thread predates that (a page opened, or switched to this thread,
  // after the project already finished) - not a fresh arrival worth
  // reloading for, the same "no flood on first load" guard
  // NotificationBell.tsx's own NotificationToaster uses for its seenIds.
  const seen = useRef<{ remoteId: string | undefined; ids: Set<string> } | null>(null);
  // A code review caught this (2026-09-27): ProjectFinishedArtifact's
  // own auto-open (its useEffect, above) only ever fires through the
  // LIVE in-thread poll (ProjectToolRender still mounted, actively
  // watching) - exactly the case this component's own reload does NOT
  // exist for. The whole reason a background project needs this
  // notification-driven reload at all is the case where nobody was
  // watching (the poll gave up at PROJECT_SETTLED_ARTIFACT_POLL_LIMIT,
  // or the thread wasn't even open) - reload turns that project's row
  // into a plain `write_document` part (chatHistoryAdapter.ts's #182
  // rule), which `ArtifactCardToolRender` renders with no auto-open of
  // its own (unlike a synchronous write, that one's "was this genuinely
  // just created" signal isn't available at render time - see
  // chatModelAdapter.ts's own `onArtifactReady` comment). So the turn id
  // a genuinely fresh notification just confirmed is the ONE case
  // where "this artifact is new, not historical" is trustworthy here
  // too - remembered until its own artifact shows up in the reloaded
  // `messages`, then opened the same way. A Set, not a single id (a
  // code review's own finding): two projects finishing inside the same
  // notification poll tick each add their own turn here, and each is
  // opened (and removed) independently as its own artifact shows up -
  // a single overwritable ref would have silently dropped every match
  // but the last one iterated. `project.failed` lands here too, on
  // purpose: postProjectResult() posts a real artifact (a failure
  // summary) for a failed project exactly the same way it does for a
  // finished one, never leaving a failed turn's own id stuck pending.
  const pendingOpenTurnIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Every pending turn from an earlier pass, now present in the
    // reloaded messages with a real artifact - open it and stop
    // waiting on it. Checked on every `messages` change (including the
    // one the reload below itself causes), not a second effect: this
    // is the only signal that the reload has actually landed.
    for (const turnId of pendingOpenTurnIds.current) {
      // `role === "assistant"`, not just a turnId match: a row's own
      // USER half carries the identical `metadata.custom.turnId`
      // (rowsToBranchableMessages's own construction gives both halves
      // of one row the same turnId), and `messages` lists the user
      // message before its own reply - a bare turnId match found that
      // one first, every single time, and it never carries an artifact.
      const message = messages.find((m) => m.role === "assistant" && (m.metadata?.custom?.turnId as string | undefined) === turnId);
      const artifactPart = toolCallPartFromMessage(message, "write_document");
      const result = artifactPart?.result as { id: string } | undefined;
      if (result) {
        openArtifact(result.id);
        pendingOpenTurnIds.current.delete(turnId);
      }
    }
    // Array.isArray, not just a truthiness check: a test (or a real
    // deploy) whose fetch stub/proxy never anticipated this query can
    // hand back something else entirely (`{}`, an error body) before a
    // real GET /api/notifications response replaces it - this component
    // is now mounted on every chat page, most of which never stub that
    // endpoint at all, so treating anything non-array as "nothing to
    // process yet" (an unguarded `.map` here crashed every NextChatPage
    // test that never stubbed /api/notifications, not just this file's
    // own new ones, once this component started mounting everywhere).
    if (!Array.isArray(notifications)) return;
    if (seen.current === null || seen.current.remoteId !== remoteId) {
      seen.current = { remoteId, ids: new Set(notifications.map((n) => n.id)) };
      return;
    }
    // Every unseen notification is marked seen in this same pass,
    // matching or not - a code review, 2026-09-27, caught an earlier
    // version that `break`d out the moment one matched, which left every
    // notification AFTER it in the array still unmarked and so
    // re-examined (and, if it also matched, re-triggering its own
    // reload) on every later effect run until it happened to come first.
    // One reload already refetches every turn in this thread, so at most
    // one call goes out per pass regardless of how many notifications
    // matched. A code review's own finding (2026-09-27): when the thread
    // is open live, ProjectFinishedArtifact's own mount effect already
    // fired a reload for this exact project the moment its own poll saw
    // it finish (its own comment on why); this notification, arriving
    // later for the identical event, can trigger a second one here with
    // no way for either side to know the other already ran. Left as is
    // on purpose - both calls are individually idempotent and
    // error-swallowed, so the cost is one redundant refetch, never a
    // wrong result, and the alternative (some shared "already reloaded
    // this project" state between two otherwise-unrelated component
    // instances) is real complexity for a network call that was already
    // going to happen eventually for the "nobody was watching" case this
    // component exists for.
    let shouldReload = false;
    for (const n of notifications) {
      if (seen.current.ids.has(n.id)) continue;
      seen.current.ids.add(n.id);
      if (n.typeId !== "project.done" && n.typeId !== "project.failed") continue;
      if (!n.subjectTurnId) continue;
      const subjectTurnId = n.subjectTurnId;
      if (messages.some((m) => (m.metadata?.custom?.turnId as string | undefined) === subjectTurnId)) {
        shouldReload = true;
        pendingOpenTurnIds.current.add(subjectTurnId);
      }
    }
    if (shouldReload) void aui.threads.reloadMainThread();
  }, [notifications, messages, remoteId, aui, openArtifact]);

  return null;
}

export function NextChatPage({ person }: { person: Roster }) {
  const [draftConversationId, setDraftConversationId] = useState<string | undefined>(() => new URLSearchParams(window.location.search).get("conversation") ?? undefined);
  const chatAvailability = useChatAvailability();
  // CHAT-HEADER-01: ChatHeaderBar is a stable, zero-prop reference - the
  // shell header's own slot (ui-v0.5.35) mounts and unmounts it, never
  // re-created per render.
  useHeaderExtra(ChatHeaderBar);
  const { on: temporaryNext } = useIncognitoContext();
  // VOICE-LIVE-02: owned here (not inside useNextChatRuntime) since both
  // the composer's own waveform button (via VoiceSessionProvider,
  // composerVoiceControls.tsx's zero-prop slot needs a context to reach
  // it) and LiveVoiceSession itself (a direct prop, mounted below) read
  // the identical state.
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [openArtifactId, setOpenArtifactId] = useState<string | null>(null);
  // Jesse's own standing rule (2026-09-27): every expand/collapse
  // surface animates open and closed, never snaps - the desktop canvas
  // div below used to be a bare `{condition ? <div/> : null}` mount with
  // no transition at all. `lastCanvasArtifactId` keeps the most recently
  // opened id around through the CLOSING transition (React would
  // otherwise unmount `ArtifactCanvasPanel` the instant `openArtifactId`
  // clears, before the width transition below ever gets to play) - it
  // only ever updates to a real id, never back to null, so the panel's
  // own content stays exactly what it was showing while it slides shut.
  const [lastCanvasArtifactId, setLastCanvasArtifactId] = useState<string | null>(null);
  useEffect(() => {
    if (openArtifactId !== null) setLastCanvasArtifactId(openArtifactId);
  }, [openArtifactId]);
  // A code review caught the real gap this backstop closes: the
  // wrapper's own `onTransitionEnd` (below) is the normal way
  // `lastCanvasArtifactId` gets cleared back to null once the closing
  // width transition genuinely finishes, but a transition that never
  // fires - `motion-reduce:transition-none` drops it entirely, and this
  // session's own tab-backgrounding discovery tonight (`document.hidden`
  // suspends animation/transition timelines, the same class of bug the
  // rail's own `RAIL_WIDTH_ANIMATION_BACKSTOP_MS` was hardened against
  // above) - would leave it stuck at a real id forever, keeping
  // `ArtifactCanvasPanel` and its own `useQuery` mounted for the rest of
  // the session after the first artifact ever closed. A plain
  // `setTimeout`, padded past the real ~300ms transition so it never
  // wins that race in the normal foregrounded case; the effect's own
  // cleanup (re-run whenever `openArtifactId` changes) is what cancels a
  // stale timer if a NEW artifact opens again before the old one's timer
  // fires - React re-running this effect on that dependency change is
  // the ordinary mechanism, not a manual check needed at fire time.
  // Named, not inlined, matching the rail's own `RAIL_WIDTH_ANIMATION_
  // BACKSTOP_MS` this comment cites as its precedent - a code review
  // caught the first cut using a bare `500` instead. Bumped to 750
  // alongside the rail's own backstop when the underlying transition
  // slowed from 200ms to 300ms (2026-09-27), keeping the same margin.
  const CANVAS_CLOSE_BACKSTOP_MS = 750;
  useEffect(() => {
    if (openArtifactId !== null) return;
    const timeout = setTimeout(() => setLastCanvasArtifactId(null), CANVAS_CLOSE_BACKSTOP_MS);
    return () => clearTimeout(timeout);
  }, [openArtifactId]);
  // CANVAS-SHEET-DESKTOP-01 (fixes #183): the desktop canvas div below
  // (`hidden lg:block`) and the phone/tablet artifact Sheet used to both
  // bind their render to the same `openArtifactId !== null` state
  // unconditionally - only the Sheet's own CONTENT was `lg:hidden`, so
  // on desktop the Sheet still mounted and opened with invisible content
  // but a full, real overlay (`SheetOverlay` has no responsive class of
  // its own), which dimmed the page; worse, Radix computes "outside
  // click" against that same zero-footprint content, so any click on
  // the real desktop canvas next to it read as "outside the Sheet" and
  // closed everything. Gating on the same `lg` (1024px) boundary the
  // classNames already use, via the kit's own `useBreakpoint` (already
  // used the same way by `chatDocumentPane.tsx`), keeps the two
  // surfaces mutually exclusive: the Sheet is never actually open at
  // desktop width, so there is no overlay and no outside-click handler
  // to misfire.
  const isDesktopCanvas = useBreakpoint().atLeast(1024);
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
  // CHAT-FIND-0923-01: a deliberate click on the toggle is a real
  // preference, not a one-time layout default - the stored value (once
  // a person has ever clicked it) wins over the width-based default
  // below, the same way `readMicDevicePreference()` already wins over
  // "no preference." `null` (never clicked, or storage blocked) falls
  // through to the existing matchMedia default unchanged.
  const [railCollapsed, setRailCollapsed] = useState(() => {
    const stored = readRailCollapsePreference();
    if (stored !== null) return stored;
    return typeof window !== "undefined" && window.matchMedia(`(max-width: ${RAIL_AUTO_COLLAPSE_MAX_WIDTH}px)`).matches;
  });
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
  const { runtime, banner, connection, setConnection, thinking, setThinking, modelOptions, selectedModelValue, setSelectedModel, modelPickerAllowed, bareMode, setBareMode, autoReadReplies, setAutoReadReplies, ttsAvailable, packageScope, setPackageScope, turnSchedulerRef, liveVoiceActiveRef, spokenNextRef, askAnswerRef, isSpeaking, speakingEndedAt, dictationLevelMeter } = useNextChatRuntime(person, () => {
    setSheetOpen(false);
    setRailPeeked(false);
    setOpenArtifactId(null);
    setCompareTarget(null);
  }, temporaryNext, setOpenArtifactId, setDraftConversationId);
  const thinkingModeValue = useMemo(
    () => ({
      mode: (thinking ? "thinking" : "instant") as "instant" | "thinking",
      setMode: (mode: "instant" | "thinking") => setThinking(mode === "thinking"),
    }),
    [thinking, setThinking],
  );
  const modelPickerValue = useMemo(() => ({ models: modelOptions, value: selectedModelValue, setValue: setSelectedModel }), [modelOptions, selectedModelValue, setSelectedModel]);
  const bareModeValue = useMemo(() => ({ on: bareMode, toggle: () => setBareMode((value) => !value) }), [bareMode, setBareMode]);
  const packageScopeValue = useMemo(() => ({ scope: packageScope, setScope: setPackageScope }), [packageScope, setPackageScope]);
  const temporaryChatValue = useMemo(() => ({ on: temporaryNext }), [temporaryNext]);
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
  // animation's own 300ms). Only a real click should ever ease the
  // width; hover opening or closing the peek must jump instantly. The
  // transition classes now ride this flag instead of the base string,
  // true only across a click-driven width change - `cn()` drops a
  // falsy entry, so when it's false the transition property is
  // genuinely absent from the rail's className, not merely overridden.
  // Must match the rail's own `duration-300` Tailwind class in its
  // className below - Tailwind's JIT needs that class as a literal
  // string there, so this can't be interpolated in; a change to one
  // needs the other updated by hand. Jesse found the original 200ms
  // linear timing too fast to read as a real slide, both here and on
  // the canvas wrapper below (2026-09-27) - 300ms with `ease-out` (a
  // standard scale step and a standard easing keyword, no arbitrary
  // value needed for either) reads as a deliberate motion instead of a
  // snap, matching ChatGPT's own panel feel.
  const RAIL_WIDTH_TRANSITION_MS = 300;
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
  // past the transition's real ~300ms so it never wins the race in the
  // normal foregrounded case.
  const RAIL_WIDTH_ANIMATION_BACKSTOP_MS = 900;
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
      writeRailCollapsePreference(false);
    } else {
      setRailCollapsed(true);
      writeRailCollapsePreference(true);
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
          {/* A review caught this: this instance stays mounted even
              truly collapsed (it's `NextThreadList`'s own
              `collapseToggle` prop, always passed - the "collapsed:
              the rail is hidden and out of flow" test above proves the
              node itself survives, CSS-hidden/`inert`, exactly so
              `aria-controls` stays valid). Only ever VISIBLE when open
              or peeked, never truly collapsed - the icon that reads as
              "click to close." */}
          <RailCloseIcon className="size-4" />
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
          // eslint-disable-next-line shadcn/no-restyle -- positioning classes for the rail toggle button are intentional layout, not restyling of the button's own shape
          className="absolute top-0 left-0 z-20 hidden lg:flex"
          onPointerEnter={handleToggleEnter}
          onPointerLeave={handleToggleLeave}
          onFocus={handleToggleFocus}
          onClick={handleToggleClick}
        >
          {/* This instance only ever renders truly collapsed (never
              peeked) - the icon that reads as "click to open." */}
          <RailOpenIcon className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Conversations</TooltipContent>
    </Tooltip>
  );

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatAvailabilityContext.Provider value={chatAvailability}>
      <ArtifactOpenContext.Provider value={setOpenArtifactId}>
      <ReloadMainThreadProvider>
      <ConfirmAskAnswerProvider askAnswerRef={askAnswerRef}>
      <AdminContext.Provider value={isOwnerOrAdminRole(person.role)}>
      <CompareOpenContext.Provider value={setCompareTarget}>
      <SourcesOpenContext.Provider value={sourcesOpenValue}>
      <DetailsOpenContext.Provider value={detailsOpenValue}>
      <ThinkingModeContext.Provider value={thinkingModeValue}>
      <ModelPickerContext.Provider value={modelPickerValue}>
      <BareModeContext.Provider value={bareModeValue}>
      <TemporaryChatContext.Provider value={temporaryChatValue}>
      <DraftConversationContext.Provider value={draftConversationId}>
      <PackageScopeContext.Provider value={packageScopeValue}>
      <VoiceSessionProvider value={{ open: voiceOpen, setOpen: setVoiceOpen }}>
      <WakeWordPersonContext.Provider value={person}>
      <DictationLevelMeterProvider value={dictationLevelMeter}>
        <ChatShortcutReference />
        <WakeWordController person={person} />
        <ArtifactCacheInvalidator />
        <ChatDocumentTitle />
        <ChatHeaderDataBridge autoReadReplies={autoReadReplies} setAutoReadReplies={setAutoReadReplies} ttsAvailable={ttsAvailable} />
        <ProjectResultReload />
        <LiveVoiceSession
          open={voiceOpen}
          onOpenChange={setVoiceOpen}
          turnSchedulerRef={turnSchedulerRef}
          liveVoiceActiveRef={liveVoiceActiveRef}
          spokenNextRef={spokenNextRef}
          isSpeaking={isSpeaking}
          speakingEndedAt={speakingEndedAt}
        />
        <h1 className="sr-only">Chat</h1>
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
            <ChatHeaderBar phoneRow />
          </div>
          {bareMode ? (
            // COORDINATOR, 2026-09-22: "while it is on, it is obvious...
            // a persistent visible marker on the conversation for as
            // long as bare mode is active, not a toast." No dismiss
            // control - the switch itself is the only way off, the same
            // way the wake-word invariants treat a mode that changes
            // behavior.
            <Alert variant="destructive" className="mx-4 mt-2 mb-2" role="status">
              <CompareIcon className="size-4" />
              <AlertTitle>Bare mode is on</AlertTitle>
              <AlertDescription>Every reply in this conversation is the bare model - no persona, routing, packages, or quality guards.</AlertDescription>
            </Alert>
          ) : null}
          {chatAvailability === "unavailable" ? (
            <Alert variant="destructive" className="mx-4 mt-2 mb-2" role="status">
              <AlertTitle>MaiPai's AI isn't running right now</AlertTitle>
              <AlertDescription>
                You can't send messages until it's back.{" "}
                {isOwnerOrAdminRole(person.role) ? <Link to="/repairs" className="inline-flex min-h-12 items-center">Open Repairs to see what's wrong.</Link> : null}
              </AlertDescription>
            </Alert>
          ) : null}
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
              data-slot="next-chat-rail"
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
                // eslint-disable-next-line shadcn/no-arbitrary-values -- transition-[width] is the only way to animate a dynamic rail width
                railWidthAnimating && "transition-[width] duration-300 ease-out motion-reduce:transition-none",
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
              <NextThreadList
                onNewThread={() => { setSheetOpen(false); setRailPeeked(false); }}
                collapseToggle={inlineToggle}
              />
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
                // eslint-disable-next-line shadcn/no-arbitrary-values -- transition-[margin-inline-start] is the only way to animate the pane's margin as the rail collapses
                "min-w-0 flex-1 transition-[margin-inline-start] duration-300 ease-out motion-reduce:transition-none",
                railCollapsed ? "ms-0" : "ms-4",
              )}
            >
              <ConnectionStateContext.Provider value={{ ...connection, setConnection }}>
                <ChatThread
                  temporary={temporaryNext}
                  onEditSend={(_messageId, turnId) => setPendingSupersedes(turnId ?? null)}
                  modelPickerAllowed={modelPickerAllowed}
                />
              </ConnectionStateContext.Provider>
            </div>
            {isDesktopCanvas ? (
              // Desktop only - the phone/tablet Sheet below covers the
              // same panel under `lg:hidden`, mirroring
              // chatDocumentPane.tsx's own split. Gated on
              // `isDesktopCanvas` too (CANVAS-SHEET-DESKTOP-01, fixes
              // #183), not just the CSS, so the Sheet below never
              // mounts open at the same time this does - and the
              // wrapper's own `hidden lg:block` (below) is the matching
              // CSS-level backstop #183 established for exactly this
              // pairing, kept here too: a code review caught the first
              // cut of this animation dropping it, leaving nothing to
              // hide the panel below `lg` if `isDesktopCanvas` (a JS
              // `matchMedia` read) were ever momentarily stale relative
              // to the real viewport during a resize.
              //
              // Jesse's own standing rule (2026-09-27): this used to be
              // a bare `{openArtifactId !== null ? <div/> : null}` mount
              // - no transition at all, an instant snap open and closed.
              // Always mounted here instead (while on desktop), width
              // animated between `w-0` and its open width the same way
              // this file's own rail already animates its collapse
              // (`transition-[width] duration-300 ease-out
              // motion-reduce:transition-none` - bumped from the
              // original 200ms/linear together with the rail, Jesse
              // found both too fast to read as a real slide,
              // 2026-09-27) - `overflow-hidden` clips the sliding
              // content on the way in and out.
              // `lastCanvasArtifactId` (declared above, next to
              // `openArtifactId`) keeps rendering the panel's own last
              // real content through the CLOSING transition, since
              // React would otherwise unmount `ArtifactCanvasPanel` the
              // instant `openArtifactId` clears, before the width
              // transition ever gets to play. A code review caught the
              // first cut never clearing it back to null once that
              // transition actually finishes - `ArtifactCanvasPanel`
              // (and its own `useQuery` for the artifact) would have
              // stayed mounted for the rest of the session after the
              // FIRST artifact ever opened, not just through one closing
              // animation. `onTransitionEnd` (the rail's own collapse
              // animation above uses the identical pattern) is the real
              // "the animation is actually done now" signal - only
              // clearing when it fires for THIS element's own `width`
              // property while closed (not `openArtifactId !== null`,
              // which would also fire and immediately unmount on OPEN).
              <div
                data-slot="desktop-canvas-wrapper"
                className={cn(
                  // eslint-disable-next-line shadcn/no-arbitrary-values -- transition-[width] is the only way to animate this panel's own dynamic width, the same rule the rail's own collapse animation above is already exempted for
                  "hidden shrink-0 overflow-hidden transition-[width] duration-300 ease-out motion-reduce:transition-none lg:block",
                  openArtifactId !== null ? "w-full max-w-xl" : "w-0",
                )}
                onTransitionEnd={(e) => {
                  if (e.target === e.currentTarget && e.propertyName === "width" && openArtifactId === null) setLastCanvasArtifactId(null);
                }}
              >
                {lastCanvasArtifactId !== null ? <ArtifactCanvasPanel artifactId={lastCanvasArtifactId} onClose={closeArtifact} /> : null}
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
          {/* eslint-disable-next-line shadcn/no-restyle, shadcn/no-arbitrary-values -- sheet width and responsive visibility are intentional layout for the mobile thread list; max-w-[calc(100vw-2rem)] has no scale-token equivalent since Sheet has no max-width prop of its own (commons/ui/docs/dashboard-upstream.md) */}
          <SheetContent id="next-chat-threads" side="left" className="w-80 max-w-[calc(100vw-2rem)] gap-0 p-2 lg:hidden">
            {/* eslint-disable-next-line shadcn/no-restyle -- sr-only hides the header visually while keeping it accessible */}
            <SheetHeader className="sr-only">
              <SheetTitle>Conversations</SheetTitle>
              <SheetDescription>Past conversations</SheetDescription>
            </SheetHeader>
            {threadList}
          </SheetContent>
        </Sheet>
        {/* CANVAS-SHEET-DESKTOP-01 (fixes #183): `open` is gated on
            `!isDesktopCanvas` too, not just `openArtifactId !== null` -
            otherwise this Sheet mounts and opens at desktop width as
            well as the plain div above, and its always-on-when-open
            `SheetOverlay` dims the page while Radix's outside-click
            check (computed against this Sheet's own CSS-hidden,
            zero-footprint content) fires on every click, including one
            inside the real desktop canvas next to it. */}
        <Sheet open={!isDesktopCanvas && openArtifactId !== null} onOpenChange={(next) => { if (!next) closeArtifact(); }}>
          {/* eslint-disable-next-line shadcn/no-restyle, shadcn/no-arbitrary-values -- max-height and scroll are intentional for the mobile artifact sheet; max-h-[85vh] has no scale-token equivalent since Sheet has no max-height prop of its own (commons/ui/docs/dashboard-upstream.md) */}
          <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto lg:hidden">
            {/* eslint-disable-next-line shadcn/no-restyle -- sr-only hides the header visually while keeping it accessible */}
            <SheetHeader className="sr-only">
              <SheetTitle>Document</SheetTitle>
              <SheetDescription>The document from this reply</SheetDescription>
            </SheetHeader>
            {!isDesktopCanvas && openArtifactId !== null ? <ArtifactCanvasPanel artifactId={openArtifactId} onClose={closeArtifact} /> : null}
          </SheetContent>
        </Sheet>
        <Sheet open={compareTarget !== null} onOpenChange={(next) => { if (!next) closeCompare(); }}>
          {/* eslint-disable-next-line shadcn/no-restyle, shadcn/no-arbitrary-values -- max-height and scroll are intentional for the mobile compare sheet; max-h-[85vh] has no scale-token equivalent since Sheet has no max-height prop of its own (commons/ui/docs/dashboard-upstream.md) */}
          <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto lg:hidden">
            {/* eslint-disable-next-line shadcn/no-restyle -- sr-only hides the header visually while keeping it accessible */}
            <SheetHeader className="sr-only">
              <SheetTitle>Compare with the bare model</SheetTitle>
              <SheetDescription>Our reply beside the same model with no routing, packages, persona or guards</SheetDescription>
            </SheetHeader>
            {compareTarget !== null ? <BareCompareCanvasPanel target={compareTarget} onClose={closeCompare} /> : null}
          </SheetContent>
        </Sheet>
      </DictationLevelMeterProvider>
      </WakeWordPersonContext.Provider>
      </VoiceSessionProvider>
      </PackageScopeContext.Provider>
      </DraftConversationContext.Provider>
      </TemporaryChatContext.Provider>
      </BareModeContext.Provider>
      </ModelPickerContext.Provider>
      </ThinkingModeContext.Provider>
      </DetailsOpenContext.Provider>
      </SourcesOpenContext.Provider>
      </CompareOpenContext.Provider>
      </AdminContext.Provider>
      </ConfirmAskAnswerProvider>
      </ReloadMainThreadProvider>
      </ArtifactOpenContext.Provider>
      </ChatAvailabilityContext.Provider>
    </AssistantRuntimeProvider>
  );
}
