import type { ConversationTurnRow } from "@/lib/api";
import type { ThreadMessage } from "@/kit/primitives/MessageThread";

// ConversationTurnRow is one row per turn (userText+replyText pair);
// message_thread wants one sender+text per entry, so each row becomes two
// thread entries here (a client-side concern, not a backend change: see
// this slice's write-up in docs/dev.md). Rows arrive newest-first
// (lib/conversationHistory.ts's list()); the thread renders oldest-first.
export function rowsToMessages(rows: ConversationTurnRow[], selfName: string): ThreadMessage[] {
  const out: ThreadMessage[] = [];
  for (const row of [...rows].reverse()) {
    out.push({ id: `${row.id}-user`, sender: selfName, text: row.userText, isSelf: true });
    out.push({ id: `${row.id}-reply`, sender: "MaiPai", text: row.replyText, isSelf: false });
  }
  return out;
}
