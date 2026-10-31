import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AssistantRuntimeProvider, useAui, useAuiState } from "@assistant-ui/react";
import { TalkPill } from "@maipai/ui/src/elements/thread.aui";
import { TooltipIconButton } from "@maipai/ui/src/elements/tooltip-icon-button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@maipai/ui/src/ui/dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getIcon } from "@maipai/ui/src/icons";
import { Link, useNavigate } from "react-router-dom";
import { ActivityFeed } from "@maipai/ui/src/elements/activity-feed";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { Badge } from "@maipai/ui/src/elements/ui/badge";
import { Button } from "@maipai/ui/src/elements/ui/button";
import { formatRelative } from "@maipai/ui/src/relativeTime";
import { toast } from "sonner";
import { CompanionStage, type CompanionStageHistoryItem, type StageMode } from "@maipai/ui/src/elements/companion-stage";
import { CompanionAvatar } from "@maipai/ui/src/elements/companion-avatar";
import { Avatar as SeededAvatar } from "@maipai/ui/src/primitives/Avatar";
import { MarkdownText } from "@maipai/ui/src/elements/markdown-text";
import { Citation } from "@maipai/ui/src/elements/inline-citation";
import { useChatAvailability, engineDownReason } from "@/apps/chat/useChatAvailability";
import { useCompanionSignals, assistantText, isThinking } from "@/apps/chat/useCompanionSignals";
import { sourcesFromMessage } from "@/apps/chat/chatSources";
import { markCitations, parseCitationHref } from "@/apps/chat/chatCitations";
import type { CompanionClips, StateId } from "@maipai/ui/src/elements/companion-avatar-machine";
import { ChatAgeBandContext, AdminContext, TemporaryChatContext } from "@/apps/chat/chatThreadContexts";
import type { useSideChat } from "@/shell/useSideChat";
import type { AmbientRing, AmbientWakeIndicator } from "@/shell/ambientRing";
import { api, type Roster, type ConversationSummary } from "@/lib/api";
import { useLiveVoiceSession, WAKE_SESSION_IDLE_CLOSE_MS } from "@/apps/chat/liveVoiceSession";
import { useMicGate, micHelp } from "@/lib/media/micGate";
import { voiceFailureLine } from "@maipai/home-backend/src/lib/failureCopy";
import { Suggestions } from "@maipai/ui/src/elements/suggestions";
import { useAmbientPageContext } from "@/shell/pageContext";
import { useSpokenReply } from "@/shell/spokenReply";

export const AMBIENT_QUICK_ACTIONS = ["Help with this page", "Find something", "Take an action"] as const;
const QUICK_ACTION_PROMPTS: Record<(typeof AMBIENT_QUICK_ACTIONS)[number], string> = {
  "Help with this page": "Help me with this page.",
  "Find something": "Help me find something in this app.",
  "Take an action": "Help me take an action in this app.",
};
const QUICK_ACTIONS_BY_APP: Record<string, readonly (typeof AMBIENT_QUICK_ACTIONS)[number][]> = {
  settings: ["Help with this page", "Take an action"],
};
export function ambientQuickActionsForApp(appId: string) { return QUICK_ACTIONS_BY_APP[appId] ?? AMBIENT_QUICK_ACTIONS; }
export function ambientQuickActionPrompt(suggestion: string): string | undefined { return QUICK_ACTION_PROMPTS[suggestion as (typeof AMBIENT_QUICK_ACTIONS)[number]]; }

const ContinueIcon = getIcon("arrow-up-right");
const PhoneIcon = getIcon("phone");
const SpeakerIcon = getIcon("volume-2");
const SpeakerOffIcon = getIcon("volume-x");
const MicIcon = getIcon("mic");
const PlusIcon = getIcon("plus");

export type AmbientPaneState = { open: boolean; pinned: boolean };

export function readAmbientPaneState(): AmbientPaneState {
  try {
    const value = window.localStorage.getItem("maipai.ambient.pane");
    if (value) {
      const parsed = JSON.parse(value) as Partial<AmbientPaneState>;
      return { open: parsed.open === true, pinned: parsed.pinned === true };
    }
  } catch { /* local storage may be unavailable */ }
  return { open: false, pinned: false };
}

