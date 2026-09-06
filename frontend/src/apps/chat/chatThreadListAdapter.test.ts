import { describe, expect, test } from "bun:test";
import { createChatThreadListAdapter } from "@/apps/chat/chatThreadListAdapter";
import type { ThreadMessage } from "@assistant-ui/react";

function fakeUserMessage(text: string): ThreadMessage {
  return {
    id: "msg-1",
    createdAt: new Date("2026-09-05T00:00:00.000Z"),
    role: "user",
    content: [{ type: "text", text }],
    attachments: [],
    metadata: { custom: {} },
  };
}

// Mocked (docs/plans/session-b-ui.md step 4): the backend has exactly one
// conversation per person until Session A's per-thread routes land, so
// this adapter maps everything onto that one thread rather than real
// CRUD - these tests check the mock's own contract (a stable remoteId,
// rename/fetch reflecting it back), not real persistence.
describe("createChatThreadListAdapter", () => {
  test("list() returns exactly one thread", async () => {
    const adapter = createChatThreadListAdapter("Nova");
    const { threads } = await adapter.list();
    expect(threads).toHaveLength(1);
    expect(threads[0]!.title).toBe("Chat");
  });

  test("initialize() and fetch() agree on the same remoteId - there is nowhere else for a thread to go yet", async () => {
    const adapter = createChatThreadListAdapter("Nova");
    const { remoteId } = await adapter.initialize("local-thread-1");
    const fetched = await adapter.fetch(remoteId);
    expect(fetched.remoteId).toBe(remoteId);
  });

  test("rename() is reflected by a later list()/fetch()", async () => {
    const adapter = createChatThreadListAdapter("Nova");
    await adapter.rename("main", "Weekend plans");
    const { threads } = await adapter.list();
    expect(threads[0]!.title).toBe("Weekend plans");
    expect((await adapter.fetch("main")).title).toBe("Weekend plans");
  });

  test("archive/unarchive/delete are safe no-ops on the one real conversation", async () => {
    const adapter = createChatThreadListAdapter("Nova");
    await expect(adapter.archive("main")).resolves.toBeUndefined();
    await expect(adapter.unarchive("main")).resolves.toBeUndefined();
    await expect(adapter.delete("main")).resolves.toBeUndefined();
  });

  test("generateTitle() derives a title from the first user message, no model call", async () => {
    const adapter = createChatThreadListAdapter("Nova");
    const stream = await adapter.generateTitle("main", [fakeUserMessage("What's the weather in Boston?")]);
    let text = "";
    // ReadableStream isn't typed as AsyncIterable in lib.dom.d.ts even
    // though every real engine (including Bun) implements it - a known
    // TS/DOM-lib gap, not a real type mismatch.
    for await (const chunk of stream as unknown as AsyncIterable<{ type: string; textDelta?: string }>) {
      if (chunk.type === "text-delta" && chunk.textDelta) text += chunk.textDelta;
    }
    expect(text).toBe("What's the weather in Boston?");
  });

  test("unstable_useAdapters supplies the real history adapter for the one thread", () => {
    const adapter = createChatThreadListAdapter("Nova");
    const adapters = adapter.unstable_useAdapters!();
    expect(adapters?.history).toBeDefined();
  });
});
