import { ExportedMessageRepository, type ThreadHistoryAdapter, type ThreadMessageLike } from "@assistant-ui/react";
import { api, type ConversationTurnWithMemoryIds } from "@/lib/api";

export type FeedbackVerdict = "positive" | "negative";

/** One {message, parentId} pair per turn's user half, in the exact branch
 * shape ExportedMessageRepository.fromBranchableArray() wants. */
export interface BranchableTurnMessages {
  user: { message: ThreadMessageLike; parentId: string | null };
  reply: { message: ThreadMessageLike; parentId: string | null };
}

/** getmaipai/home#60: rows come oldest-first (real creation order), and a
 * `supersedes` row is a genuine new database row, never a rewrite of the
 * one it replaces - the old row is untouched, still sitting earlier in
 * this same list. So a plain "each turn's user message follows the
 * previous turn's reply" chain would show every edit as one more linear
 * exchange, exactly the bug this issue is about (the branch relationship
 * survives in the data but not in what gets rendered). Rebuilt as a real
 * tree instead: a row with no `supersedes` extends the running chain
 * (`chainTail`, the previous reply); a row that supersedes turn X
 * attaches under whatever X's OWN user message's parent was - a
 * SIBLING of X, not a child of it - which is what makes
 * BranchPickerPrimitive show "1/2, 2/2" instead of two separate
 * exchanges. `parentByRowId` remembers each row's resolved parent (not
 * just its own row id) so a third edit of the same slot chains off the
 * same anchor as the first two, and the running chain always advances to
 * the newest row either way: whichever version was sent most recently is
 * the conversation's real current path, edit or not. */
export function rowsToBranchableMessages(
  rows: ConversationTurnWithMemoryIds[],
  selfName: string,
  conversationId: string,
  feedbackByTurn: ReadonlyMap<string, FeedbackVerdict> = new Map(),
): BranchableTurnMessages[] {
  const parentByRowId = new Map<string, string | null>();
  let chainTail: string | null = null;
  const out: BranchableTurnMessages[] = [];
  for (const row of rows) {
    const createdAt = new Date(row.createdAt);
    // `?? chainTail` would be wrong here: a row whose OWN parent is
    // genuinely `null` (the conversation's first message) makes
    // parentByRowId.get() return null too, and `null ?? chainTail`
    // can't tell that apart from "not found" - .has() is the real check.
    const parentId = row.supersedes && parentByRowId.has(row.supersedes) ? parentByRowId.get(row.supersedes)! : chainTail;
    parentByRowId.set(row.id, parentId);
    const userId = `${row.id}-user`;
    const replyId = `${row.id}-reply`;
    const feedbackType = feedbackByTurn.get(row.id);
    const userMessage: ThreadMessageLike = {
      id: userId,
      role: "user",
      content: row.userText,
      createdAt,
      // CHAT-20: the same memory fields the reply carries below - a
      // turn's memory belongs to the whole exchange, not one side of it
      // (`memoryRecords.source` is the turn id either way), and
      // RememberThisButton renders on this row too (thread.aui.tsx's
      // UserActionBar), reading the identical chatMemoryState.ts store
      // entry the reply's own chip does.
      metadata: { custom: { turnId: row.id, conversationId, memoryIds: row.memory_ids, judgeStatus: row.judgeStatus, source: row.source, senderName: selfName } },
    };
    const replyMessage: ThreadMessageLike = {
      id: replyId,
      role: "assistant",
      content: row.replyText,
      createdAt,
      status: { type: "complete", reason: "stop" },
      // Fix B4 (docs/dev.md's "Chat reliability" B4): chatSourceCaption.tsx
      // reads these straight off the reloaded message to show "via <package>"
      // for a non-model reply - the same row fields Fix B3
      // (conversationHistory.ts's buildConversationWindow()) already uses.
      // `judgeStatus` (CHAT-20): chatMemoryState.ts's own
      // `deriveMemoryStatus()` needs it alongside `memoryIds` and
      // `source` to tell "not yet judged" from "judged, nothing worth
      // remembering" from "a plugin turn the judge never queues."
      metadata: {
        ...(feedbackType ? { submittedFeedback: { type: feedbackType } } : {}),
        custom: {
          turnId: row.id,
          conversationId,
          memoryIds: row.memory_ids,
          judgeStatus: row.judgeStatus,
          source: row.source,
          pluginId: row.pluginId,
          commandId: row.commandId,
          documentAvailable: Boolean(row.document),
          sources: row.sources,
          media: row.media,
        },
      },
    };
    out.push({ user: { message: userMessage, parentId }, reply: { message: replyMessage, parentId: userId } });
    chainTail = replyId;
  }
  return out;
}

// Turns are persisted by the turn engine. `supersedes` (getmaipai/home#60)
// is what makes an edit-and-resend a real branch here rather than just
// another exchange in the linear history.
export function createChatHistoryAdapter(selfName: string, getConversationId: () => string | undefined): ThreadHistoryAdapter {
  return {
    async load() {
      const id = getConversationId();
      const rows = id ? await api.conversationTurns(id) : [];
      const feedback = id
        ? await Promise.all(rows.map(async (row) => [row.id, await api.conversationFeedback(row.id).catch(() => null)] as const))
        : [];
      const feedbackByTurn = new Map(
        feedback.flatMap(([turnId, value]) => (value ? [[turnId, value.verdict === "up" ? "positive" : "negative"] as const] : [])),
      );
      const turns = id ? rowsToBranchableMessages(rows, selfName, id, feedbackByTurn) : [];
      const items = turns.flatMap((t) => [t.user, t.reply]);
      const headId = turns.length > 0 ? turns[turns.length - 1]!.reply.message.id : undefined;
      return ExportedMessageRepository.fromBranchableArray(items, { headId });
    },
    async append() {},
  };
}