function ThreadSignal({ onRing }: { onRing: (ring: AmbientRing | undefined) => void }) {
  const messages = useAuiState((state) => state.thread.messages) as never[];
  const running = useAuiState((state) => state.thread.isRunning);
  const last = [...messages].reverse().find((message) => (message as { role?: string }).role === "assistant") as never;
  const thinking = isThinking(running, last);
  useEffect(() => {
    if (thinking) onRing("thinking"); else onRing(undefined);
    return () => onRing(undefined);
  }, [onRing, thinking]);
  return null;
}

export function isProtectedReply(message: Record<string, unknown> | undefined): boolean {
  if (!message) return false;
  const custom = (message.metadata as { custom?: Record<string, unknown> } | undefined)?.custom;
  if (custom && (custom.crisisSupport || custom.safetyNotice || custom.refusal || custom.failedTool || custom.askApproval || custom.approval)) return true;
  const content = message.content;
  return Array.isArray(content) && content.some((part) => {
    if (!part || typeof part !== "object") return false;
    const item = part as { type?: string; toolName?: string; tool_name?: string };
    const toolName = item.toolName ?? item.tool_name;
    return (item.type === "tool-call" || item.type === "tool_call") && (toolName === "confirm" || toolName === "ask");
  });
}

type Sources = ReturnType<typeof sourcesFromMessage>;
const StageSourcesContext = createContext<Sources>([]);

/** The thread as friendly bubbles, oldest first: the person's words and the companion's replies, with empty turns left out. */
export function ambientHistoryItems(messages: Array<Record<string, unknown>>, spoken?: Map<string, string>): CompanionStageHistoryItem[] {
  const items: CompanionStageHistoryItem[] = [];
  for (const message of messages) {
    const role = message.role === "user" ? "user" : message.role === "assistant" ? "companion" : null;
    if (!role) continue;
    const id = String(message.id ?? `${role}-${items.length}`);
    const text = (role === "companion" ? spoken?.get(id) : undefined) ?? assistantText(message as never).trim();
    if (!text) continue;
    const sources = role === "companion" ? sourcesFromMessage(message as never) : [];
    const created = message.createdAt ? new Date(message.createdAt as string | number | Date) : null;
    const time = created && !Number.isNaN(created.getTime()) ? created.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : undefined;
    items.push({
      id,
      role,
      time,
      content: role === "user"
        ? <p className="whitespace-pre-wrap break-words">{text}</p>
        : <StageSourcesContext.Provider value={sources}><MarkdownText text={markCitations(text, sources as never)} components={{ a: StageCitationLink }} /></StageSourcesContext.Provider>,
    });
  }
  return items;
}

export type AmbientPaneControl = {
  ask(text: string): void;
  newChat(): void;
  load(id: string): void;
  continueInChat(): void;
  startCall(): void;
};
export function createAmbientAskQueue() {
  let send: ((text: string) => void) | null = null;
  let call: (() => void) | null = null;
  let queuedCall = false;
  let queued: string | null = null;
  return {
    register(actions: Pick<AmbientPaneControl, "ask"> | null) {
      send = actions?.ask ?? null;
      if (send && queued) { const text = queued; queued = null; send(text); }
    },
    registerCall(start: (() => void) | null) { call = start; if (call && queuedCall) { queuedCall = false; call(); } },
    startCall() { if (call) call(); else queuedCall = true; },
    ask(text: string) {
      if (!text.trim()) return;
      if (send) send(text);
      else queued = text;
    },
  };
}

function CompanionSettings({ person, companionId }: { person: Roster; companionId: string }) {
  const queryClient = useQueryClient();
  const companions = useQuery({ queryKey: ["companions"], queryFn: api.companions });
  return <section aria-label="Companion settings" className="flex flex-col gap-4 p-4">
    <div className="flex flex-col gap-2 text-sm">Companion<Select value={companionId} onValueChange={(value: string) => { void api.setSetting(`person:${person.id}`, "persona.active_id", value).then(() => { void queryClient.invalidateQueries({ queryKey: ["settingsValues", `person:${person.id}`] }); void queryClient.invalidateQueries({ queryKey: ["companion-avatar"] }); }).catch(() => toast.error("Could not change the companion. Check your connection and try again.")); }}><SelectTrigger aria-label="Choose companion"><SelectValue /></SelectTrigger><SelectContent>{(companions.data?.companions ?? []).map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.name}</SelectItem>)}</SelectContent></Select></div>
    <nav aria-label="Companion options" className="flex flex-col gap-3"><Link to={`/companions/${encodeURIComponent(companionId)}`}>Voice</Link><Link to={`/companions/${encodeURIComponent(companionId)}`}>Appearance</Link><Link to="/settings/chat?tab=personalization">Presence</Link></nav>
  </section>;
}

