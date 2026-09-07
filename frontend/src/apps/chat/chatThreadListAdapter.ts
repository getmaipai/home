import { useMemo } from "react";
import { useAui, type RemoteThreadListAdapter } from "@assistant-ui/react";
import { createAssistantStream } from "assistant-stream";
import { createChatHistoryAdapter } from "@/apps/chat/chatHistoryAdapter";
import { messageText } from "@/apps/chat/chatMessageText";
import { api } from "@/lib/api";

export function createChatThreadListAdapter(selfName: string): RemoteThreadListAdapter {
  return {
    async list() {
      const rows = await api.conversationList();
      return { threads: rows.filter((row) => row.surface === "chat").map((row) => ({
        status: "regular" as const,
        remoteId: row.id,
        title: row.title ?? undefined,
        lastMessageAt: new Date(row.last_turn_at ?? row.created_at),
      })) };
    },
    async rename(remoteId, title) { await api.renameConversation(remoteId, title); },
    // The shared record has no archive state. Do not expose an action
    // that silently deletes a conversation or disappears on reload.
    async archive() { throw new Error("Archiving conversations is not supported."); },
    async unarchive() { throw new Error("Archiving conversations is not supported."); },
    async delete(remoteId) { await api.deleteConversation(remoteId); },
    async initialize() {
      const row = await api.createConversation();
      return { remoteId: row.id };
    },
    async fetch(remoteId) {
      const row = await api.conversation(remoteId);
      if (row.surface !== "chat") throw new Error("This conversation is not a chat.");
      return { status: "regular", remoteId: row.id, title: row.title ?? undefined };
    },
    async generateTitle(remoteId, messages) {
      const title = messageText(messages.find((message) => message.role === "user")).trim().slice(0, 60) || "New chat";
      await api.renameConversation(remoteId, title);
      return createAssistantStream((controller) => { controller.appendText(title); });
    },
    unstable_useAdapters: function useChatAdapters() {
      const aui = useAui();
      return useMemo(() => ({ history: createChatHistoryAdapter(selfName, () => aui.threadListItem().getState().remoteId) }), [aui]);
    },
  };
}
