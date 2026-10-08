import { lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import { Link, useMatch, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AssistantRuntimeProvider, useAui, useAuiState, useLocalRuntime, useRemoteThreadListRuntime } from "@assistant-ui/react";
import { ChatThread } from "@/apps/chat/ChatThread";
import { PageContext } from "@/shell/pages/chatProjectPageContext";
import type { ThreadListProjects } from "@maipai/ui/src/elements/thread-list.aui";
import { ThreadListSidebar } from "@maipai/ui/src/elements/thread-list-sidebar.aui";
import { ThreadSearch } from "@maipai/ui/src/elements/thread-search";
import type { ProjectSettingsValue } from "@maipai/ui/src/elements/project-settings";
import { MarkdownDocument } from "@/shell/pages/MarkdownDocument";
// APPROVE-CARD-02: the confirm ask uses the kit ApprovalCard renderer
// registered in elementBindings.ts; this page supplies its lifted answer
// callback through ConfirmAskAnswerProvider below.
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
import { Dialog, DialogContent } from "@maipai/ui/src/ui/dialog";
import { VoiceConversation } from "@maipai/ui/src/elements/voice-conversation";
import { TooltipIconButton } from "@maipai/ui/src/elements/tooltip-icon-button";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { useBreakpoint } from "@maipai/ui/src/hooks/useBreakpoint";
import { getIcon } from "@maipai/ui/src/icons";
import { cn } from "@maipai/ui/src/utils";
import { api, ApiError, isOwnerOrAdminRole, canHaveTemporaryChatRole, readBareCompareStream, type BareCompareTrace, type ChatModelsResponse, type EnginesOverview, type InstalledPackage, type Roster } from "@/lib/api";
import { CHAT_CAPABILITIES_QUERY_KEY, chatCapabilitiesFrom, modelThinks, NO_CHAT_PICTURES } from "@/apps/chat/visionCapability";
import type { Conversation } from "@maipai/spec/gen/ts/conversation.js";
import { createChatModelAdapter } from "@/apps/chat/chatModelAdapter";
import { consumeSupersedes, setPendingSupersedes } from "@/apps/chat/chatEditSupersedes";
import { createChatThreadListAdapter, needsTitleCatchUp, resumeClosedConversation, setPendingChatFolder } from "@/apps/chat/chatThreadListAdapter";
import { clearSubmittedFeedback, createChatFeedbackAdapter } from "@/apps/chat/chatActionBar";
import { ChatActorContext } from "@/apps/chat/chatMemoryActions";
import { useMemoryStatusPoll } from "@/apps/chat/chatMemoryState";
import { createChatSpeechAdapter } from "@/apps/chat/chatSpeechAdapter";
import { createChatSuggestionAdapter } from "@/apps/chat/chatSuggestionAdapter";
import { PackageScopeContext, PhotoUploadsContext } from "@/apps/chat/composerAddMenu";
import "@/shell/pages/chatTouchTargets.css";
import "@/shell/pages/chatReplyMarkdown.css";
import { WakeWordController } from "@/apps/chat/WakeWordController";
import { useSetChatHeaderData } from "@/apps/chat/chatHeaderData";
import { ChatHeaderBar } from "@/apps/chat/chatHeaderBar";
import { VoiceSessionProvider } from "@/apps/chat/voiceSessionContext";
import { DictationLevelMeterProvider } from "@/apps/chat/composerDictationWaveform";
import { ChatAvailabilityContext, useChatAvailability, useChatComposerNotice, useVoiceAvailable } from "@/apps/chat/useChatAvailability";
import { useLiveVoiceSession } from "@/apps/chat/liveVoiceSession";
import { createLocalImageAttachmentAdapter } from "@/apps/chat/localImageAttachmentAdapter";
import { photoUploadsEnabledForBand } from "@/apps/chat/photoUploadAccess";
import { createSttDictationAdapter } from "@/lib/voice/sttDictationAdapter";
import { createSttSocket } from "@/lib/voice/sttSocket";
import type { LevelMeter } from "@/lib/voice/audioLevelMeter";
import { CompositeAttachmentAdapter, SimpleTextAttachmentAdapter } from "@assistant-ui/core";
import { useTabItem } from "@/shell/tabIdentity";
import type { SentenceSpeechScheduler } from "@/lib/sentenceSpeechScheduler";
import { ChatColumnControlContext } from "@/apps/chat/chatColumnControl";
import { CHAT_COLUMN_ID, CHAT_SETTINGS_PATH, canTakeFocus, chatColumnShortcutLabel, focusQuietly, searchableThreadsFor, skipTooltipOnQuietFocus, useChatColumn, useChatThreadListState } from "@/shell/pages/ChatColumn";
import { INCOGNITO_DISCARDED_EVENT, useIncognitoContext } from "@/shell/incognitoContext";
import { useNotificationsQuery } from "@/shell/NotificationBell";
import { ChatShortcutReference } from "@/shell/pages/ChatShortcutReference";
import { ArtifactOpenContext, AdminContext, ChatAgeBandContext, type CompareTarget, CompareOpenContext, SourcesOpenContext, DetailsOpenContext, ThinkingModeContext, ThinkingModeCapabilityContext, BareModeContext, TemporaryChatContext, DraftConversationContext, WakeWordPersonContext, ConnectionStateContext, ChatComposerNoticeContext, type ConnectionState } from "@/apps/chat/chatThreadContexts";
import { ConfirmAskAnswerProvider, ReloadMainThreadProvider } from "@/apps/chat/chatToolUis";
import { CompareIcon, toolCallPartFromMessage } from "@/apps/chat/chatThreadSlots";
import { discardDraft } from "@/apps/chat/draftStore";
import { chatFoldersQueryKey, useChatProjects } from "@/apps/chat/chatProjects";
import { projectConversationRows, projectSourcesVisible } from "@/shell/pages/chatProjectPageModel";

// CHAT-FIND-0923-02: `panel-left-open` shows which way the click goes;
// the phone row's sheet control uses the same glyph as the desktop
// column's show control (ChatColumn.tsx).
const ColumnOpenIcon = getIcon("panel-left-open");
const ColumnCloseIcon = getIcon("panel-left-close");
const ColumnPinIcon = getIcon("pin");
const SearchIcon = getIcon("search");
const CloseIcon = getIcon("x");
const VoiceSettingsIcon = getIcon("settings");
const LazyProjectHomeHeader = lazy(() => import("@maipai/ui/src/elements/project-home-page").then((module) => ({ default: module.ProjectHomeHeader })));
const LazyProjectHomeTabs = lazy(() => import("@maipai/ui/src/elements/project-home-page").then((module) => ({ default: module.ProjectHomeTabs })));

function useArtifactCanvas(artifactId: string | null) {
  return useQuery({
    queryKey: ["artifact-current", artifactId],
    queryFn: () => api.artifactCurrent(artifactId!),
    enabled: artifactId !== null,
  });
}

function useBareCompareCanvas(target: CompareTarget | null) {
  const [trace, setTrace] = useState<BareCompareTrace | null>(null);
  const [bareText, setBareText] = useState("");
  const [refused, setRefused] = useState(false);
  const [status, setStatus] = useState<"loading" | "streaming" | "done" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const conversationId = target?.conversationId;
  const turnId = target?.turnId;
  const ourText = target?.ourText;

  useEffect(() => {
    if (conversationId === undefined || turnId === undefined || ourText === undefined) {
      setTrace(null);
      setBareText("");
      setRefused(false);
      setStatus("loading");
      setErrorMessage(null);
      return;
    }
    const controller = new AbortController();
    setTrace(null);
    setBareText("");
    setRefused(false);
    setStatus("loading");
    setErrorMessage(null);
    (async () => {
      try {
        const response = await api.compareTurnBare(conversationId, turnId, controller.signal);
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
  }, [conversationId, turnId, ourText, target]);

  return { trace, bareText, refused, status, errorMessage };
}

/** /chat: SHELL-02's slice 2 (docs/plans/shell-on-shadcndashboard-
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
 * Pinning uses the kit's opt-in `pinnable` Element prop and the adapter's
 * existing `custom.pinned` persistence. Incognito passes it as false so
 * temporary threads never offer Pin.
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

function useChatRuntime(person: Roster, closeSheet: () => void, temporaryNext: boolean, voiceOpen: boolean, onArtifactReady: (artifactId: string) => void, setDraftConversationId: (id: string | undefined) => void, folderId?: string) {
  const temporaryModeRef = useRef(temporaryNext);
  temporaryModeRef.current = temporaryNext;
  const turnSchedulerRef = useRef<SentenceSpeechScheduler | null>(null);
  // VOICE-LIVE-02: true only while the live voice session (below) is
  // open - the one gate on `speakReplies` above, and `pendingSpeechRef` the
  // one flag `consumeSpoken` reads and clears, the same single-shot
  // shape `temporaryModeRef`/`packageScopeRef` already use.
  const liveVoiceActiveRef = useRef(false);
  // HANDSFREE-01(a): automatic read-aloud is remembered per conversation.
  const [autoReadReplies, setAutoReadReplies] = useState(false);
  const autoReadRepliesRef = useRef(false);
  autoReadRepliesRef.current = autoReadReplies;
  const isAdultBand = person.age_band === "adult";
  const isOwnerOrAdmin = isOwnerOrAdminRole(person.role);
  const enginesQuery = useQuery<EnginesOverview>({ queryKey: ["engines"], queryFn: () => api.engines(), enabled: isOwnerOrAdmin });
  const chatModelsQuery = useQuery<ChatModelsResponse>({ queryKey: ["chatModels"], queryFn: () => api.chatModels(), enabled: isAdultBand && !isOwnerOrAdmin });
  const photoSettingsQuery = useQuery({ queryKey: ["settingsValues", `person:${person.id}`], queryFn: () => api.settingsValues(`person:${person.id}`) });
  const photoSettings = Array.isArray(photoSettingsQuery.data) ? photoSettingsQuery.data : [];
  const photoSetting = photoSettings.find((setting) => setting.key === "chat.photo_uploads");
  const photoUploadsEnabled = photoUploadsEnabledForBand(person.age_band, photoSetting);
  const chatRole = enginesQuery.data?.roles?.find((role) => role.id === "chat");
  // VISION-02d (rule 8): what each chat model can do, from its record
  // through the backend. A model with no thinking mode offers no
  // Instant/Thinking control and its turns never ask for thinking.
  const capabilitiesQuery = useQuery({
    queryKey: CHAT_CAPABILITIES_QUERY_KEY,
    queryFn: async () => chatCapabilitiesFrom(await api.chatCapabilities().catch(() => undefined)),
    staleTime: 0,
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });
  const chatCapabilities = capabilitiesQuery.data ?? NO_CHAT_PICTURES;
  const imagePartsAvailable = chatCapabilities.image_parts;
  // ENGINE-DOWN-UI-01: the voice service's own health row (any person), not the
  // admin-only engines overview and never the chat engine.
  const ttsAvailable = useVoiceAvailable();
  const ttsAvailableRef = useRef(ttsAvailable);
  ttsAvailableRef.current = ttsAvailable;
  const pendingSpeechRef = useRef(false);
  // APPROVE-CARD-01: armed by ConfirmAskAnswerProvider's own `respond`
  // callback (ConfirmToolRender's Allow once/Deny handlers, via
  // ConfirmAskAnswerContext), the same single-shot shape as
  // `pendingSpeechRef` above - `consumeAskAnswer` below reads and clears it.
  const askAnswerRef = useRef<{ turnId: string; approved: boolean } | undefined>(undefined);
  // VOICE-LIVE-02: chatModelAdapter.ts's own onSpeakingChange, relayed as
  // real state so useLiveVoiceSession (a sibling hook, not inside this
  // runtime hook) can react to the live scheduler's own start/end - nothing else
  // in this file reads it today, so no other caller changes.
  const [isSpeaking, setIsSpeaking] = useState(false);
  // A code review caught this: `isSpeaking` alone misses the case where a
  // reply never spoke at all (empty, or every sentence's TTS failed) -
  // onFirstAudio never fires, so onSpeakingChange(false) arrives with
  // React state ALREADY false, a same-value setState that never
  // re-renders and never re-runs useLiveVoiceSession's own effect, leaving
  // the call stuck on "Thinking" forever. Bumped on every `false` call
  // regardless of the previous value, so useLiveVoiceSession can depend on
  // this instead of `isSpeaking` alone to notice "speaking is over."
  const [speakingEndedAt, setSpeakingEndedAt] = useState(0);
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
  // PERSIST-CONV-01 / RESP-04: Thinking hydrates from the active
  // conversation settings and saves when changed. The model comes from
  // Stack and is not a chat-facing choice.
  const [thinking, setThinkingState] = useState(false);
  const thinkingRef = useRef(false);
  thinkingRef.current = thinking;
  const thinkingDirtyRef = useRef(false);
  const autoReadRepliesDirtyRef = useRef(false);
  const pendingNewConversationReadAloudRef = useRef<boolean | undefined>(undefined);
  const pendingNewConversationThinkingRef = useRef<boolean | undefined>(undefined);
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
  // The signed-in payload carries the backend's shared band. Keep model,
  // thinking and temporary-chat controls aligned with the turn gate.
  const thinkingAllowed = person.age_band === "adult" && canHaveTemporaryChatRole(person.role);
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
  const onConversationSettingsLoaded = useCallback((conversationId: string, settings: Conversation["settings"]) => {
    if (visibleConversationIdRef.current !== conversationId) {
      if (visibleConversationIdRef.current === undefined) {
        visibleConversationIdRef.current = conversationId;
        previousThreadIdRef.current = conversationId;
      } else return;
    }
    if (!thinkingDirtyRef.current) applyConversationThinking(settings?.thinking ?? false);
    if (!autoReadRepliesDirtyRef.current) applyAutoReadReplies(settings?.read_aloud ?? false);
  }, [applyAutoReadReplies, applyConversationThinking]);
  const hydrateConversationSettings = useCallback(async (conversationId: string) => {
    const conversation = await api.conversation(conversationId);
    onConversationSettingsLoaded(conversationId, conversation.settings);
    return conversation;
  }, [onConversationSettingsLoaded]);
  const currentModelId = isOwnerOrAdmin ? chatRole?.model?.id : chatModelsQuery.data?.selectedModel?.id;
  const activeModelId = currentModelId;
  const thinkingModeCapability = activeModelId
    ? chatCapabilities.thinking_modes[activeModelId] ?? chatCapabilities.thinking
    : chatCapabilities.thinking;
  const thinkingModeVisible = isAdultBand && activeModelId !== undefined;
  const currentModelThinksRef = useRef(true);
  currentModelThinksRef.current = modelThinks(chatCapabilities, activeModelId);
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
  const folderIdRef = useRef(folderId);
  folderIdRef.current = folderId;
  // getmaipai/home#206: a saved chat that could not be opened releases the
  // Send hold ChatThread keeps while that chat is opening.
  const [unopenableConversationId, setUnopenableConversationId] = useState<string | undefined>(undefined);
  const forgetUnopenableConversation = useCallback(() => setUnopenableConversationId(undefined), []);
  const threadListAdapter = useMemo(() => createChatThreadListAdapter(person.display_name, { incognito: temporaryNext, folderIdRef, onArchiveUnavailable, onSettingsLoaded: onConversationSettingsLoaded, onOpenFailed: setUnopenableConversationId }), [person.display_name, temporaryNext, onArchiveUnavailable, onConversationSettingsLoaded]);
  // SHELL-02 slice 6: the same real adapters ChatPage.tsx's composer
  // already uses - images plus, new here, text/Markdown files through
  // the shipped `SimpleTextAttachmentAdapter` (client-side only, no
  // route: it reads the file's own text, same as the image adapter
  // reads bytes into a data URL, no backend change needed). PDF and
  // office documents stay unbuilt: `documentExtraction.ts`'s Tika path
  // exists server-side but nothing wires it to a route or the turn
  // (COMPOSER-DOC-ATTACH-01, docs/BACKLOG.md) - a real gap, not this
  // slice's UI-composition scope.
  const imageAttachmentAllowedRef = useRef(photoUploadsEnabled && imagePartsAvailable);
  imageAttachmentAllowedRef.current = photoUploadsEnabled && imagePartsAvailable;
  const imageDisabledMessageRef = useRef("Pictures need a ready vision model.");
  imageDisabledMessageRef.current = !photoUploadsEnabled ? "Photo uploads are turned off for this profile." : "Pictures need a ready vision model.";
  const imageAttachmentAdapter = useMemo(() => createLocalImageAttachmentAdapter({
    enabled: () => imageAttachmentAllowedRef.current,
    disabledMessage: () => imageDisabledMessageRef.current,
  }), []);
  const textAttachmentAdapter = useMemo(() => new SimpleTextAttachmentAdapter(), []);
  const attachmentsAdapter = useMemo(() => {
    const composite = new CompositeAttachmentAdapter([imageAttachmentAdapter, textAttachmentAdapter]);
    // CompositeAttachmentAdapter snapshots child accept strings in its
    // constructor. Expose the union through a live getter so the shipped
    // file primitive can follow Stack capability changes without replacing
    // the active chat runtime.
    Object.defineProperty(composite, "accept", {
      configurable: true,
      enumerable: true,
      get: () => `${imageAttachmentAdapter.accept},${textAttachmentAdapter.accept}`,
    });
    return composite;
  }, [imageAttachmentAdapter, textAttachmentAdapter]);
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

  // FEEDBACK-CANCEL-01: the feedback adapter un-lights a thumb through the
  // thread it belongs to.
  const runtimeRef = useRef<ReturnType<typeof useLocalRuntime>>(undefined);
  // A named, `use`-prefixed function, not an inline arrow - ChatPage.tsx's
  // own comment on why: `useRemoteThreadListRuntime` calls `runtimeHook`
  // from inside its own render, so react-hooks/rules-of-hooks needs the
  // naming convention to recognize this as a real hook call.
  function useChatRuntimeHook() {
    const aui = useAui();
    const chatModelAdapter = useMemo(
      () =>
        createChatModelAdapter({
          onDraftSent: () => { if (!temporaryModeRef.current) discardDraft(visibleConversationIdRef.current); },
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
            await settingsWriteRef.current;
            return remoteId;
          },
          resumeConversationIfClosed: resumeClosedConversation,
          // RESP-04's own design: "the choice... is remembered per
          // person with the conversation" - Jesse found this broken
          // live, 2026-09-22 (choosing Thinking reverted to Instant
          // right after sending). This used to reset per turn, copied
          // from ChatPage.tsx's own "Think longer" (a genuinely
          // per-message opt-in there); RESP-04's control is a mode. Its
          // current value is hydrated from the conversation settings,
          // saved by its setter, and used on every send until changed.
          getThinking: () => (thinkingAllowed && currentModelThinksRef.current ? thinkingRef.current : undefined),
          getAgeBand: () => person.age_band,
          consumeSupersedes,
          consumePackageScope: () => {
            const value = packageScopeRef.current?.id;
            packageScopeRef.current = null;
            setPackageScope(null);
            return value;
          },
          consumeTemporary: () => {
            return temporaryModeRef.current || undefined;
          },
          // VOICE-LIVE-02: armed once, right before the live voice
          // session's own aui.composer.send() for its final transcript -
          // the single-shot shape every other per-send choice here
          // already uses.
          consumeSpoken: () => {
            const value = pendingSpeechRef.current || undefined;
            pendingSpeechRef.current = false;
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
    // the speech adapter uses Home's POST /api/tts route through the
    // runtime capability.
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
        feedback: createChatFeedbackAdapter({
          clearRating: (messageId) => {
            const thread = runtimeRef.current?.thread;
            // Never re-import the thread under a reply that is still streaming.
            if (thread && !thread.getState().isRunning) clearSubmittedFeedback(thread, messageId);
          },
        }),
        ...(ttsAvailable ? { speech: createChatSpeechAdapter() } : {}),
        suggestion: createChatSuggestionAdapter(() => temporaryModeRef.current),
        attachments: attachmentsAdapter,
        dictation: dictationAdapter,
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps -- the rule's own static analysis can't see that dictationAdapter's *own* useMemo deps (sttStatusQuery.data) genuinely change across renders, and calls the dependencies "unnecessary" on that mistaken belief; removing them is exactly the bug named above, verified live by ChatPage.test.tsx's DICT-01 describe block. The `ttsAvailable` dependency is also essential: it adds/removes the speech adapter so the shipped Speak action follows real TTS readiness.
      [attachmentsAdapter, dictationAdapter, ttsAvailable],
    );
    const local = useLocalRuntime(chatModelAdapter, {
      adapters,
      // The live voice session sends its transcript directly through the
      // same runtime. Keep its written-message queue off while it is open.
      // ComposerVoiceControls only opens while idle and with no queued
      // messages, so changing this option never drops pending work.
      unstable_enableMessageQueue: !voiceOpen,
      // Stop ends the active reply but leaves submitted messages queued for
      // the next normal send, as CHAT-QUEUE-01 requires.
      unstable_queueClearOnCancel: false,
    });
    runtimeRef.current = local;
    return local;
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
        pendingNewConversationReadAloudRef.current = undefined;
        applyAutoReadReplies(false);
      }
      if (id) void hydrateConversationSettings(id).catch(() => {});
    },
  });

  return { runtime, photoUploadsEnabled, imagePartsAvailable, unopenableConversationId, forgetUnopenableConversation, connection, setConnection, thinking, setThinking, thinkingModeVisible, thinkingModeCapability, bareMode, setBareMode, autoReadReplies, setAutoReadReplies: setConversationAutoReadReplies, ttsAvailable, packageScope, setPackageScope, temporaryNext, turnSchedulerRef, liveVoiceActiveRef, pendingSpeechRef, askAnswerRef, isSpeaking, speakingEndedAt, dictationLevelMeter };
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
function ChatDocumentTitle({ person }: { person: Roster }) {
  const title = useAuiState((s) => s.threadListItem.title) ?? undefined;
  const { on: temporary } = useIncognitoContext();
  const privateTitle = temporary ? "Private chat" : person.age_band === "child" ? "Chat" : title;
  useTabItem("Chat", privateTitle);
  return null;
}

/** CHAT-TITLE-01 follow-up: the runtime asks the hub for a title only right after a reply finishes in this
 * mounted page. Leave while the reply streams, or open a chat that has none yet, and nothing asks again, so the
 * row and the header keep saying "New Chat". This asks once per opened chat (and again on a return, because
 * the page remounts) whenever the open chat has messages and no title; the adapter's bounded poll does the
 * waiting and the runtime applies the result to the list row and the header together. */
/** ELEMENTS-ADOPT-02: while a reply in the open chat waits for the memory
 * judge, poll its turns so the reply's memory chips appear when it saves
 * something. Never in Incognito (nothing is remembered there). */
function ChatMemoryPoll({ incognito }: { incognito: boolean }) {
  const remoteId = useAuiState((s) => s.threadListItem.remoteId);
  useMemoryStatusPoll(incognito ? undefined : remoteId);
  return null;
}

function ChatTitleCatchUp({ incognito }: { incognito: boolean }) {
  const aui = useAui();
  const remoteId = useAuiState((s) => s.threadListItem.remoteId);
  const title = useAuiState((s) => s.threadListItem.title);
  const status = useAuiState((s) => s.threadListItem.status);
  const messageCount = useAuiState((s) => s.thread.messages.length);
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const asked = useRef<string | undefined>(undefined);
  const wanted = needsTitleCatchUp({ remoteId, title, status }, messageCount, isRunning, incognito);
  useEffect(() => {
    if (!wanted || asked.current === remoteId) return;
    asked.current = remoteId;
    void Promise.resolve(aui.threadListItem().generateTitle({ automatic: true })).catch(() => undefined);
  }, [wanted, remoteId, aui]);
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
    // process yet" (an unguarded `.map` here crashed every ChatPage
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

export function ChatPage({ person }: { person: Roster }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [draftConversationId, setDraftConversationId] = useState<string | undefined>(() => new URLSearchParams(window.location.search).get("conversation") ?? undefined);
  const chatAvailability = useChatAvailability();
  const composerNotice = useChatComposerNotice(person);

  // RAIL-01 (owner's layout, 2026-10-06): the chat draws its own slim
  // header at the top of the conversation pane, beside the history column,
  // instead of filling the shell header's slot (which spanned the history
  // column too).
  const { on: temporaryNext } = useIncognitoContext();
  const projectRoute = useMatch("/chat/projects/:id");
  const projectFolderId = projectRoute?.params.id ? decodeURIComponent(projectRoute.params.id) : undefined;
  const projectDetailQuery = useQuery({ queryKey: ["chat-folders", person.id, "one", projectFolderId ?? ""], queryFn: () => api.chatFolder(projectFolderId!), enabled: projectFolderId !== undefined && !temporaryNext });
  const projectChatsQuery = useQuery({
    queryKey: ["project-page-chats", person.id, projectFolderId ?? ""],
    queryFn: () => api.conversationList(undefined, undefined, "include"),
    enabled: projectFolderId !== undefined && !temporaryNext,
  });
  const projectRows = projectConversationRows(projectChatsQuery.data ?? [], projectFolderId ?? "");
  const projectPageRows = useMemo(() => Object.fromEntries(projectRows.map((row) => [row.id, {
    preview: row.preview,
    date: row.last_turn_at ?? row.created_at,
    projectIcon: { icon: projectDetailQuery.data?.icon, color: projectDetailQuery.data?.color },
  }])), [projectRows, projectDetailQuery.data?.icon, projectDetailQuery.data?.color]);
  const projectList: ThreadListProjects = useMemo(() => ({ folders: [], canMove: false, rowVariant: "page", pageRows: projectPageRows }), [projectPageRows]);
  const projectFolder = projectDetailQuery.data;
  const projectSettingsValue: ProjectSettingsValue | undefined = projectFolder ? {
    name: projectFolder.name,
    icon: projectFolder.icon,
    color: projectFolder.color,
    description: projectFolder.description ?? "",
    instructions: projectFolder.instructions,
    memory_mode: projectFolder.memory_mode,
  } : undefined;
  const projectCanManage = projectFolder?.access === "manage" && person.role !== "child";
  const projectCanEdit = projectFolder?.access === "manage" || projectFolder?.access === "edit";
  const refreshProject = () => queryClient.invalidateQueries({ queryKey: chatFoldersQueryKey(person.id) });
  const projectPage = projectFolderId && !temporaryNext && projectFolder && projectSettingsValue ? {
    folderId: projectFolderId,
    context: { person, folderId: projectFolderId, folderName: projectFolder.name },
    slots: {
      WelcomeContent: <Suspense fallback={null}><LazyProjectHomeHeader
        project={projectSettingsValue}
        canEdit={projectCanEdit}
        canManage={projectCanManage}
        onSave={async (patch) => {
          try {
            await api.updateChatFolder(projectFolder.id, patch);
            await refreshProject();
          } catch (error) {
            toast.error("Could not update that project. Try again.");
            throw error;
          }
        }}
        onArchive={async () => {
          try {
            await api.updateChatFolder(projectFolder.id, { archived: true });
            await refreshProject();
            navigate("/chat/projects");
          } catch {
            toast.error("Could not update that project. Try again.");
          }
        }}
        onDelete={async () => {
          try {
            await api.deleteChatFolder(projectFolder.id);
            await refreshProject();
            navigate("/chat/projects");
          } catch {
            toast.error("Could not delete that project. Try again.");
          }
        }}
      /></Suspense>,
      BelowComposerContent: <Suspense fallback={null}><LazyProjectHomeTabs
        projects={projectList}
        showSources={projectSourcesVisible(person.role)}
        chatsLoading={projectChatsQuery.isPending}
        hasChats={projectRows.length > 0}
      /></Suspense>,
      emptyLayout: "top" as const,
      composerDensity: "compact" as const,
      composerPlaceholder: `New chat in ${projectFolder.name}`,
    },
  } : undefined;
  useEffect(() => {
    if (temporaryNext && projectRoute) navigate("/chat", { replace: true });
  }, [temporaryNext, projectRoute, navigate]);
  // VOICE-LIVE-02: owned here (not inside useChatRuntime) since both
  // the composer's own waveform button (via VoiceSessionProvider,
  // composerVoiceControls.tsx's zero-prop slot needs a context to reach
  // it) and useLiveVoiceSession read the identical state.
  const [voiceOpen, setVoiceOpen] = useState(false);
  // COLUMN-01: the history column's open/hidden state (remembered per
  // browser), its thread search, and the phone sheet. lg (960px) is where
  // the column stops being a sheet.
  const chatColumnBreakpoint = useBreakpoint();
  const column = useChatColumn({ isDesktop: chatColumnBreakpoint.atLeast(960) });
  const { sheetOpen, setSheetOpen } = column;
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
  const isDesktopCanvas = chatColumnBreakpoint.atLeast(1024);
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
  // A code review caught this: switching threads (onThreadIdChange,
  // inside useChatRuntime) left a previous thread's artifact
  // canvas open over the newly-loaded one - the panel has to close on
  // the same signal the phone/tablet Sheet already does.
  const { runtime, photoUploadsEnabled, imagePartsAvailable, unopenableConversationId, forgetUnopenableConversation, connection, setConnection, thinking, setThinking, thinkingModeVisible, thinkingModeCapability, bareMode, setBareMode, autoReadReplies, setAutoReadReplies, ttsAvailable, packageScope, setPackageScope, turnSchedulerRef, liveVoiceActiveRef, pendingSpeechRef, askAnswerRef, isSpeaking, speakingEndedAt, dictationLevelMeter } = useChatRuntime(person, () => {
    setSheetOpen(false);
    setOpenArtifactId(null);
    setCompareTarget(null);
  }, temporaryNext, voiceOpen, setOpenArtifactId, setDraftConversationId, projectPage?.folderId);
  const threadListState = useChatThreadListState(runtime);
  const searchableThreads = useMemo(() => searchableThreadsFor(threadListState, temporaryNext), [threadListState, temporaryNext]);
  const hasThreads = threadListState.threadIds.length > 0;
  const isLoadingThreads = threadListState.isLoading;
  const onNewChatStarted = useCallback(() => setSheetOpen(false), [setSheetOpen]);
  const { projects, settingsDialog } = useChatProjects({ person, temporary: temporaryNext, onNewChatStarted, runtime });
  const desktopSearchRowRef = useRef<HTMLDivElement>(null);
  const mobileSearchRowRef = useRef<HTMLDivElement>(null);
  const desktopSearchButtonRef = useRef<HTMLButtonElement>(null);
  const mobileSearchButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (column.searchOpen && !isLoadingThreads && !hasThreads) column.setSearchOpen(false);
  }, [column.searchOpen, column.setSearchOpen, hasThreads, isLoadingThreads]);
  useEffect(() => {
    if (!column.searchOpen) return;
    const rows = [desktopSearchRowRef.current, mobileSearchRowRef.current];
    const focusField = () => {
      for (const row of rows) {
        if (!canTakeFocus(row)) continue;
        if (!row!.contains(document.activeElement)) row!.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
        return;
      }
    };
    focusField();
    const retry = window.setTimeout(focusField, 150);
    return () => window.clearTimeout(retry);
  }, [column.searchFocusKey, column.searchOpen]);
  useEffect(() => {
    if (column.searchOpen || !column.restoreSearchFocusRef.current) return;
    const button = [desktopSearchButtonRef.current, mobileSearchButtonRef.current].find(canTakeFocus);
    if (!button) return;
    column.restoreSearchFocusRef.current = false;
    focusQuietly(button);
  }, [column.restoreSearchFocusRef, column.searchOpen]);
  const onSearchKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      event.stopPropagation();
      column.closeSearch(true);
    }
  };
  const onSearchBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (column.search !== "") return;
    if (event.relatedTarget instanceof Element && event.relatedTarget.closest('[data-slot="chat-column-header"]')) return;
    column.setSearchOpen(false);
  };
  const chatColumnHeader = (mobile: boolean, toggle?: ReactNode) => (
    <div data-slot="chat-column-top">
      {column.searchOpen && hasThreads ? (
        <div ref={mobile ? mobileSearchRowRef : desktopSearchRowRef} data-slot="chat-column-header" className={`flex h-9 w-full items-center gap-1 ps-0.5 ${mobile ? "pe-10" : ""}`}>
          <div className="min-w-0 flex-1">
            <ThreadSearch
              threads={searchableThreads}
              query={column.search}
              activeId={threadListState.mainThreadId}
              onQueryChange={column.setSearch}
              onSelect={(id) => void runtime.threads.switchToThread(id)}
              inputOnly
              density="compact"
              aria-label="Search chats"
              onKeyDown={onSearchKeyDown}
              onBlur={onSearchBlur}
            />
          </div>
          <TooltipIconButton tooltip="Close search" data-slot="chat-column-icon" aria-label="Close search" onClick={() => column.closeSearch(true)}>
            <CloseIcon className="size-4" />
          </TooltipIconButton>
          {toggle}
        </div>
      ) : (
        <div data-slot="chat-column-header" className={`flex h-9 w-full items-center gap-1 ps-0.5 ${mobile ? "pe-10" : ""}`}>
          <span data-slot="chat-column-title" className="min-w-0 flex-1 truncate">Chat</span>
          <TooltipIconButton tooltip="Chat settings" data-slot="chat-column-icon" asChild>
            <Link to={CHAT_SETTINGS_PATH} aria-label="Chat settings"><VoiceSettingsIcon className="size-4.5" /></Link>
          </TooltipIconButton>
          {hasThreads ? (
            <TooltipIconButton
              ref={mobile ? mobileSearchButtonRef : desktopSearchButtonRef}
              tooltip="Search chats"
              data-slot="chat-column-icon"
              aria-label="Search chats"
              onFocus={skipTooltipOnQuietFocus}
              onClick={() => { column.setSearchOpen(true); column.setSearchFocusKey((key) => key + 1); }}
            ><SearchIcon className="size-4.5" /></TooltipIconButton>
          ) : null}
          {toggle}
        </div>
      )}
    </div>
  );
  const previousImagePartsAvailable = useRef(imagePartsAvailable);
  useEffect(() => {
    if (previousImagePartsAvailable.current === imagePartsAvailable) return;
    previousImagePartsAvailable.current = imagePartsAvailable;
    // assistant-ui snapshots attachmentAccept and does not notify its
    // composer when only an existing adapter's accept list changes. Its
    // public run-config setter emits that notification; a shallow copy keeps
    // the request config's value exactly the same while refreshing the file
    // picker's accepted types.
    const currentRunConfig = runtime.thread.composer.getState().runConfig;
    runtime.thread.composer.setRunConfig({ ...currentRunConfig });
  }, [imagePartsAvailable, runtime]);
  const voiceSession = useLiveVoiceSession({
    composer: runtime.thread.composer,
    open: voiceOpen,
    onOpenChange: setVoiceOpen,
    turnSchedulerRef,
    liveVoiceActiveRef,
    pendingSpeechRef,
    isSpeaking,
    speakingEndedAt,
  });
  const [pageSearchParams] = useSearchParams();
  const requestedConversationId = pageSearchParams.get("conversation") ?? undefined;
  const openingConversationId = requestedConversationId !== unopenableConversationId ? requestedConversationId : undefined;
  // A failed open only counts for that visit: going anywhere else forgets
  // it, so the same chat reached again later is held while it opens.
  useEffect(() => {
    if (unopenableConversationId !== undefined && requestedConversationId !== unopenableConversationId) forgetUnopenableConversation();
  }, [requestedConversationId, unopenableConversationId, forgetUnopenableConversation]);
  const thinkingModeValue = useMemo(
    () => ({
      mode: (thinking ? "thinking" : "instant") as "instant" | "thinking",
      setMode: (mode: "instant" | "thinking") => setThinking(mode === "thinking"),
    }),
    [thinking, setThinking],
  );
  const bareModeValue = useMemo(() => ({ on: bareMode, toggle: () => setBareMode((value) => !value) }), [bareMode, setBareMode]);
  const packageScopeValue = useMemo(() => ({ scope: packageScope, setScope: setPackageScope }), [packageScope, setPackageScope]);
  const temporaryChatValue = useMemo(() => ({ on: temporaryNext }), [temporaryNext]);
  const closeArtifact = () => setOpenArtifactId(null);
  const closeCompare = () => setCompareTarget(null);
  const artifactCanvasId = isDesktopCanvas ? lastCanvasArtifactId : openArtifactId;
  const artifactQuery = useArtifactCanvas(artifactCanvasId);
  const compareCanvas = useBareCompareCanvas(compareTarget);
  const artifactCanvas = artifactCanvasId === null ? null : (
    <CanvasSplit variant="pane">
      <CanvasSplitThread>
        <CanvasSplitMessage speaker="assistant">{artifactQuery.data ? `Wrote "${artifactQuery.data.title}."` : "Wrote the document."}</CanvasSplitMessage>
      </CanvasSplitThread>
      <CanvasSplitDocument>
        <AsyncState
          data={artifactQuery.data}
          error={artifactQuery.isError}
          isFetching={artifactQuery.isFetching}
          onRetry={() => void artifactQuery.refetch()}
          errorMessage={artifactQuery.error instanceof ApiError ? artifactQuery.error.message : "Could not load this document."}
          loadingLabel="Loading document"
        >
          {(artifact) => (
            <>
              <CanvasSplitHeader title={artifact.title} version={artifact.version} saved onCopy={() => void navigator.clipboard.writeText(artifact.body)} onClose={closeArtifact} />
              <CanvasSplitBody>
                <MarkdownDocument text={artifact.body} />
              </CanvasSplitBody>
            </>
          )}
        </AsyncState>
      </CanvasSplitDocument>
    </CanvasSplit>
  );
  const compareCanvasElement = compareTarget === null ? null : (
    <CanvasSplit>
      <CanvasSplitDocument>
        <CanvasSplitHeader title="Ours" version={1} saved onCopy={() => void navigator.clipboard.writeText(compareTarget.ourText)} onClose={closeCompare} />
        <CanvasSplitBody>
          <CanvasSplitLine>{compareTarget.ourText}</CanvasSplitLine>
          {compareCanvas.trace ? (
            <>
              <CanvasSplitLine heading>Trace</CanvasSplitLine>
              <CanvasSplitLine>Rung: {compareCanvas.trace.rung ?? "none"}</CanvasSplitLine>
              <CanvasSplitLine>
                Route: {compareCanvas.trace.routing_tier ?? "model"}
                {compareCanvas.trace.routing_score !== null ? ` (${compareCanvas.trace.routing_score.toFixed(2)})` : ""}
              </CanvasSplitLine>
              <CanvasSplitLine>Rules fired: {compareCanvas.trace.rules.length > 0 ? compareCanvas.trace.rules.join(", ") : "none"}</CanvasSplitLine>
              <CanvasSplitLine>Guard: {compareCanvas.trace.guard_reason ?? "none"}</CanvasSplitLine>
              <CanvasSplitLine>Thinking: {compareCanvas.trace.stats?.thinking ? "on" : "off"}</CanvasSplitLine>
              <CanvasSplitLine>Model: {compareCanvas.trace.stats?.engine ?? "unknown"}</CanvasSplitLine>
              <CanvasSplitLine>Persona in effect: {compareCanvas.trace.persona_fragments || "none"}</CanvasSplitLine>
            </>
          ) : null}
        </CanvasSplitBody>
      </CanvasSplitDocument>
      <CanvasSplitDocument>
        <CanvasSplitHeader title="Bare model" version={1} saved onCopy={() => void navigator.clipboard.writeText(compareCanvas.bareText)} onClose={closeCompare} />
        <CanvasSplitBody writing={compareCanvas.status === "streaming"}>
          {compareCanvas.status === "loading" ? <CanvasSplitLine>Asking the bare model…</CanvasSplitLine> : null}
          {compareCanvas.status === "error" ? <CanvasSplitLine>{compareCanvas.errorMessage}</CanvasSplitLine> : null}
          {compareCanvas.bareText ? <CanvasSplitLine>{compareCanvas.bareText}</CanvasSplitLine> : null}
          {compareCanvas.refused ? <CanvasSplitLine>The bare reply was refused by the same safety pass a real turn uses.</CanvasSplitLine> : null}
        </CanvasSplitBody>
      </CanvasSplitDocument>
    </CanvasSplit>
  );

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatAvailabilityContext.Provider value={chatAvailability}>
      <ChatComposerNoticeContext.Provider value={composerNotice}>
      <ArtifactOpenContext.Provider value={setOpenArtifactId}>
      <ReloadMainThreadProvider>
      <ConfirmAskAnswerProvider askAnswerRef={askAnswerRef}>
      <AdminContext.Provider value={isOwnerOrAdminRole(person.role)}>
      <ChatAgeBandContext.Provider value={person.age_band ?? "child"}>
      <ChatActorContext.Provider value={person.id}>
      <CompareOpenContext.Provider value={setCompareTarget}>
      <SourcesOpenContext.Provider value={sourcesOpenValue}>
      <DetailsOpenContext.Provider value={detailsOpenValue}>
      <ThinkingModeContext.Provider value={thinkingModeValue}>
      <ThinkingModeCapabilityContext.Provider value={thinkingModeCapability}>
      <BareModeContext.Provider value={bareModeValue}>
      <TemporaryChatContext.Provider value={temporaryChatValue}>
      <DraftConversationContext.Provider value={draftConversationId}>
      <PackageScopeContext.Provider value={packageScopeValue}>
      <PhotoUploadsContext.Provider value={{ settingAllowed: photoUploadsEnabled, modelCanReadPictures: imagePartsAvailable }}>
      <VoiceSessionProvider value={{ open: voiceOpen, setOpen: setVoiceOpen }}>
      <WakeWordPersonContext.Provider value={person}>
      <DictationLevelMeterProvider value={dictationLevelMeter}>
      <ChatColumnControlContext.Provider value={column.control}>
        <ChatShortcutReference />
        <WakeWordController person={person} />
        <ArtifactCacheInvalidator />
              <ChatDocumentTitle person={person} />
        <ChatTitleCatchUp incognito={temporaryNext} />
        <ChatMemoryPoll incognito={temporaryNext} />
        <ChatHeaderDataBridge autoReadReplies={autoReadReplies} setAutoReadReplies={setAutoReadReplies} ttsAvailable={ttsAvailable} />
        <ProjectResultReload />
        {settingsDialog}
        <Dialog open={voiceOpen} onOpenChange={setVoiceOpen}>
          <DialogContent variant="call" showCloseButton={false} aria-label="Voice conversation">
            <VoiceConversation
              mode={voiceSession.mode}
              amplitude={voiceSession.amplitude}
              muted={voiceSession.muted}
              onToggleMute={voiceSession.onToggleMute}
              onEnd={voiceSession.onEnd}
              extra={(
                <TooltipIconButton asChild tooltip="Voice settings">
                  <Link to="/settings/voices" aria-label="Voice settings">
                    <VoiceSettingsIcon />
                  </Link>
                </TooltipIconButton>
              )}
            />
          </DialogContent>
        </Dialog>
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
          {/* Below lg the column is a sheet, opened from this row. */}
          <div className="flex items-center gap-1 border-b border-border pb-2 lg:hidden">
            <Button variant="ghost" size="icon" aria-label={sheetOpen ? "Hide threads" : "Show threads"} aria-expanded={sheetOpen} aria-controls="next-chat-threads" onClick={() => setSheetOpen((open) => !open)}>
              <ColumnOpenIcon className="size-4.5" />
            </Button>
            <ChatHeaderBar phoneRow />
          </div>
          <div className="relative flex min-h-0 flex-1" data-slot="chat-column-stage">
            {/* COLUMN-02: while hidden, the kit's thin hover zone opens this
                column as an overlay without shifting the conversation. */}
            {/* COLUMN-01: the history column. The outer box animates its
                width; the inner box keeps its full width and is pinned to
                the outer box's right edge, so the column's contents slide
                under the app rail without ever re-wrapping. Hidden, it is
                zero wide and `inert` (out of the Tab order and the
                accessibility tree) but stays mounted, so `aria-controls`
                always names a real node. A hover peek (COLUMN-02) overlays
                the conversation while it is hidden. */}
            {/* The shipped compact sidebar has 36px rows. Keep axe's semantic
                checks; mark this approved density out of the generic hit-area audit. */}
            <div
              id={CHAT_COLUMN_ID}
              data-slot="next-chat-rail"
              data-state={column.peek ? "peek" : column.collapsed ? "closed" : "open"}
              aria-label="Conversations"
              role="region"
              data-touch-target-exempt
              onPointerEnter={column.peekColumnHandlers.onPointerEnter}
              onPointerLeave={column.peekColumnHandlers.onPointerLeave}
              className={cn(
                "relative hidden h-full shrink-0 lg:flex",
                column.peek && "absolute inset-y-0 start-0 z-30",
                (!column.collapsed || column.peek) && "border-e",
              )}
            >
            <ThreadListSidebar
              variant="compact"
              header={chatColumnHeader(false, <TooltipIconButton
                ref={column.columnToggleRef}
                tooltip={column.peek ? "Keep conversations open" : `Hide conversations ${chatColumnShortcutLabel()}`}
                data-slot="chat-column-toggle"
                aria-label={column.peek ? "Keep conversations open" : "Hide conversations"}
                aria-expanded={column.peek ? undefined : true}
                aria-controls={column.peek ? undefined : CHAT_COLUMN_ID}
                aria-keyshortcuts="Meta+B Control+B"
                onFocus={skipTooltipOnQuietFocus}
                onClick={column.peek ? column.pinPeek : column.toggleFromButton}
              >{column.peek ? <ColumnPinIcon className="size-4.5" /> : <ColumnCloseIcon className="size-4.5" />}</TooltipIconButton>)}
              labels={{ newChat: "New chat", searchChats: "Search chats" }}
              // The shipped provider root is fixed for page level use. This host embeds it in the in-flow Chat column.
              // eslint-disable-next-line shadcn/no-inline-styles -- SidebarProvider's host style keeps the shipped Element within this column.
              style={{ position: "relative", inset: "auto", width: "100%", height: "100%" }}
              projects={projects}
              pinnable={!temporaryNext}
              temporary={temporaryNext}
              newChatDisabled={chatAvailability === "unavailable"}
              onNewChat={() => { setPendingChatFolder(null); setSheetOpen(false); }}
              searchQuery={hasThreads ? column.search : ""}
              searchable={false}
              emptyState={!isLoadingThreads ? <p data-slot="chat-column-empty" className="px-2.5 py-2 text-sm text-muted-foreground">Your chats will show up here.</p> : undefined}
              collapsed={column.collapsed}
              peek={column.peek}
              onPeekZonePointerEnter={column.peekZoneHandlers.onPointerEnter}
              onPeekZonePointerLeave={column.peekZoneHandlers.onPointerLeave}
              onPeekPointerEnter={column.peekColumnHandlers.onPointerEnter}
              onPeekPointerLeave={column.peekColumnHandlers.onPointerLeave}
              onPeekNavigate={() => column.closePeek(true)}
            />
            </div>
            <div
              data-slot="next-chat-pane"
              className="min-w-0 flex-1"
            >
              {/* RAIL-01: the conversation's own header, spanning the
                  workspace only (never the history column): title and
                  conversation actions on the left and right, and a slot
                  on the right for the agent/task activity toggle. The
                  phone row above carries the same bar below lg. It is
                  the conversation's own surface with no divider, the
                  way Claude's is (owner, 2026-10-06): the controls just
                  sit at the top. While the history column is hidden, its
                  show control sits at this header's left edge, in flow. */}
              <header data-slot="next-chat-header" data-column={column.collapsed ? "closed" : "open"} className={cn("hidden h-13 shrink-0 items-center gap-1 px-5 lg:flex", column.collapsed && "ps-3")}>
                {column.collapsed ? <TooltipIconButton
                  ref={column.headerToggleRef}
                  tooltip={`Show conversations ${chatColumnShortcutLabel()}`}
                  data-slot="chat-column-toggle"
                  aria-label="Show conversations"
                  aria-expanded={false}
                  aria-controls={CHAT_COLUMN_ID}
                  aria-keyshortcuts="Meta+B Control+B"
                  onPointerEnter={column.peekToggleHandlers.onPointerEnter}
                  onPointerLeave={column.peekToggleHandlers.onPointerLeave}
                  onPointerDown={column.peekToggleHandlers.onPointerDown}
                  onPointerUp={column.peekToggleHandlers.onPointerUp}
                  onPointerMove={column.peekToggleHandlers.onPointerMove}
                  onFocus={(event) => { skipTooltipOnQuietFocus(event); column.peekToggleHandlers.onFocus(event); }}
                  onBlur={column.peekToggleHandlers.onBlur}
                  onClick={column.toggleFromButton}
                ><ColumnOpenIcon className="size-4.5" /></TooltipIconButton> : null}
                <ChatHeaderBar />
              </header>
          {bareMode ? (
            // COORDINATOR, 2026-09-22: "while it is on, it is obvious...
            // a persistent visible marker on the conversation for as
            // long as bare mode is active, not a toast." No dismiss
            // control - the switch itself is the only way off, the same
            // way the wake-word invariants treat a mode that changes
            // behavior.
            <Alert variant="destructive" className="mx-auto mt-3 mb-1 w-full max-w-200" role="status">
              <CompareIcon className="size-4" />
              <AlertTitle>Bare mode is on</AlertTitle>
              <AlertDescription>Every reply in this conversation is the bare model - no persona, routing, packages, or quality guards.</AlertDescription>
            </Alert>
          ) : null}
          {/* CHAT-CALM-ERRORS-01d: no engine-state banner. While chat cannot
              answer, the one quiet line under the composer says so
              (ChatComposerNotice), and an owner's or admin's line carries the
              Repairs link this banner used to. */}
          {/* SAFETY-NOTICE-01: crisis resources are no page banner either;
              they sit beside the reply that carried them (the message footer
              and the error slot draw the kit GuardrailNotice). */}
              <ConnectionStateContext.Provider value={{ ...connection, setConnection }}>
                <PageContext.Provider value={projectPage?.context ?? null}>
                <ChatThread
                  temporary={temporaryNext}
                  onEditSend={(_messageId, turnId) => setPendingSupersedes(turnId ?? null)}
                  thinkingModeVisible={thinkingModeVisible}
                  canUseIncognito={person.age_band === "adult" && canHaveTemporaryChatRole(person.role)}
                  onOpenSettings={() => navigate("/settings/chat")}
                  openingConversationId={openingConversationId}
                  pageSlots={projectPage?.slots}
                  projectFolderId={projectPage?.folderId}
                />
                </PageContext.Provider>
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
                {lastCanvasArtifactId !== null ? artifactCanvas : null}
              </div>
            ) : null}
            {compareTarget !== null ? (
              <div className="ms-4 hidden w-full max-w-3xl shrink-0 overflow-y-auto lg:block">
                {compareCanvasElement}
              </div>
            ) : null}
          </div>
        </div>
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          {/* eslint-disable-next-line shadcn/no-restyle, shadcn/no-arbitrary-values -- sheet width and responsive visibility are intentional layout for the mobile thread list; max-w-[calc(100vw-2rem)] has no scale-token equivalent since Sheet has no max-width prop of its own (commons/ui/docs/dashboard-upstream.md) */}
          <SheetContent id="next-chat-threads" data-chat-column-mobile="" side="left" className="w-80 max-w-[calc(100vw-2rem)] gap-0 p-0 [&_[data-slot='sheet-close']]:right-3 [&_[data-slot='sheet-close']]:top-3.5 lg:hidden"
            // The sheet takes focus itself rather than its first button,
            // so opening it never pops that button's tooltip.
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              (event.currentTarget as HTMLElement | null)?.focus({ preventScroll: true });
            }}
            // Escape inside thread search clears it, then closes it, the
            // same as in the desktop column; only then does it close the
            // sheet (the dialog hears Escape before the field does).
            onEscapeKeyDown={(event) => {
              if (!column.searchOpen) return;
              event.preventDefault();
              if (column.search !== "") column.setSearch("");
              else column.closeSearch(true);
            }}
          >
            {/* eslint-disable-next-line shadcn/no-restyle -- sr-only hides the header visually while keeping it accessible */}
            <SheetHeader className="sr-only">
              <SheetTitle>Conversations</SheetTitle>
              <SheetDescription>Past conversations</SheetDescription>
            </SheetHeader>
            <ThreadListSidebar
              data-chat-column-mobile=""
              aria-label="Conversations"
              role="region"
              variant="compact"
              header={chatColumnHeader(true)}
              labels={{ newChat: "New chat", searchChats: "Search chats" }}
              // eslint-disable-next-line shadcn/no-inline-styles -- SidebarProvider's host style keeps the shipped Element within the phone sheet.
              style={{ position: "relative", inset: "auto", width: "100%", height: "100%" }}
              projects={projects}
              pinnable={!temporaryNext}
              temporary={temporaryNext}
              newChatDisabled={chatAvailability === "unavailable"}
              onNewChat={() => { setPendingChatFolder(null); setSheetOpen(false); }}
              searchQuery={hasThreads ? column.search : ""}
              searchable={false}
              emptyState={!isLoadingThreads ? <p data-slot="chat-column-empty" className="px-2.5 py-2 text-sm text-muted-foreground">Your chats will show up here.</p> : undefined}
            />
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
            {!isDesktopCanvas && openArtifactId !== null ? artifactCanvas : null}
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
            {compareCanvasElement}
          </SheetContent>
        </Sheet>
      </ChatColumnControlContext.Provider>
      </DictationLevelMeterProvider>
      </WakeWordPersonContext.Provider>
      </VoiceSessionProvider>
      </PhotoUploadsContext.Provider>
      </PackageScopeContext.Provider>
      </DraftConversationContext.Provider>
      </TemporaryChatContext.Provider>
      </BareModeContext.Provider>
      </ThinkingModeCapabilityContext.Provider>
      </ThinkingModeContext.Provider>
      </DetailsOpenContext.Provider>
      </SourcesOpenContext.Provider>
      </CompareOpenContext.Provider>
      </ChatActorContext.Provider>
      </ChatAgeBandContext.Provider>
      </AdminContext.Provider>
      </ConfirmAskAnswerProvider>
      </ReloadMainThreadProvider>
      </ArtifactOpenContext.Provider>
      </ChatComposerNoticeContext.Provider>
      </ChatAvailabilityContext.Provider>
    </AssistantRuntimeProvider>
  );
}