function RuntimeControls({ register, registerCall, side }: { register: (actions: Pick<AmbientPaneControl, "ask"> | null) => void; registerCall: (start: (() => void) | null) => void; side: ReturnType<typeof useSideChat> }) {
  const aui = useAui();
  const { runtime, registerThreadActions } = side;
  useEffect(() => {
    const actions = { ask: (text: string) => { aui.composer().setText(text); void aui.composer().send(); } };
    register(actions);
    registerThreadActions({ reset: () => runtime.thread.reset(), import: (repository) => runtime.thread.import(repository) });
    return () => { register(null); registerCall(null); registerThreadActions(null); };
  }, [aui, register, registerCall, registerThreadActions, runtime]);
  return null;
}

function SideChat({ person, companionName, clips, still, incognito, onRing, register, registerCall, side, ask }: {
  person: Roster; companionName: string; clips?: CompanionClips; still?: string; incognito: boolean;
  onRing: (ring: AmbientRing | undefined) => void;
  register: (actions: Pick<AmbientPaneControl, "ask"> | null) => void; registerCall: (start: (() => void) | null) => void;
  side: ReturnType<typeof useSideChat>;
  ask(text: string): void;
}) {
  return <AssistantRuntimeProvider runtime={side.runtime}>
    <ChatAgeBandContext.Provider value={person.age_band ?? "adult"}>
        <AdminContext.Provider value={person.role === "owner" || person.role === "admin"}>
          <TemporaryChatContext.Provider value={{ on: incognito }}>
            <RuntimeControls register={register} registerCall={registerCall} side={side} />
            <ThreadSignal onRing={onRing} />
            <StageBody person={person} personId={person.id} companionName={companionName} clips={clips} still={still} registerCall={registerCall} side={side} ask={ask} />
          </TemporaryChatContext.Provider>
        </AdminContext.Provider>
      </ChatAgeBandContext.Provider>
  </AssistantRuntimeProvider>;
}

