import { useMemo } from "react";
import { useAui, type RemoteThreadListAdapter } from "@assistant-ui/react";
import { createAssistantStream } from "assistant-stream";
import { toast } from "sonner";
import { createChatHistoryAdapter } from "@/apps/chat/chatHistoryAdapter";
import { api } from "@/lib/api";
import type { Conversation } from "@maipai/spec/gen/ts/conversation.js";

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
  /** When true, list the live session-only Incognito conversations. */
  incognito?: boolean;
  /** Called synchronously when an archive action is rejected by the hub. */
  onArchiveUnavailable?: (remoteId: string) => void;
  /** CHAT-TITLE-01: how often, and how many times, generateTitle looks for the hub's title (the hub
   * writes it in the background once the chat has been idle). */
  titlePollMs?: number;
  titlePollAttempts?: number;
  /** Supplies persisted settings when the active conversation history loads. */
  onSettingsLoaded?: (conversationId: string, settings: NonNullable<Conversation["settings"]> | undefined) => void;
}

export function createChatThreadListAdapter(selfName: string, options: ChatThreadListOptions = {}): RemoteThreadListAdapter {
  const { personId, query, incognito = false, onArchiveUnavailable, onSettingsLoaded, titlePollMs = 3000, titlePollAttempts = 40 } = options;
  return {
    async list() {
      const rows = incognito ? await api.incognitoConversationList(personId) : await api.conversationList(personId, query, "include");
      return { threads: rows.filter((row) => row.surface === "chat").map((row) => ({
        status: row.archived ? ("archived" as const) : ("regular" as const),
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
    // CONV-ARCHIVE-01: archive state lives on the hub (PATCH {archived}). A failure rejects so the
    // runtime rolls back its optimistic status; the toast says why nothing moved.
    async archive(remoteId) {
      try {
        await api.setConversationArchived(remoteId, true);
      } catch (error) {
        toast.error("Could not archive this chat. Try again.");
        onArchiveUnavailable?.(remoteId);
        throw error;
      }
    },
    async unarchive(remoteId) {
      try {
        await api.setConversationArchived(remoteId, false);
      } catch (error) {
        toast.error("Could not restore this chat. Try again.");
        throw error;
      }
    },
    async delete(remoteId) { await api.deleteConversation(remoteId); },
    async initialize() {
      // Issue #163 / the persistence-boundary design (docs/plans/
      // privacy-mode-2026-09-24.md, 2026-09-26): this used to mint a
      // durable row unconditionally, before a single message existed -
      // by the time the first turn went out with `temporary: true`,
      // resolveOrCreateConversation() was handed a real id and never
      // read the flag. `incognito` is this adapter's own option
      // (already threaded into `list()`, NextChatPage.tsx's own
      // `{ incognito: temporaryNext }`); reading it here is the fix -
      // the in-memory session the backend's own createConversation()
      // already builds for `mode: "temporary"`, now actually asked for.
      const row = await api.createConversation(incognito ? "temporary" : undefined);
      return { remoteId: row.id };
    },
    async fetch(remoteId) {
      const row = await api.conversation(remoteId);
      if (row.surface !== "chat") throw new Error("This conversation is not a chat.");
      return { status: "regular", remoteId: row.id, title: row.title ?? undefined };
    },
    // CHAT-TITLE-01: the hub writes a model topic title in the background once the chat has been
    // idle (backend conversationTitle.ts); this only waits for it and hands it to the list. Nothing is
    // written back and the first message is never used as a stand-in, so a chat the hub did not title
    // (Incognito, a refused title) stays "New chat" until the next list load.
    async generateTitle(remoteId) {
      let title: string | null = null;
      if (!incognito) {
        for (let attempt = 0; attempt < titlePollAttempts && !title; attempt++) {
          if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, titlePollMs));
          title = (await api.conversation(remoteId).catch(() => null))?.title ?? null;
        }
      }
      return createAssistantStream((controller) => { if (title) controller.appendText(title); });
    },
    unstable_useAdapters: function useChatAdapters() {
      const aui = useAui();
      return useMemo(() => ({ history: createChatHistoryAdapter(selfName, () => aui.threadListItem().getState().remoteId, onSettingsLoaded) }), [aui, onSettingsLoaded]);
    },
  };
}
