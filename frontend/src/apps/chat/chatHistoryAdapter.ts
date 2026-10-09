import { ExportedMessageRepository, type CompleteAttachment, type ThreadHistoryAdapter, type ThreadMessageLike } from "@assistant-ui/react";
import { api, type ConversationTurnWithMemoryIds } from "@/lib/api";
import type { Conversation } from "@maipai/spec/gen/ts/conversation.js";
import { toolCallPart } from "@/apps/chat/chatToolCallPart";
import { sourceMessageParts } from "@/apps/chat/chatSources";
import { textWithAnswerImages } from "@/apps/chat/chatAnswerImages";
import { answerBlockParts } from "@/apps/chat/chatAnswerBlocks";

export type FeedbackVerdict = "positive" | "negative";

// getmaipai/home#182: a background project's finished document attaches
// to this SAME turn row minutes after its own reply already streamed
// (backend/src/lib/projects/post.ts's postProjectResult(), tagged
// `provenance: "project:<id>"` there) - the opposite time order from the
// synchronous write_document case just below, whose card belongs BEFORE
// the prose it was written alongside. The two are told apart by which
// tool actually answered this turn: backend/src/lib/projects/tool.ts's
// START_PROJECT_TOOL_ID is the only tool whose own succeeded outcome
// never itself carries an artifact (runStartProjectTool() only ever
// returns a plain "Starting <title> now…" reply), so a `row.artifact`
// riding a turn with this pluginId can only be the project's own result,
// attached after the fact - never the live write_document card, whose
// turn always carries pluginId "write_document" instead
// (backend/src/lib/composer.ts's artifactForOutcomes()).
const PROJECT_START_PLUGIN_ID = "start_project";

/** One {message, parentId} pair per turn's user half, in the exact branch
 * shape ExportedMessageRepository.fromBranchableArray() wants. */
export interface BranchableTurnMessages {
  user: { message: ThreadMessageLike; parentId: string | null };
  reply: { message: ThreadMessageLike; parentId: string | null };
}

function branchKey(parentId: string | null): string {
  return parentId ?? "<root>";
}

function compareBranchRows(a: ConversationTurnWithMemoryIds, b: ConversationTurnWithMemoryIds): number {
  const [aWall = 0, aCounter = 0] = (a.hlc ?? `${a.createdAt}:0:`).split(":").map(Number);
  const [bWall = 0, bCounter = 0] = (b.hlc ?? `${b.createdAt}:0:`).split(":").map(Number);
  if (aWall !== bWall) return aWall - bWall;
  if (aCounter !== bCounter) return aCounter - bCounter;
  return a.id.localeCompare(b.id);
}

