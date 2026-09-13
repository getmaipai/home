import { describe, expect, test, mock } from "bun:test";
import { createChatHistoryAdapter, rowsToBranchableMessages } from "@/apps/chat/chatHistoryAdapter";
import type { ConversationTurnWithMemoryIds } from "@/lib/api";

function makeRow(id: string, replyText: string, memoryIds: string[] = [], supersedes: string | null = null): ConversationTurnWithMemoryIds {
  return {
    id,
    personId: "person-abc123",
    surface: "chat",
    userText: `question ${id}`,
    replyText,
    source: "model",
    pluginId: null,
    commandId: null,
    safetyFlagged: false,
    safetyAction: "allow",
    minorSpeaker: false,
    createdAt: "2026-09-04T00:00:00.000Z",
    supersedes,
    judgeStatus: null,
    memory_ids: memoryIds,
  } as ConversationTurnWithMemoryIds;
}

// Flattens a rowsToBranchableMessages() result into the same
// {message, parentId}[] shape ExportedMessageRepository.fromBranchableArray()
// consumes, so a test can assert on parent links directly.
function flatten(turns: ReturnType<typeof rowsToBranchableMessages>) {
  return turns.flatMap((t) => [t.user, t.reply]);
}

describe("rowsToBranchableMessages", () => {
  test("one row becomes a user message and a reply message, oldest first", () => {
    const rows = [makeRow("row-1", "first reply"), makeRow("row-2", "second reply")]; // per-thread route is oldest first
    const items = flatten(rowsToBranchableMessages(rows, "Nova", "conv-example123"));
    expect(items.map(({ message }) => message.id)).toEqual(["row-1-user", "row-1-reply", "row-2-user", "row-2-reply"]);
    expect(items[0]!.message).toMatchObject({ role: "user", content: "question row-1" });
    expect(items[1]!.message).toMatchObject({ role: "assistant", content: "first reply", status: { type: "complete", reason: "stop" } });
  });

  test("each pair carries the row's real id as metadata.custom.turnId - what remember/forget attribute to", () => {
    const items = flatten(rowsToBranchableMessages([makeRow("row-1", "a reply")], "Nova", "conv-example123"));
    expect(items[0]!.message.metadata!.custom!.turnId).toBe("row-1");
    expect(items[1]!.message.metadata!.custom!.turnId).toBe("row-1");
  });

  test("empty history maps to an empty thread", () => {
    expect(rowsToBranchableMessages([], "Nova", "conv-example123")).toEqual([]);
  });

  test("a safety-refused turn still renders both sides, not swallowed", () => {
    const row = { ...makeRow("row-1", "I can't help with that."), source: "safety_refuse" };
    const items = flatten(rowsToBranchableMessages([row], "Nova", "conv-example123"));
    expect(items[1]!.message).toMatchObject({ role: "assistant", content: "I can't help with that." });
  });

  test("a linear chain: each row's user message parents off the previous row's reply", () => {
    const rows = [makeRow("row-1", "first reply"), makeRow("row-2", "second reply")];
    const items = flatten(rowsToBranchableMessages(rows, "Nova", "conv-example123"));
    expect(items[0]).toMatchObject({ parentId: null }); // the very first message in the conversation
    expect(items[1]).toMatchObject({ parentId: "row-1-user" });
    expect(items[2]).toMatchObject({ parentId: "row-1-reply" }); // row-2's user message follows row-1's reply
  });

  // getmaipai/home#60: an edited-and-resent message is a real new
  // conversation_turns row with its own id and `supersedes` pointing at
  // the row it replaces - not a rewrite of the old one. The old row's own
  // user message and the new row's user message must land as SIBLINGS
  // (the same parentId) for BranchPickerPrimitive to show "1/2, 2/2"
  // instead of two separate exchanges after a reload.
  test("a row with supersedes becomes a sibling branch of the row it replaces, not a child of it", () => {
    const rows = [makeRow("row-1", "original reply"), makeRow("row-2", "edited reply", [], "row-1")];
    const turns = rowsToBranchableMessages(rows, "Nova", "conv-example123");
    const items = flatten(turns);
    const originalUser = items.find(({ message }) => message.id === "row-1-user")!;
    const editedUser = items.find(({ message }) => message.id === "row-2-user")!;
    expect(editedUser.parentId).toBe(originalUser.parentId); // same parent = siblings = a branch, not a new exchange
    expect(editedUser.parentId).toBeNull(); // both are the conversation's very first message
  });

  test("a normal turn sent after an edit chains off the edited (newest) reply, not the original", () => {
    const rows = [makeRow("row-1", "original reply"), makeRow("row-2", "edited reply", [], "row-1"), makeRow("row-3", "third reply")];
    const items = flatten(rowsToBranchableMessages(rows, "Nova", "conv-example123"));
    const row3User = items.find(({ message }) => message.id === "row-3-user")!;
    expect(row3User.parentId).toBe("row-2-reply"); // the edit is the conversation's current path going forward
  });

  test("a second edit of the same slot chains off the same anchor as the first edit", () => {
    const rows = [
      makeRow("row-1", "original reply"),
      makeRow("row-2", "first edit", [], "row-1"),
      makeRow("row-3", "second edit", [], "row-1"),
    ];
    const items = flatten(rowsToBranchableMessages(rows, "Nova", "conv-example123"));
    const row1User = items.find(({ message }) => message.id === "row-1-user")!;
    const row3User = items.find(({ message }) => message.id === "row-3-user")!;
    expect(row3User.parentId).toBe(row1User.parentId); // a third sibling under the same original parent
  });
});

describe("createChatHistoryAdapter", () => {
  test("load() builds an ExportedMessageRepository from GET /api/conversations/conv-example123/turns", async () => {
    // Asserts the real path, not just "any fetch resolves" - a code
    // review-adjacent finding (session E step 5, 2026-09-06): the
    // previous version of this mock matched every URL unconditionally,
    // which is exactly why a real, live bug (this call still hitting the
    // bare /api/conversations after that route's own shape changed
    // out from under it, backend/src/routes/conversations.ts's own
    // comment) went uncaught by this suite.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (!url.endsWith("/api/conversations/conv-example123/turns")) throw new Error(`unexpected fetch: ${url}`);
      return Promise.resolve(new Response(JSON.stringify([makeRow("row-1", "a reply")]), { status: 200 }));
    }) as unknown as typeof fetch;
    try {
      const adapter = createChatHistoryAdapter("Nova", () => "conv-example123");
      const repo = await adapter.load();
      expect(repo.messages.map(({ message }) => message.id)).toEqual(["row-1-user", "row-1-reply"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("append is a no-op - the backend already persists every turn", async () => {
    const adapter = createChatHistoryAdapter("Nova", () => "conv-example123");
    await expect(adapter.append({ parentId: null } as never)).resolves.toBeUndefined();

  });
});

test("a new unsaved chat starts empty without reading any other conversation", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = mock(() => { throw new Error("New chat must not fetch history"); }) as unknown as typeof fetch;
  try {
    expect((await createChatHistoryAdapter("Nova", () => undefined).load()).messages).toEqual([]);
  } finally { globalThis.fetch = original; }
});
