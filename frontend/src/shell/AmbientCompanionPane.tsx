import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AssistantRuntimeProvider, useAui, useAuiState } from "@assistant-ui/react";
import { useQuery } from "@tanstack/react-query";
import { getIcon } from "@maipai/ui/src/icons";
import { useNavigate } from "react-router-dom";
import { ActivityFeed } from "@maipai/ui/src/elements/activity-feed";
import { Badge } from "@maipai/ui/src/elements/ui/badge";
import { Button } from "@maipai/ui/src/elements/ui/button";
import { EmptyState, EmptyStateGreeting, EmptyStateSuggestion, EmptyStateSuggestions } from "@maipai/ui/src/elements/empty-state";
import { formatRelative } from "@maipai/ui/src/relativeTime";
import { toast } from "sonner";
import { ChatThread } from "@/apps/chat/ChatThread";
import { ChatAgeBandContext, AdminContext, TemporaryChatContext } from "@/apps/chat/chatThreadContexts";
import type { useSideChat } from "@/shell/useSideChat";
import type { AmbientRing } from "@/shell/ambientRing";
import { api, type Roster, type ConversationSummary } from "@/lib/api";

const NewChatIcon = getIcon("pencil");
const ContinueIcon = getIcon("arrow-up-right");

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
  const running = useAuiState((state) => state.thread.isRunning);
  useEffect(() => {
    if (running) onRing("thinking"); else onRing(undefined);
    return () => onRing(undefined);
  }, [onRing, running]);
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

function SideChat({ person, companionName, incognito, onContinue, onRing, register, side }: {
  person: Roster; companionName: string; incognito: boolean;
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
            <ChatThread temporary={incognito} canUseIncognito={false} pageSlots={{ WelcomeContent: <EmptyState><EmptyStateGreeting>Hi, I’m {companionName}. What would you like to talk about?</EmptyStateGreeting><EmptyStateSuggestions><EmptyStateSuggestion onClick={() => { void side.handOff().then((id) => { if (id) onContinue(id); }).catch(() => toast.error("Could not continue this side chat. Try again.")); }}>Continue in Chat</EmptyStateSuggestion></EmptyStateSuggestions></EmptyState> }} />
          </TemporaryChatContext.Provider>
        </AdminContext.Provider>
      </ChatAgeBandContext.Provider>
  </AssistantRuntimeProvider>;
}

export function useAmbientCompanionPane({ person, companionName, companionId, avatar, incognito, state, onStateChange, onContinue, side, onRing }: {
  person: Roster; companionName: string; companionId: string; avatar: ReactNode; incognito: boolean;
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
  const companionTab = { id: "companion", label: companionName, content: companionId ? <>{openError ? <p role="alert">Could not open that conversation. Check your connection and try again.</p> : null}<SideChat person={person} companionName={companionName} incognito={incognito} onContinue={(id) => { if (id) onContinue(id); }} onRing={onRing} register={register} side={side} /></> : null };
  const historyTab = { id: "history", label: "History", content: conversations.isLoading ? <p role="status">Loading conversations…</p> : conversations.isError ? <p role="alert">Could not load conversations. Check your connection and try again.</p> : <ActivityFeed label={`${companionName} conversations`} groups={activityGroups} empty={<p>No conversations with {companionName} yet.</p>} /> };
  return { open: state.open, onOpenChange: (open: boolean) => onStateChange({ ...state, open }), pinned: state.pinned, onPinnedChange: (pinned: boolean) => onStateChange({ ...state, pinned }), companionTab, tabs: [historyTab], activeTab: tab, onActiveTabChange: setTab, title: companionName, control: { ask, newChat, load, continueInChat } satisfies AmbientPaneControl, headerActions: <><Button type="button" variant="ghost" size="icon-sm" aria-label="New side chat" title="New side chat" onClick={newChat}><NewChatIcon aria-hidden="true" /></Button><Button type="button" variant="ghost" size="icon-sm" aria-label="Continue in Chat" title="Continue in Chat" onClick={continueInChat}><ContinueIcon aria-hidden="true" /></Button></>, avatar, pinLabel: "Pin pane", closeLabel: "Close pane", label: `${companionName} companion pane` };
}
