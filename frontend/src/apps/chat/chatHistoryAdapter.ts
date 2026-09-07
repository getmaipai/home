import { ExportedMessageRepository, type ThreadHistoryAdapter, type ThreadMessageLike } from "@assistant-ui/react";
import { api, type ConversationTurnWithMemoryIds } from "@/lib/api";

// ConversationTurnRow is one row per turn (userText+replyText pair);
// assistant-ui wants one message per sender, so each row becomes two
// entries here (a client-side concern, not a backend change - see this
// slice's write-up in docs/dev.md, carried over from the pre-assistant-ui
// mapRows.ts this replaces). Rows arrive newest-first
// (lib/conversationHistory.ts's list()); ExportedMessageRepository wants
// them oldest-first with explicit parent links so it can chain them into
// one branch.
//
// `metadata.custom.turnId` carries the row's real id - the chat action
// bar's "remember this"/"forget this" (chatMemoryActions.ts) need a real
// turn id to attribute a memory's `source` to, which only a HISTORY
// message has today (session-a-intelligence.md's `turn_meta`/
// `done.value.turn_id`, the live-stream source for this, hasn't landed
// yet). A message from the CURRENT live session has no turnId until a
// reload re-fetches it from here - those two actions disable themselves
// on such a message rather than guessing at an id (chatActionBar.tsx).
//
// `metadata.custom.memoryIds` (getmaipai/home#64) carries whatever the
// row's own `memory_ids` says - every memory record whose provenance
// names this turn, on the assistant message only (chatMemoryChip.tsx
// renders per assistant message, and one `conversation_turns` row is one
// whole exchange, so there is nothing separate to attribute to the user
// half). Real data from list()'s own join
// (backend/src/lib/conversationHistory.ts), not a notification payload
// that was never actually sent (the bug this replaces).
export function rowsToThreadMessages(rows: ConversationTurnWithMemoryIds[], selfName: string): ThreadMessageLike[] {
  const out: ThreadMessageLike[] = [];
  for (const row of [...rows].reverse()) {
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

// The backend already persists every turn server-side (turnEngine.ts,
// through POST /api/turn/stream) independent of anything this adapter
// does - `append`/`update`/`delete` genuinely have nothing left to do,
// unlike a client-only or third-party-backed runtime where the adapter
// IS the persistence layer. Required by the interface regardless (no
// optional `?` on `append`); the honest implementation is a no-op, not a
// stub pretending to write somewhere.
export function createChatHistoryAdapter(selfName: string): ThreadHistoryAdapter {
  return {
    async load() {
      const rows = await api.conversations();
      return ExportedMessageRepository.fromArray(rowsToThreadMessages(rows, selfName));
    },
    async append() {},
    async update() {},
    async delete() {},
  };
}