function StageBody({ person, personId, companionName, clips, still, registerCall, side, ask }: { person: Roster; personId: string; companionName: string; clips?: CompanionClips; still?: string; registerCall: (start: (() => void) | null) => void; side: ReturnType<typeof useSideChat>; ask(text: string): void }) {
  const aui = useAui();
  const messages = useAuiState((state) => state.thread.messages) as unknown as Array<Record<string, unknown>>;
  const running = useAuiState((state) => state.thread.isRunning);
  const dictating = useAuiState((state) => state.composer.dictation != null);
  const last = [...messages].reverse().find((message) => message.role === "assistant");
  const status = useChatAvailability();
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [wakeOpened, setWakeOpened] = useState(false);
  const micGate = useMicGate(() => { setVoiceOpen(true); side.setCallActive(true); });
  const requestMic = micGate.request;
  const session = useLiveVoiceSession({ composer: aui.composer(), open: voiceOpen, onOpenChange: (open) => { if (!open) { setWakeOpened(false); side.setCallActive(false); } setVoiceOpen(open); }, onProblem: (kind) => {
    const showFailure = (failureKind: typeof kind) => toast.error(voiceFailureLine(failureKind, { minor: person.age_band !== "adult", canOpenRepairs: false }), { id: "voice-problem" });
    if (kind !== "microphone_blocked") { showFailure(kind); return; }
    void micGate.diagnose().then((allowed) => { if (allowed) showFailure("microphone_setup"); });
  }, idleCloseMs: wakeOpened ? WAKE_SESSION_IDLE_CLOSE_MS : null, turnSchedulerRef: side.turnSchedulerRef, liveVoiceActiveRef: side.liveVoiceActiveRef, pendingSpeechRef: side.pendingSpeechRef, activeTurnRef: side.activeTurnRef, cancelRun: aui.thread.cancelRun, voiceBargeIn: true, isSpeaking: side.isSpeaking, speakingEndedAt: side.speakingEndedAt, speechFailed: side.speechFailed });
  const statusReady = useChatAvailability() === "ready";
  const sttInstalled = side.sttInstalled;
  const prepareCall = side.prepareCall;
  // Issue 275: a call after 30 idle minutes starts a fresh chat; if that check fails the call still opens on the current one.
  const openCall = useCallback(() => { if (!statusReady || !sttInstalled) return; void prepareCall().catch(() => undefined).then(() => { setWakeOpened(true); void requestMic(); }); }, [prepareCall, requestMic, statusReady, sttInstalled]);
  useEffect(() => { registerCall(openCall); return () => registerCall(null); }, [openCall, registerCall]);
  const signals = useCompanionSignals({ personId, messages: messages as never, running, jobRunning: false, jobWaiting: false, runningJobIds: new Set(), doneJobIds: new Set(), isSpeaking: side.isSpeaking || (voiceOpen && session.mode === "speaking"), listening: voiceOpen && session.mode === "listening" || dictating });
  const mode: StageMode = voiceOpen ? (session.mode === "listening" ? "listening" : session.mode === "speaking" ? "speaking" : "thinking") : signals.wanted.listening ? "listening" : signals.wanted.speaking ? "speaking" : signals.wanted.working ? "working" : signals.wanted.thinking ? "thinking" : "idle";
  const stateWord = status === "ready" ? (voiceOpen ? "On a call" : mode === "idle" ? "Ready" : mode[0]!.toUpperCase() + mode.slice(1)) : engineDownReason(status);
  const runningTool = (last?.content as Array<{ type?: string; status?: string | { type?: string }; name?: string; toolName?: string }> | undefined)?.find((part) => (part.type === "tool-call" || part.type === "tool_call") && (typeof part.status === "string" ? part.status : part.status?.type) === "running");
  const workingLine = runningTool ? runningTool.name ?? runningTool.toolName ?? "Working" : undefined;
  const spoken = useSpokenReply(messages, side.turnSchedulerRef.current, voiceOpen || (side.ttsAvailable && side.readAloud));
  const history = ambientHistoryItems(messages, spoken);
  const clipKey = mode === "idle" ? "idle" : mode;
  const characterState: StateId = clips?.[clipKey] ? clipKey : "idle";
  const character = clips
    ? <CompanionAvatar name={companionName} clips={clips} size="fill" state={characterState} animated />
    : still ? <img src={still} alt={companionName} className="h-full w-full object-contain" /> : <SeededAvatar name={companionName} seed={companionName} />;
  const callDisabled = status !== "ready" || !side.sttInstalled;
  const callReason = status !== "ready" ? engineDownReason(status) : !side.sttInstalled ? "Voice input is not installed. Install it in Settings to start a call." : undefined;
  const pageContext = useAmbientPageContext() ?? { app_id: "home", route: "/" };
  const quickActions = ambientQuickActionsForApp(pageContext.app_id);
  const talk = voiceOpen
    ? <div className="flex flex-col gap-2"><p role="status" className="flex items-center justify-center gap-2 rounded-full bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive"><span aria-hidden="true" className="size-2.5 rounded-full bg-destructive motion-safe:animate-pulse" />On a call with {companionName}</p><div className="flex items-center justify-center gap-2"><TooltipIconButton tooltip="Mute microphone" aria-label="Mute microphone" aria-pressed={session.muted} onClick={session.onToggleMute}><MicIcon aria-hidden="true" /></TooltipIconButton><Button type="button" variant="destructive" aria-label="End the call" onClick={session.onEnd}><PhoneIcon aria-hidden="true" />End call</Button></div></div>
    : <div className="flex flex-col gap-3">{history.length ? null : <Suggestions suggestions={quickActions} selectedSuggestion={null} cycle={0} variant="list" onSuggestion={(suggestion) => { const prompt = ambientQuickActionPrompt(suggestion); if (prompt) ask(prompt); }} />}<div className="flex items-center gap-2"><div className="min-w-0 flex-1" title="The microphone writes a transcript in the talk box. Use Call for a live voice conversation."><TalkPill placeholder={`Talk to ${companionName}...`} /></div><Button type="button" aria-label={callDisabled ? `Call ${companionName}, unavailable: ${callReason}` : `Call ${companionName}`} title={callReason} disabled={callDisabled} onClick={openCall}><PhoneIcon aria-hidden="true" /></Button></div></div>;
  const help = micGate.problem ? micHelp(micGate.problem) : null;
  return <><CompanionStage name={companionName} stateWord={stateWord} mode={mode} character={character} history={history.length ? history : undefined} historyLabel={`Conversation with ${companionName}`} workingLine={workingLine} talk={talk} showHeader={false} /><Dialog open={micGate.problem !== null} onOpenChange={(open) => { if (!open) micGate.dismiss(); }}><DialogContent aria-label="Microphone help">{help ? <><DialogHeader><DialogTitle>{help.title}</DialogTitle><DialogDescription>{help.cause}</DialogDescription></DialogHeader>{help.steps.length ? <ol className="list-decimal space-y-1 pl-5 text-sm">{help.steps.map((step) => <li key={step}>{step}</li>)}</ol> : null}<DialogFooter><Button variant="outline" onClick={micGate.dismiss}>Close</Button><Button onClick={() => void micGate.request()}>{micGate.problem === "safari_ask" ? "Continue" : "Try again"}</Button></DialogFooter></> : null}</DialogContent></Dialog></>;
}

