import { afterEach, describe, expect, mock, test } from "bun:test";
import { createChatThreadListAdapter } from "@/apps/chat/chatThreadListAdapter";
import type { ThreadMessage } from "@assistant-ui/react";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe("saved conversations", () => {
  test("new chats have distinct persistent ids, titles survive remount, and deletion survives reload", async () => {
    const saved = new Map<string, { id: string; title: string | null; surface: string; created_at: string }>();
    let sequence = 0;
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? "GET";
      const id = path.split("/").pop()!;
      if (path === "/api/conversations" && method === "POST") {
        const row = { id: `conv-example${++sequence}`, title: null, surface: "chat", created_at: "2026-09-07T00:00:00Z" };
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
