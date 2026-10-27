import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AssistantRuntimeProvider, useAui, useAuiState } from "@assistant-ui/react";
import { TalkPill } from "@maipai/ui/src/elements/thread.aui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getIcon } from "@maipai/ui/src/icons";
import { Link, useNavigate } from "react-router-dom";
import { ActivityFeed } from "@maipai/ui/src/elements/activity-feed";
import { Badge } from "@maipai/ui/src/elements/ui/badge";
import { Button } from "@maipai/ui/src/elements/ui/button";
import { formatRelative } from "@maipai/ui/src/relativeTime";
import { toast } from "sonner";
import { CompanionStage, type StageMode } from "@maipai/ui/src/elements/companion-stage";
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
import type { AmbientRing } from "@/shell/ambientRing";
import { api, type Roster, type ConversationSummary } from "@/lib/api";

const NewChatIcon = getIcon("pencil");
const ContinueIcon = getIcon("arrow-up-right");
const SettingsIcon = getIcon("settings");

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

export type AmbientPaneControl = {
  ask(text: string): void;
  newChat(): void;
  load(id: string): void;
  continueInChat(): void;
};
export function createAmbientAskQueue() {
  let send: ((text: string) => void) | null = null;
  let queued: string | null = null;
  return {
    register(actions: Pick<AmbientPaneControl, "ask"> | null) {
      send = actions?.ask ?? null;
      if (send && queued) { const text = queued; queued = null; send(text); }
    },
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
    <label className="flex flex-col gap-2 text-sm">Companion<select aria-label="Choose companion" className="min-h-11 rounded-lg border border-border bg-background px-3" value={companionId} onChange={(event) => { void api.setSetting(`person:${person.id}`, "persona.active_id", event.currentTarget.value).then(() => { void queryClient.invalidateQueries({ queryKey: ["settingsValues", `person:${person.id}`] }); void queryClient.invalidateQueries({ queryKey: ["companion-avatar"] }); }).catch(() => toast.error("Could not change the companion. Check your connection and try again.")); }}>{(companions.data?.companions ?? []).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
    <nav aria-label="Companion options" className="flex flex-col gap-3"><Link to={`/companions/${encodeURIComponent(companionId)}`}>Voice</Link><Link to={`/companions/${encodeURIComponent(companionId)}`}>Appearance</Link><Link to="/settings/chat?tab=personalization">Presence</Link></nav>
  </section>;
}

function RuntimeControls({ register, side }: { register: (actions: Pick<AmbientPaneControl, "ask"> | null) => void; side: ReturnType<typeof useSideChat> }) {
  const aui = useAui();
  const { runtime, registerThreadActions } = side;
  useEffect(() => {
    const actions = { ask: (text: string) => { aui.composer().setText(text); void aui.composer().send(); } };
    register(actions);
    registerThreadActions({ reset: () => runtime.thread.reset(), import: (repository) => runtime.thread.import(repository) });
    return () => { register(null); registerThreadActions(null); };
  }, [aui, register, registerThreadActions, runtime]);
  return null;
}

function SideChat({ person, companionName, clips, still, incognito, onContinue, onRing, register, side }: {
  person: Roster; companionName: string; clips?: CompanionClips; still?: string; incognito: boolean;
  onContinue: (id?: string) => void; onRing: (ring: AmbientRing | undefined) => void;
  register: (actions: Pick<AmbientPaneControl, "ask"> | null) => void;
  side: ReturnType<typeof useSideChat>;
}) {
  return <AssistantRuntimeProvider runtime={side.runtime}>
    <ChatAgeBandContext.Provider value={person.age_band ?? "adult"}>
        <AdminContext.Provider value={person.role === "owner" || person.role === "admin"}>
          <TemporaryChatContext.Provider value={{ on: incognito }}>
            <RuntimeControls register={register} side={side} />
            <ThreadSignal onRing={onRing} />
            <StageBody personId={person.id} companionName={companionName} clips={clips} still={still} onContinue={onContinue} side={side} />
          </TemporaryChatContext.Provider>
        </AdminContext.Provider>
      </ChatAgeBandContext.Provider>
  </AssistantRuntimeProvider>;
}

function StageBody({ personId, companionName, clips, still, onContinue, side }: { personId: string; companionName: string; clips?: CompanionClips; still?: string; onContinue: (id?: string) => void; side: ReturnType<typeof useSideChat> }) {
  const messages = useAuiState((state) => state.thread.messages) as unknown as Array<Record<string, unknown>>;
  const running = useAuiState((state) => state.thread.isRunning);
  const dictating = useAuiState((state) => state.composer.dictation != null);
  const last = [...messages].reverse().find((message) => message.role === "assistant");
  const lastMessage = last as never;
  const text = assistantText(lastMessage);
  const status = useChatAvailability();
  const signals = useCompanionSignals({ personId, messages: messages as never, running, jobRunning: false, jobWaiting: false, runningJobIds: new Set(), doneJobIds: new Set(), isSpeaking: false, listening: dictating });
  const mode: StageMode = signals.wanted.listening ? "listening" : signals.wanted.speaking ? "speaking" : signals.wanted.working ? "working" : signals.wanted.thinking ? "thinking" : "idle";
  const stateWord = status === "ready" ? (mode === "idle" ? "Ready" : mode[0]!.toUpperCase() + mode.slice(1)) : engineDownReason(status);
  const runningTool = (last?.content as Array<{ type?: string; status?: string | { type?: string }; name?: string; toolName?: string }> | undefined)?.find((part) => (part.type === "tool-call" || part.type === "tool_call") && (typeof part.status === "string" ? part.status : part.status?.type) === "running");
  const workingLine = runningTool ? runningTool.name ?? runningTool.toolName ?? "Working" : undefined;
  const [dismissed, setDismissed] = useState<string | null>(null);
  const lastId = String(last?.id ?? text);
  const sources = last ? sourcesFromMessage(last as never) : [];
  const bubble = messages.at(-1)?.role === "assistant" && last?.role === "assistant" && text.trim() && dismissed !== lastId ? <MarkdownText text={markCitations(text, sources as never)} components={{ a: StageCitationLink }} /> : undefined;
  const clipKey = mode === "idle" ? "idle" : mode;
  const characterState: StateId = clips?.[clipKey] ? clipKey : "idle";
  const character = clips
    ? <CompanionAvatar name={companionName} clips={clips} size="xl" state={characterState} animated />
    : still ? <img src={still} alt={companionName} className="max-h-full max-w-full object-contain" /> : <SeededAvatar name={companionName} seed={companionName} />;
  const actions = [
    { id: "continue", label: "Continue in Chat", onSelect: () => { void side.handOff().then((id) => { if (id) onContinue(id); }).catch(() => toast.error("Could not continue this side chat. Try again.")); } },
    { id: "new", label: "New conversation", onSelect: () => side.newSideChat() },
  ];
  // AMBIENT-06: a pane mic turn is sent as a written turn until the spoken path is wired here.
  const talk = <TalkPill placeholder={`Talk to ${companionName}...`} />;
  return <><CompanionStage name={companionName} stateWord={stateWord} mode={mode} character={character} bubble={bubble} onDismissBubble={bubble ? () => setDismissed(lastId) : undefined} workingLine={workingLine} actions={actions} talk={talk} /></>;
}

function StageCitationLink({ href, children, ...props }: React.ComponentProps<"a">) {
  const [open, setOpen] = useState(false);
  const messages = useAuiState((state) => state.thread.messages) as unknown as Array<Record<string, unknown>>;
  const last = [...messages].reverse().find((message) => message.role === "assistant");
  const sources = last ? sourcesFromMessage(last as never) : [];
  const index = parseCitationHref(href);
  const source = index ? sources[index - 1] : undefined;
  if (source) return <><Citation index={index! - 1} source={{ domain: source.domain, title: source.title, href: source.url, detail: source.detail }} open={open} onOpenChange={setOpen} /></>;
  return <a href={href} {...props}>{children}</a>;
}

export function useAmbientCompanionPane({ person, companionName, companionId, avatar, clips, still, incognito, state, onStateChange, onContinue, side, onRing }: {
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
  const companionTab = { id: "companion", label: companionName, content: companionId ? <>{openError ? <p role="alert">Could not open that conversation. Check your connection and try again.</p> : null}<SideChat person={person} companionName={companionName} clips={clips} still={still} incognito={incognito} onContinue={(id) => { if (id) onContinue(id); }} onRing={onRing} register={register} side={side} /></> : null };
  const historyTab = { id: "history", label: "History", content: conversations.isLoading ? <p role="status">Loading conversations…</p> : conversations.isError ? <p role="alert">Could not load conversations. Check your connection and try again.</p> : <ActivityFeed label={`${companionName} conversations`} groups={activityGroups} empty={<p>No conversations with {companionName} yet.</p>} /> };
  const settingsTab = { id: "settings", label: "Settings", content: <CompanionSettings person={person} companionId={companionId} /> };
  return { open: state.open, onOpenChange: (open: boolean) => onStateChange({ ...state, open }), pinned: state.pinned, onPinnedChange: (pinned: boolean) => onStateChange({ ...state, pinned }), companionTab, tabs: [historyTab, settingsTab], activeTab: tab, onActiveTabChange: setTab, title: companionName, control: { ask, newChat, load, continueInChat } satisfies AmbientPaneControl, headerActions: <><Button type="button" variant="ghost" size="icon-sm" aria-label="New side chat" title="New side chat" onClick={newChat}><NewChatIcon aria-hidden="true" /></Button><Button type="button" variant="ghost" size="icon-sm" aria-label="Continue in Chat" title="Continue in Chat" onClick={continueInChat}><ContinueIcon aria-hidden="true" /></Button><Button type="button" variant="ghost" size="icon-sm" aria-label="Companion settings" title="Companion settings" onClick={() => setTab("settings")}><SettingsIcon aria-hidden="true" /></Button></>, avatar, pinLabel: "Pin pane", closeLabel: "Close pane", label: `${companionName} companion pane` };
}
