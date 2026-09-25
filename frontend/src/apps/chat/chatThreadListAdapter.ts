import { useMemo } from "react";
import { useAui, type RemoteThreadListAdapter } from "@assistant-ui/react";
import { createAssistantStream } from "assistant-stream";
import { toast } from "sonner";
import { createChatHistoryAdapter } from "@/apps/chat/chatHistoryAdapter";
import { messageText } from "@/apps/chat/chatMessageText";
import { api } from "@/lib/api";

export interface ChatThreadListOptions {
  /** The household member whose own conversations to list - omit for
   * the caller's own. Restoring ConversationsPage's own admin oversight
   * (HOME-UI-02e): the server enforces who may view whom
   * (`canAccessPerson`, conversationHistory.ts); this just says who's
   * being asked for. */
  personId?: string;
  /** Server-side search (conversationHistory.ts's own `listConversations`
   * already matches title AND message body, not just title) - the thread
   * list's own client-side filter is skipped when this is set, so a
   * message-body-only match isn't hidden again on the way to the screen
   * (thread-list.aui.tsx's own `skipFilter`). */
  query?: string;
}

export function createChatThreadListAdapter(selfName: string, options: ChatThreadListOptions = {}): RemoteThreadListAdapter {
  const { personId, query } = options;
  return {
    async list() {
      const rows = await api.conversationList(personId, query);
      return { threads: rows.filter((row) => row.surface === "chat").map((row) => ({
        status: "regular" as const,
        remoteId: row.id,
        title: row.title ?? undefined,
        lastMessageAt: new Date(row.last_turn_at ?? row.created_at),
        custom: { pinned: row.pinned },
      })) };
    },
    async rename(remoteId, title) { await api.renameConversation(remoteId, title); },
    // `RemoteThreadListAdapter`'s own sanctioned per-thread metadata
    // extension point (types.d.ts: `custom`/`updateCustom`, not
    // something this file invented) - the kit's own thread-list.aui.tsx
    // reads `custom.pinned` and calls this to toggle it. No `title` in
    // the PATCH body (api.ts's own `setConversationPinned`), so pinning
    // never has to know or resend the conversation's current title.
    async updateCustom(remoteId, custom) {
      if (!custom || typeof custom.pinned !== "boolean") return;
      await api.setConversationPinned(remoteId, custom.pinned);
    },
    // The shared record has no archive state. The shipped Elements menu
    // still offers Archive, so explain the unsupported action before
    // rejecting it; the runtime rolls back its own optimistic status.
    async archive() {
      toast.error("Archiving isn't available yet.");
      throw new Error("Archiving conversations is not supported.");
    },
    async unarchive() {
      toast.error("Archiving isn't available yet.");
      throw new Error("Archiving conversations is not supported.");
    },
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
