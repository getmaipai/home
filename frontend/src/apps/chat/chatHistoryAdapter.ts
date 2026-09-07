import { ExportedMessageRepository, type ThreadHistoryAdapter, type ThreadMessageLike } from "@assistant-ui/react";
import { api, type ConversationTurnWithMemoryIds } from "@/lib/api";

// The per-conversation endpoint returns turns oldest first. Each saved
// exchange becomes two messages with its real provenance and memory ids.
export function rowsToThreadMessages(rows: ConversationTurnWithMemoryIds[], selfName: string): ThreadMessageLike[] {
  const out: ThreadMessageLike[] = [];
  for (const row of rows) {
    const createdAt = new Date(row.createdAt);
    out.push({
      id: `${row.id}-user`,
      role: "user",
      content: row.userText,
      createdAt,
      metadata: { custom: { turnId: row.id, senderName: selfName } },
    });
    out.push({
      id: `${row.id}-reply`,
      role: "assistant",
      content: row.replyText,
      createdAt,
      status: { type: "complete", reason: "stop" },
      metadata: { custom: { turnId: row.id, memoryIds: row.memory_ids } },
    });
  }
  return out;
}

// Turns are persisted by the turn engine. Branch persistence is separate
// work; this adapter only reloads the selected conversation's linear history.
export function createChatHistoryAdapter(selfName: string, getConversationId: () => string | undefined): ThreadHistoryAdapter {
  return {
    async load() {
      const id = getConversationId();
      const rows = id ? await api.conversationTurns(id) : [];
      return ExportedMessageRepository.fromArray(rowsToThreadMessages(rows, selfName));
    },
    async append() {},
  };
}