function normalizedRows(rows: ConversationTurnWithMemoryIds[]): Array<{ row: ConversationTurnWithMemoryIds; parentId: string | null }> {
  const orderedRows = [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const parentByRowId = new Map<string, string | null>();
  let chainTail: string | null = null;
  return orderedRows.map((row) => {
    // The synced record points to a turn id, while assistant-ui's branch
    // repository points to a message id. A follow-up therefore attaches to
    // the earlier turn's assistant reply, not to the database id that is
    // absent from the message tree. Legacy rows already carry message ids
    // through the fallback chain below.
    const parentId = row.parentTurnId !== undefined
      ? row.parentTurnId === null ? null : `${row.parentTurnId}-reply`
      : row.supersedes && parentByRowId.has(row.supersedes) ? parentByRowId.get(row.supersedes)! : chainTail;
    parentByRowId.set(row.id, parentId);
    chainTail = `${row.id}-reply`;
    return { row, parentId };
  });
}

function selectedSibling(rows: Array<{ row: ConversationTurnWithMemoryIds; parentId: string | null }>): { row: ConversationTurnWithMemoryIds; parentId: string | null } | undefined {
  if (rows.length === 0) return undefined;
  const explicit = rows.some(({ row }) => row.branchChosen !== undefined);
  const candidates = explicit ? rows.filter(({ row }) => row.branchChosen !== false) : rows.slice(-1);
  return [...(candidates.length > 0 ? candidates : rows)].sort((a, b) => compareBranchRows(a.row, b.row)).at(-1);
}

export function chosenBranchHeadId(rows: ConversationTurnWithMemoryIds[]): string | undefined {
  const byParent = new Map<string, Array<{ row: ConversationTurnWithMemoryIds; parentId: string | null }>>();
  for (const normalized of normalizedRows(rows)) {
    const siblings = byParent.get(branchKey(normalized.parentId)) ?? [];
    siblings.push(normalized);
    byParent.set(branchKey(normalized.parentId), siblings);
  }
  let parentId: string | null = null;
  let head: ConversationTurnWithMemoryIds | undefined;
  const visited = new Set<string>();
  for (;;) {
    const selected = selectedSibling(byParent.get(branchKey(parentId)) ?? []);
    if (!selected || visited.has(selected.row.id)) break;
    visited.add(selected.row.id);
    head = selected.row;
    parentId = `${selected.row.id}-reply`;
  }
  return head ? `${head.id}-reply` : undefined;
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
/** Whether a stored row's outcomes (an admin's listing only) hold a failed tool call. */
function storedToolFailed(outcomes: unknown): boolean {
  if (typeof outcomes !== "string") return false;
  try {
    const parsed = JSON.parse(outcomes) as unknown;
    return Array.isArray(parsed) && parsed.some((o) => (o as { status?: unknown } | null)?.status === "failed");
  } catch {
    return false;
  }
}

/** A stored turn's `images` (UPLOAD-IMG-01's ids) as complete image
 * attachments, each served by the hub's own store. `full` because the same
 * source feeds the kit's preview dialog; `conversation_id` scopes the read. */
function sentPictureAttachments(images: NonNullable<ConversationTurnWithMemoryIds["images"]>, conversationId: string): CompleteAttachment[] {
  return images.map((image) => ({
    id: image.id,
    type: "image",
    name: image.name,
    contentType: image.media_type,
    status: { type: "complete" },
    content: [{ type: "image", image: `/api/attachments/${encodeURIComponent(image.id)}?v=full&conversation_id=${encodeURIComponent(conversationId)}`, filename: image.name }],
  }));
}

export function rowsToBranchableMessages(
  rows: ConversationTurnWithMemoryIds[],
  selfName: string,
  conversationId: string,
  feedbackByTurn: ReadonlyMap<string, FeedbackVerdict> = new Map(),
): BranchableTurnMessages[] {
  const out: BranchableTurnMessages[] = [];
  for (const { row, parentId } of normalizedRows(rows)) {
    const createdAt = new Date(row.createdAt);
    // `?? chainTail` would be wrong here: a row whose OWN parent is
    // genuinely `null` (the conversation's first message) makes
    // parentByRowId.get() return null too, and `null ?? chainTail`
    // can't tell that apart from "not found" - .has() is the real check.
    const userId = `${row.id}-user`;
    const replyId = `${row.id}-reply`;
    const feedbackType = feedbackByTurn.get(row.id);
    const userMessage: ThreadMessageLike = {
      id: userId,
      role: "user",
      content: row.userText,
      // UPLOAD-IMG-02: the person's sent pictures, rebuilt as the same
      // image attachments a live send carries, so the shipped Thread's
      // UserMessageAttachments draws them above the bubble on a reload too.
      ...(row.images?.length ? { attachments: sentPictureAttachments(row.images, conversationId) } : {}),
      createdAt,
      // CHAT-20: the same memory fields the reply carries below - a
      // turn's memory belongs to the whole exchange, not one side of it
      // (`memoryRecords.source` is the turn id either way).
      metadata: { custom: { turnId: row.id, conversationId, memoryIds: row.memory_ids, judgeStatus: row.judgeStatus, source: row.source, senderName: selfName } },
    };
    const replyMessage: ThreadMessageLike = {
      id: replyId,
      role: "assistant",
      // SHELL-02 slice 4: canvas-split's own acceptance ("this slice
      // must survive reload") - `row.artifact` ({id, version},
      // conversationHistory.ts's own reload-path twin of the live
      // `done` event's `TurnValue.artifact`) becomes the same real
      // tool-call part chatModelAdapter.ts builds live, so the
      // artifact-card Element renders identically whether this turn
      // just streamed in or came back from GET /api/conversations/:id/turns.
      // slice 5(e): the tool-call part rides before the text part, the
      // same order chatModelAdapter.ts's own live "done" event now uses -
      // a reloaded reply with an artifact should read identically to one
      // that just streamed in, card first, prose after.
      // Native source parts survive reload in the same order as the live
      // adapter, after the reply text, preserving citation numbering.
      // REASONING-04 (safety ruling, 2026-09-22): a reload renders a
      // stored reasoning value through the same Reasoning Element a live
      // turn just streamed into - reasoning-part-first, the identical
      // ordering chatModelAdapter.ts's own live "done" event already
      // uses. Never present for a minor's own turn (conversationHistory.ts's
      // read-side gate, gated on the READING actor, never even stored for
      // one going forward either) - `row.reasoning` is simply absent then.
      content:
        row.reasoning || row.structured_part || row.artifact || row.confirm || row.project || row.sources?.length || row.answer_images || row.blocks?.length
          ? [
              ...(row.reasoning ? [{ type: "reasoning" as const, text: row.reasoning }] : []),
              ...(row.structured_part ? [toolCallPart(`${row.id}-structured`, row.structured_part.tool_id, row.structured_part)] : []),
              // #182: a project-attached artifact (PROJECT_START_PLUGIN_ID
              // above) rides AFTER the text below, not here - it belongs
              // with the sources footer, since the reply it's attached to
              // genuinely came first in time.
              ...(row.artifact && row.pluginId !== PROJECT_START_PLUGIN_ID ? [toolCallPart(`${row.id}-artifact`, "write_document", row.artifact)] : []),
              // GENUI-03b: the stored answer blocks, in tool-call order, where
              // the live stream put them (before the text, like the cards above).
              ...answerBlockParts(row.blocks),
              // APPROVE-CARD-01: `row.confirm` is the reload-path twin of
              // the live "done" event's own `TurnValue.confirm`
              // (chatModelAdapter.ts) - conversationHistory.ts's own
              // listConversationTurns()/list() already derive `open`
              // fresh on every read (never trusted from what was stored
              // at write time), so no additional freshness handling is
              // needed here: `open` is already correct by the time it
              // reaches this adapter.
              // ANSWER-IMG-04: the stored picture set, where it was shown live.
              ...textWithAnswerImages(row.replyText, row.answer_images, `${row.id}-images`),
              // APPROVE-CALM-01: under the reply that asks, as live.
              ...(row.confirm ? [toolCallPart(`${row.id}-confirm`, "confirm", { package_id: row.confirm.package_id, open: row.confirm.open, turn_id: row.id })] : []),
              // PROJECT-PROGRESS-01: conversationHistory.ts's own
              // projectByTurn lookup already hides this once `row.artifact`
              // is set (the project finished and posted - the design
              // record's own "no double card"), so it's never present
              // alongside `row.artifact` above. AFTER the text, not
              // before, since 2026-09-27 (a code review caught this): a
              // still-running project's own card is a "here's what's
              // happening with that" footer, the same "compact card
              // under the reply" reasoning as native source parts and the finished
              // project artifact right above - chatModelAdapter.ts's own
              // live "done" event moved its `project` part to match
              // (Jesse found the two disagreeing live, the card visibly
              // relocating once a reload landed); leaving this ONE spot
              // still card-before-text would only have traded that jump
              // for the identical jump on a reload that catches a
              // project still running.
              ...(row.project ? [toolCallPart(`${row.id}-project`, "project", row.project)] : []),
              ...(row.artifact && row.pluginId === PROJECT_START_PLUGIN_ID ? [toolCallPart(`${row.id}-artifact`, "write_document", row.artifact)] : []),
              ...sourceMessageParts(row.sources),
            ]
          : row.replyText,
      createdAt,
      status: { type: "complete", reason: "stop" },
      // Fix B4 (docs/dev.md's "Chat reliability" B4): the retired caption
      // read these straight off the reloaded message to show "via <package>"
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
          // SAFETY-NOTICE-01: a reply that carried crisis resources keeps
          // them beside it after a reload (the hub rebuilds the block).
          ...(row.crisis_support ? { crisisSupport: row.crisis_support } : {}),
          memoryIds: row.memory_ids,
          judgeStatus: row.judgeStatus,
          source: row.source,
          pluginId: row.pluginId,
          commandId: row.commandId,
          documentAvailable: Boolean(row.document),
          media: row.media,
          media_items: row.media_items,
          stats: row.stats,
          bare: row.bare,
          // CHAT-CALM-ERRORS-01c: the reload twin of the live flags the
          // details control reads. Only an admin's rows carry the raw
          // generation errors and outcomes, so for anyone else both are false.
          failedGeneration: row.status === "failed" || Boolean(row.stats?.generations.some((g) => g.error || g.stack_error)),
          failedTool: storedToolFailed(row.outcomes),
        },
      },
    };
    out.push({ user: { message: userMessage, parentId }, reply: { message: replyMessage, parentId: userId } });
  }
  return out;
}