function StageCitationLink({ href, children, ...props }: React.ComponentProps<"a">) {
  const [open, setOpen] = useState(false);
  const sources = useContext(StageSourcesContext);
  const index = parseCitationHref(href);
  const source = index ? sources[index - 1] : undefined;
  if (source) return <><Citation index={index! - 1} source={{ domain: source.domain, title: source.title, href: source.url, detail: source.detail }} open={open} onOpenChange={setOpen} /></>;
  return <a href={href} {...props}>{children}</a>;
}

export function useAmbientCompanionPane({ person, companionName, companionId, avatar, clips, still, incognito, state, onStateChange, onContinue, side, onRing, wake }: {
  wake?: AmbientWakeIndicator;
  person: Roster; companionName: string; companionId: string; avatar: ReactNode; clips?: CompanionClips; still?: string; incognito: boolean;
  state: AmbientPaneState; onStateChange: (state: AmbientPaneState) => void;
  onContinue: (id: string) => void; onRing: (ring: AmbientRing | undefined) => void;
  side: ReturnType<typeof useSideChat>;
}) {
  const navigate = useNavigate();
  const [tab, setTab] = useState("companion");
  const [openError, setOpenError] = useState(false);
  const askQueueRef = useRef<ReturnType<typeof createAmbientAskQueue> | null>(null);
  if (!askQueueRef.current) askQueueRef.current = createAmbientAskQueue();
  const register = useCallback((actions: Pick<AmbientPaneControl, "ask"> | null) => askQueueRef.current?.register(actions), []);
  const openCompanionPane = useCallback(() => {
    setTab("companion");
    onStateChange({ ...state, open: true });
  }, [onStateChange, state]);
  const ask = useCallback((text: string) => {
    if (!text.trim()) return;
    openCompanionPane();
    askQueueRef.current?.ask(text);
  }, [openCompanionPane]);
  const newChat = useCallback(() => { openCompanionPane(); setOpenError(false); side.newSideChat(); }, [openCompanionPane, side]);
  const load = useCallback((id: string) => { openCompanionPane(); setOpenError(false); void side.openConversation(id).then((loaded) => { if (!loaded) setOpenError(true); }); }, [openCompanionPane, side]);
  const continueInChat = useCallback(() => { openCompanionPane(); void side.handOff().then((id) => { if (id) onContinue(id); }).catch(() => toast.error("Could not continue this side chat. Try again.")); }, [onContinue, openCompanionPane, side]);
  const conversations = useQuery({
    queryKey: ["ambient-side-conversations", person.id, companionId],
    queryFn: () => api.conversationList(undefined, undefined, "include", "all"),
    enabled: state.open && tab === "history",
  });
  const rows = useMemo(() => (conversations.data ?? []).filter((row) => {
    const extended = row as ConversationSummary & { companion_id?: string | null; placement?: "chat" | "side" };
    return (extended.companion_id ?? companionId) === companionId;
  }).sort((a, b) => (b.last_turn_at ?? b.created_at).localeCompare(a.last_turn_at ?? a.created_at)), [companionId, conversations.data]);
  const activityGroups = [{ id: "conversations", label: "Conversations", items: rows.map((row) => {
    const extended = row as ConversationSummary & { placement?: "chat" | "side" };
    return { id: row.id, title: row.title || "New conversation", line: <span className="flex items-center gap-2"><Badge variant="secondary">{extended.placement === "side" ? "Side chat" : "Chat"}</Badge><span>{formatRelative(row.last_turn_at ?? row.created_at)}</span></span>, action: <Button type="button" variant="ghost" size="sm" onClick={() => {
      if (extended.placement === "side") load(row.id);
      else navigate(`/chat?conversation=${encodeURIComponent(row.id)}`);
    }}>Open</Button> };
  }) }];
  const companionTab = { id: "companion", label: "Talk", content: companionId ? <>{openError ? <p role="alert">Could not open that conversation. Check your connection and try again.</p> : null}<SideChat person={person} companionName={companionName} clips={clips} still={still} incognito={incognito} onRing={onRing} register={register} registerCall={(start) => askQueueRef.current?.registerCall(start)} side={side} ask={ask} /></> : null };
  const historyTab = { id: "history", label: "History", content: conversations.isLoading || conversations.isError ? <AsyncState data={conversations.data} error={conversations.isError} isFetching={conversations.isFetching} onRetry={() => void conversations.refetch()} errorMessage="Could not load conversations. Check your connection and try again." loadingLabel="Loading conversations">{() => null}</AsyncState> : <ActivityFeed label={`${companionName} conversations`} groups={activityGroups} empty={<p>No conversations with {companionName} yet.</p>} /> };
  const toggleReadAloud = () => { const next = !side.readAloud; side.setReadAloud(next); if (next && !side.ttsAvailable) toast.error("Read aloud is unavailable because voice output is not ready. Check Voice settings and try again.", { id: "voice-problem" }); };
  const ReadIcon = side.readAloud ? SpeakerIcon : SpeakerOffIcon;
  const settingsTab = { id: "settings", label: "Settings", content: <><div className="flex items-center justify-between gap-3 px-4 py-3"><span>Read replies aloud</span><TooltipIconButton tooltip={side.readAloud ? "Turn off read replies aloud" : "Read replies aloud"} aria-label="Read replies aloud" aria-pressed={side.readAloud} onClick={toggleReadAloud}><ReadIcon aria-hidden="true" /></TooltipIconButton></div><CompanionSettings person={person} companionId={companionId} /></> };
  return { open: state.open, onOpenChange: (open: boolean) => onStateChange({ ...state, open }), pinned: state.pinned, onPinnedChange: (pinned: boolean) => onStateChange({ ...state, pinned }), companionTab, tabs: [historyTab, settingsTab], activeTab: tab, onActiveTabChange: setTab, title: companionName, control: { ask, newChat, load, continueInChat, startCall: () => { openCompanionPane(); askQueueRef.current?.startCall(); } } satisfies AmbientPaneControl, headerActions: <>{wake ? <Button type="button" variant="ghost" size="icon-sm" aria-label={`${wake.listening}. Turn off`} title={`${wake.listening}. Turn off`} onClick={wake.onTurnOff}><MicIcon aria-hidden="true" /></Button> : null}<Button type="button" variant="ghost" size="icon-sm" aria-label="New conversation" title="New conversation" onClick={newChat}><PlusIcon aria-hidden="true" /></Button><Button type="button" variant="ghost" size="icon-sm" aria-label="Continue in Chat" title="Continue in Chat" onClick={continueInChat}><ContinueIcon aria-hidden="true" /></Button></>, avatar, pinLabel: "Pin pane", closeLabel: "Close pane", label: `${companionName} companion pane` };
}
