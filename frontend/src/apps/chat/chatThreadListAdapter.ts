import { useMemo } from "react";
import { useAui, type RemoteThreadListAdapter } from "@assistant-ui/react";
import { createAssistantStream } from "assistant-stream";
import { toast } from "sonner";
import { createChatHistoryAdapter } from "@/apps/chat/chatHistoryAdapter";
import { discardDraft } from "@/apps/chat/draftStore";
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

/** THIN-INC row 5: the live temporary threads this device has seen (listed or created). The adapter is rebuilt
 * on every Incognito toggle, so the set lives at module level. It is what Incognito may open, and what
 * turning Incognito off must clear. Ids only: no title, no text. */
const incognitoThreadIds = new Set<string>();

/** Turning Incognito off: ask the hub to forget the person's temporary sessions and drop any draft stored
 * under their ids (the composer never writes one for a temporary chat; this is the belt to that brace).
 * Local forgetting happens first and the ids are kept if the hub call fails, so a retry still clears them. */
export async function discardIncognitoThreads(personId?: string): Promise<void> {
  for (const id of incognitoThreadIds) discardDraft(id);
  await api.discardIncognitoConversations(personId);
  incognitoThreadIds.clear();
}

/** One bounded poll per conversation, shared by every caller: the runtime's own trigger after a reply and the
 * catch-up for a chat opened or returned to with no title both ask, and the hub only needs asking once. */
const titlePolls = new Map<string, Promise<string | null>>();

function pollForTitle(remoteId: string, pollMs: number, attempts: number): Promise<string | null> {
  const running = titlePolls.get(remoteId);
  if (running) return running;
  const poll = (async () => {
    let title: string | null = null;
    for (let attempt = 0; attempt < attempts && !title; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, pollMs));
      title = (await api.conversation(remoteId).catch(() => null))?.title ?? null;
    }
    return title;
  })().finally(() => titlePolls.delete(remoteId));
  titlePolls.set(remoteId, poll);
  return poll;
}

/** Whether an open chat should go looking for its title: it is a stored chat with at least one message, no
 * reply is still streaming, and no title has arrived. Nothing here writes a title; the hub owns that. */
export function needsTitleCatchUp(item: { remoteId?: string; title?: string; status?: string }, messageCount: number, isRunning: boolean, incognito: boolean): boolean {
  return !incognito && item.status === "regular" && Boolean(item.remoteId) && !item.title && messageCount > 0 && !isRunning;
}

export function createChatThreadListAdapter(selfName: string, options: ChatThreadListOptions = {}): RemoteThreadListAdapter {
  const { personId, query, incognito = false, onArchiveUnavailable, onSettingsLoaded, titlePollMs = 3000, titlePollAttempts = 40 } = options;
  return {
    async list() {
      const rows = incognito ? await api.incognitoConversationList(personId) : await api.conversationList(personId, query, "include");
      if (incognito) for (const row of rows) incognitoThreadIds.add(row.id);
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
      // A stored row for a temporary request is a leak: refuse it, never adopt it as the Incognito thread.
      if (incognito && row.mode !== "temporary") throw new Error("Incognito could not start a private chat.");
      if (incognito) incognitoThreadIds.add(row.id);
      return { remoteId: row.id };
    },
    async fetch(remoteId) {
      // Incognito opens only its own live threads, never a stored chat.
      if (incognito && !incognitoThreadIds.has(remoteId)) throw new Error("This chat is not part of Incognito.");
      const row = await api.conversation(remoteId);
      if (row.surface !== "chat") throw new Error("This conversation is not a chat.");
      return { status: "regular", remoteId: row.id, title: row.title ?? undefined };
    },
    // CHAT-TITLE-01: the hub writes a model topic title in the background once the chat has been
    // idle (backend conversationTitle.ts); this only waits for it and hands it to the list. Nothing is
    // written back and the first message is never used as a stand-in, so a chat the hub did not title
    // (Incognito, a refused title) stays "New chat" until the next list load.
    async generateTitle(remoteId) {
      const title = incognito ? null : await pollForTitle(remoteId, titlePollMs, titlePollAttempts);
      return createAssistantStream((controller) => { if (title) controller.appendText(title); });
    },
    unstable_useAdapters: function useChatAdapters() {
      const aui = useAui();
      return useMemo(() => ({ history: createChatHistoryAdapter(selfName, () => aui.threadListItem().getState().remoteId, onSettingsLoaded) }), [aui]);
    },
  };
}