// Turns are persisted by the turn engine. `supersedes` (getmaipai/home#60)
// is what makes an edit-and-resend a real branch here rather than just
// another exchange in the linear history.
export function createChatHistoryAdapter(
  selfName: string,
  getConversationId: () => string | undefined,
  onSettingsLoaded?: (conversationId: string, settings: NonNullable<Conversation["settings"]> | undefined) => void,
): ThreadHistoryAdapter {
  return {
    async load() {
      const id = getConversationId();
      // getmaipai/home#206: the chat's settings arrive on their own and never
      // hold the load. The runtime replaces the thread with whatever load
      // returns, so a load held by a slow details request finished after the
      // person's first message and wiped it (and its reply) off the screen.
      if (id && onSettingsLoaded) void api.conversation(id).then((conversation) => onSettingsLoaded(id, conversation.settings), () => {});
      const rows = id ? await api.conversationTurns(id) : ([] as ConversationTurnWithMemoryIds[]);
      const feedback = id
        ? await Promise.all(rows.map(async (row) => [row.id, await api.conversationFeedback(row.id).catch(() => null)] as const))
        : [];
      const feedbackByTurn = new Map(
        feedback.flatMap(([turnId, value]) => (value ? [[turnId, value.verdict === "up" ? "positive" : "negative"] as const] : [])),
      );
      const turns = id ? rowsToBranchableMessages(rows, selfName, id, feedbackByTurn) : [];
      const items = turns.flatMap((t) => [t.user, t.reply]);
      const headId = id ? chosenBranchHeadId(rows) : undefined;
      return ExportedMessageRepository.fromBranchableArray(items, { headId });
    },
    async append() {},
  };
}
