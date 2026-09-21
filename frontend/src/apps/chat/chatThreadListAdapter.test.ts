import { afterEach, describe, expect, mock, test } from "bun:test";
import { createChatThreadListAdapter } from "@/apps/chat/chatThreadListAdapter";
import { api } from "@/lib/api";
import type { ThreadMessage } from "@assistant-ui/react";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe("saved conversations", () => {
  test("new chats have distinct persistent ids, titles survive remount, and deletion survives reload", async () => {
    const saved = new Map<string, { id: string; title: string | null; surface: string; created_at: string; pinned: boolean }>();
    let sequence = 0;
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? "GET";
      const id = path.split("/").pop()!;
      if (path === "/api/conversations" && method === "POST") {
        const row = { id: `conv-example${++sequence}`, title: null, surface: "chat", created_at: "2026-09-07T00:00:00Z", pinned: false };
        saved.set(row.id, row);
        return Response.json(row, { status: 201 });
      }
      if (path === "/api/conversations") return Response.json([...saved.values()]);
      const row = saved.get(id);
      if (!row) return Response.json({ error: "conversation not found" }, { status: 404 });
      if (method === "PATCH") row.title = JSON.parse(String(init?.body)).title;
      if (method === "DELETE") saved.delete(id);
      return Response.json(row);
    }) as unknown as typeof fetch;
    const adapter = createChatThreadListAdapter("Nova");
    const a = await adapter.initialize("local-a");
    const b = await adapter.initialize("local-b");
    expect(a.remoteId).not.toBe(b.remoteId);
    await adapter.rename(a.remoteId, "Garden");
    const reloaded = createChatThreadListAdapter("Nova");
    expect((await reloaded.fetch(a.remoteId)).title).toBe("Garden");
    expect((await reloaded.list()).threads.map((row) => row.remoteId)).toEqual([a.remoteId, b.remoteId]);
    await reloaded.delete(b.remoteId);
    expect((await createChatThreadListAdapter("Nova").list()).threads.map((row) => row.remoteId)).toEqual([a.remoteId]);
  });

  test("automatic titles are saved before being displayed", async () => {
    let savedTitle = "";
    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe("PATCH");
      savedTitle = JSON.parse(String(init?.body)).title;
      return Response.json({});
    }) as unknown as typeof fetch;
    const message: ThreadMessage = { id: "msg-1", createdAt: new Date(), role: "user", content: [{ type: "text", text: "Plan a garden" }], attachments: [], metadata: { custom: {} } };
    await createChatThreadListAdapter("Nova").generateTitle("conv-example123", [message]);
    expect(savedTitle).toBe("Plan a garden");
  });

  test("server failures reject rename and delete instead of pretending to persist", async () => {
    globalThis.fetch = mock(async () => Response.json({ error: "Cannot save" }, { status: 500 })) as unknown as typeof fetch;
    const adapter = createChatThreadListAdapter("Nova");
    await expect(adapter.rename("conv-example123", "Garden")).rejects.toThrow();
    await expect(adapter.delete("conv-example123")).rejects.toThrow();
  });
});

// HOME-UI-02e: ConversationsPage's own real functions restored into
// Chat's thread list - each covered by the test BACKLOG.md's own exit
// check names, rather than one broad smoke test.
describe("HOME-UI-02e: restored Conversations functions", () => {
  test("a person picker: an admin viewing a child's own id lists only that child's conversations", async () => {
    let requestedPath = "";
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      requestedPath = String(input);
      return Response.json([{ id: "conv-child-1", title: "Child's chat", surface: "chat", created_at: "2026-09-07T00:00:00Z", last_turn_at: null, pinned: false }]);
    }) as unknown as typeof fetch;
    const adapter = createChatThreadListAdapter("Nova", { personId: "person-child" });
    const result = await adapter.list();
    expect(requestedPath).toContain("person=person-child");
    expect(result.threads.map((t) => t.remoteId)).toEqual(["conv-child-1"]);
  });

  test("batch delete removes exactly the selected threads in one request", async () => {
    let requestedBody: unknown;
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/conversations/batch-delete");
      expect(init?.method).toBe("POST");
      requestedBody = JSON.parse(String(init?.body));
      return Response.json({ deleted: 2 });
    }) as unknown as typeof fetch;
    const result = await api.batchDeleteConversations(["conv-a", "conv-b"]);
    expect(requestedBody).toEqual({ ids: ["conv-a", "conv-b"] });
    expect(result.deleted).toBe(2);
  });

  test("clear all posts with no ids - it clears the caller's own list, not a chosen selection", async () => {
    let called = false;
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/conversations/clear");
      expect(init?.method).toBe("POST");
      called = true;
      return Response.json({ deleted: 5 });
    }) as unknown as typeof fetch;
    const result = await api.clearConversations();
    expect(called).toBe(true);
    expect(result.deleted).toBe(5);
  });

  test("pin survives a reload, and toggling it never resends the title", async () => {
    const saved = { id: "conv-pin", title: "Keep this title", pinned: false };
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? "GET";
      if (path === "/api/conversations" && method === "GET") return Response.json([{ ...saved, surface: "chat", created_at: "2026-09-07T00:00:00Z", last_turn_at: null }]);
      if (path === `/api/conversations/${saved.id}` && method === "PATCH") {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect("title" in body).toBe(false);
        saved.pinned = body.pinned as boolean;
        return Response.json(saved);
      }
      throw new Error(`unexpected request: ${method} ${path}`);
    }) as unknown as typeof fetch;
    const adapter = createChatThreadListAdapter("Nova");
    await adapter.updateCustom?.(saved.id, { pinned: true });
    expect(saved.title).toBe("Keep this title");
    const reloaded = await createChatThreadListAdapter("Nova").list();
    expect(reloaded.threads[0]!.custom).toEqual({ pinned: true });
  });

  test("message-body search finds a thread whose title never mentions the query", async () => {
    let requestedPath = "";
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      requestedPath = String(input);
      // The server's own listConversations() matches turn text too, not
      // just the title (conversationHistory.ts) - this fake just proves
      // the adapter passes the query through and trusts the response,
      // not that the LIKE search itself works (that's
      // conversationHistory.test.ts's own job).
      return Response.json([{ id: "conv-body-match", title: "Tuesday", surface: "chat", created_at: "2026-09-07T00:00:00Z", last_turn_at: null, pinned: false }]);
    }) as unknown as typeof fetch;
    const result = await createChatThreadListAdapter("Nova", { query: "compost" }).list();
    expect(requestedPath).toContain("q=compost");
    expect(result.threads.map((t) => t.remoteId)).toEqual(["conv-body-match"]);
  });
});
