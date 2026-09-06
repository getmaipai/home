import { describe, expect, test, mock } from "bun:test";
import { createChatHistoryAdapter, rowsToThreadMessages } from "@/apps/chat/chatHistoryAdapter";
import type { ConversationTurnRow } from "@/lib/api";

function makeRow(id: string, replyText: string): ConversationTurnRow {
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
  } as ConversationTurnRow;
}

describe("rowsToThreadMessages", () => {
  test("one row becomes a user message and a reply message, oldest first", () => {
    const rows = [makeRow("row-2", "second reply"), makeRow("row-1", "first reply")]; // newest first, like the real route
    const messages = rowsToThreadMessages(rows, "Nova");
    expect(messages.map((m) => m.id)).toEqual(["row-1-user", "row-1-reply", "row-2-user", "row-2-reply"]);
    expect(messages[0]).toMatchObject({ role: "user", content: "question row-1" });
    expect(messages[1]).toMatchObject({ role: "assistant", content: "first reply", status: { type: "complete", reason: "stop" } });
  });

  test("each pair carries the row's real id as metadata.custom.turnId - what remember/forget attribute to", () => {
    const messages = rowsToThreadMessages([makeRow("row-1", "a reply")], "Nova");
    expect(messages[0]!.metadata!.custom!.turnId).toBe("row-1");
    expect(messages[1]!.metadata!.custom!.turnId).toBe("row-1");
  });

  test("empty history maps to an empty thread", () => {
    expect(rowsToThreadMessages([], "Nova")).toEqual([]);
  });

  test("a safety-refused turn still renders both sides, not swallowed", () => {
    const row = { ...makeRow("row-1", "I can't help with that."), source: "safety_refuse" };
    const messages = rowsToThreadMessages([row], "Nova");
    expect(messages[1]).toMatchObject({ role: "assistant", content: "I can't help with that." });
  });
});

describe("createChatHistoryAdapter", () => {
  test("load() builds an ExportedMessageRepository from GET /api/conversations/turns", async () => {
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
      if (!url.endsWith("/api/conversations/turns")) throw new Error(`unexpected fetch: ${url}`);
      return Promise.resolve(new Response(JSON.stringify([makeRow("row-1", "a reply")]), { status: 200 }));
    }) as unknown as typeof fetch;
    try {
      const adapter = createChatHistoryAdapter("Nova");
      const repo = await adapter.load();
      expect(repo.messages.map(({ message }) => message.id)).toEqual(["row-1-user", "row-1-reply"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("append/update/delete are safe no-ops - the backend already persists every turn", async () => {
    const adapter = createChatHistoryAdapter("Nova");
    await expect(adapter.append({ parentId: null } as never)).resolves.toBeUndefined();
    await expect(adapter.update!({ parentId: null } as never)).resolves.toBeUndefined();
    await expect(adapter.delete!([])).resolves.toBeUndefined();
  });
});
