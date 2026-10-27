import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AssistantRuntimeProvider, useAui, useAuiState } from "@assistant-ui/react";
import { useQuery } from "@tanstack/react-query";
import { getIcon } from "@maipai/ui/src/icons";
import { useNavigate } from "react-router-dom";
import { ActivityFeed } from "@maipai/ui/src/elements/activity-feed";
import { Badge } from "@maipai/ui/src/elements/ui/badge";
import { Button } from "@maipai/ui/src/elements/ui/button";
import { EmptyState, EmptyStateGreeting, EmptyStateSuggestion, EmptyStateSuggestions } from "@maipai/ui/src/elements/empty-state";
import { formatRelative } from "@maipai/ui/src/relativeTime";
import { ChatThread } from "@/apps/chat/ChatThread";
import { ChatAgeBandContext, AdminContext, TemporaryChatContext } from "@/apps/chat/chatThreadContexts";
import type { useSideChat } from "@/shell/useSideChat";
import { useSetAmbientRing } from "@/shell/ambientRing";
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

function ThreadSignal({ onReply }: { onReply: (line: string) => void }) {
  const messages = useAuiState((state) => state.thread.messages);
  const running = useAuiState((state) => state.thread.isRunning);
  const lastReply = [...messages].reverse().find((message) => message.role === "assistant");
  const text = lastReply?.content.filter((part) => part.type === "text").map((part) => part.text).join("") ?? "";
  const wasRunning = useRef(false);
  useSetAmbientRing(running ? (text ? null : "thinking") : null);
  useEffect(() => {
    if (running) wasRunning.current = true;
    else if (wasRunning.current && text.trim()) { wasRunning.current = false; onReply(text.trim()); }
  }, [onReply, running, text]);
  return null;
}

function SideChat({ person, companionName, incognito, onReply, onContinue, side }: {
  person: Roster; companionName: string; incognito: boolean;
  onReply: (line: string) => void; onContinue: (id?: string) => void;
  side: ReturnType<typeof useSideChat>;
}) {
  const aui = useAui();
  useEffect(() => {
    const startNew = () => side.newSideChat();
    const loadSide = (event: Event) => { const id = (event as CustomEvent<string>).detail; if (id) void side.openConversation(id); };
    const continueChat = () => { void side.handOff().then((id) => { if (id) onContinue(id); }); };
    const ask = (event: Event) => {
      const text = (event as CustomEvent<string>).detail;
      if (!text) return;
      aui.composer().setText(text);
      void aui.composer().send();
    };
    window.addEventListener("maipai:ambient-new-side", startNew);
    window.addEventListener("maipai:ambient-load-side", loadSide);
    window.addEventListener("maipai:ambient-continue-side", continueChat);
    window.addEventListener("maipai:ambient-ask-side", ask);
    return () => {
      window.removeEventListener("maipai:ambient-new-side", startNew);
      window.removeEventListener("maipai:ambient-load-side", loadSide);
      window.removeEventListener("maipai:ambient-continue-side", continueChat);
      window.removeEventListener("maipai:ambient-ask-side", ask);
    };
  }, [aui, onContinue, side]);
  return <AssistantRuntimeProvider runtime={side.runtime}>
    <ChatAgeBandContext.Provider value={person.age_band ?? "adult"}>
        <AdminContext.Provider value={person.role === "owner" || person.role === "admin"}>
          <TemporaryChatContext.Provider value={{ on: incognito }}>
            <ThreadSignal onReply={onReply} />
            <ChatThread temporary={incognito} canUseIncognito={false} pageSlots={{ WelcomeContent: <EmptyState><EmptyStateGreeting>Hi, I’m {companionName}. What would you like to talk about?</EmptyStateGreeting><EmptyStateSuggestions><EmptyStateSuggestion onClick={() => { void side.handOff().then((id) => { if (id) onContinue(id); }); }}>Continue in Chat</EmptyStateSuggestion></EmptyStateSuggestions></EmptyState> }} />
          </TemporaryChatContext.Provider>
        </AdminContext.Provider>
      </ChatAgeBandContext.Provider>
  </AssistantRuntimeProvider>;
}

export function useAmbientCompanionPane({ person, companionName, companionId, avatar, incognito, state, onStateChange, onReply, onContinue, side }: {
  person: Roster; companionName: string; companionId: string; avatar: ReactNode; incognito: boolean;
  state: AmbientPaneState; onStateChange: (state: AmbientPaneState) => void;
  onReply: (line: string) => void; onContinue: (id: string) => void;
  side: ReturnType<typeof useSideChat>;
}) {
  const navigate = useNavigate();
  const [tab, setTab] = useState("companion");
  const conversations = useQuery({
    queryKey: ["ambient-side-conversations", person.id, companionId],
    queryFn: () => api.conversationList(undefined, undefined, "include", "all"),
    enabled: state.open && tab === "history",
  });
  const rows = useMemo(() => (conversations.data ?? []).filter((row) => {
    const extended = row as ConversationSummary & { companion_id?: string; placement?: "chat" | "side" };
    return extended.companion_id === companionId;
  }).sort((a, b) => (b.last_turn_at ?? b.created_at).localeCompare(a.last_turn_at ?? a.created_at)), [companionId, conversations.data]);
  const activityGroups = [{ id: "conversations", label: "Conversations", items: rows.map((row) => {
    const extended = row as ConversationSummary & { placement?: "chat" | "side" };
    return { id: row.id, title: row.title || "New conversation", line: <span className="flex items-center gap-2"><Badge variant="secondary">{extended.placement === "side" ? "Side chat" : "Chat"}</Badge><span>{formatRelative(row.last_turn_at ?? row.created_at)}</span></span>, action: <Button type="button" variant="ghost" size="sm" onClick={() => {
      if (extended.placement === "side") { setTab("companion"); window.setTimeout(() => window.dispatchEvent(new CustomEvent("maipai:ambient-load-side", { detail: row.id })), 0); }
      else navigate(`/chat?conversation=${encodeURIComponent(row.id)}`);
    }}>Open</Button> };
  }) }];
  const companionTab = { id: "companion", label: companionName, content: companionId ? <SideChat person={person} companionName={companionName} incognito={incognito} onReply={onReply} onContinue={(id) => { if (id) onContinue(id); }} side={side} /> : null };
  const historyTab = { id: "history", label: "History", content: conversations.isLoading ? <p role="status">Loading conversations…</p> : conversations.isError ? <p role="alert">Could not load conversations. Check your connection and try again.</p> : <ActivityFeed label={`${companionName} conversations`} groups={activityGroups} empty={<p>No conversations with {companionName} yet.</p>} /> };
  return { open: state.open, onOpenChange: (open: boolean) => onStateChange({ ...state, open }), pinned: state.pinned, onPinnedChange: (pinned: boolean) => onStateChange({ ...state, pinned }), companionTab, tabs: [historyTab], activeTab: tab, onActiveTabChange: setTab, title: companionName, headerActions: <><Button type="button" variant="ghost" size="icon-sm" aria-label="New side chat" title="New side chat" onClick={() => { setTab("companion"); window.setTimeout(() => window.dispatchEvent(new Event("maipai:ambient-new-side")), 0); }}><NewChatIcon aria-hidden="true" /></Button><Button type="button" variant="ghost" size="icon-sm" aria-label="Continue in Chat" title="Continue in Chat" onClick={() => window.dispatchEvent(new Event("maipai:ambient-continue-side"))}><ContinueIcon aria-hidden="true" /></Button></>, avatar, pinLabel: "Pin pane", closeLabel: "Close pane", label: `${companionName} companion pane` };
}
