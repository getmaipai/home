import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { toast } from "sonner";
import { createChatThreadListAdapter, discardIncognitoThreads, needsTitleCatchUp } from "@/apps/chat/chatThreadListAdapter";
import { api } from "@/lib/api";
import type { ThreadMessage } from "@assistant-ui/react";

async function readTextDeltas(stream: ReadableStream<{ type: string; textDelta?: string }>, into: string[]): Promise<void> {
  const reader = stream.getReader();
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    if (read.value.type === "text-delta") into.push(read.value.textDelta ?? "");
  }
}

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
      if (path.startsWith("/api/conversations?") || path === "/api/conversations") return Response.json([...saved.values()]);
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

  test("the automatic title is the model's topic title from the server, never the first message cut off, and is not written back", async () => {
    const calls: string[] = [];
    let polls = 0;
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${String(input)}`);
      polls++;
      // The hub writes the title in the background after the first exchange: absent on the first look.
      return Response.json({ id: "conv-example123", title: polls < 3 ? null : "Garden layout" });
    }) as unknown as typeof fetch;
    const message: ThreadMessage = { id: "msg-1", createdAt: new Date(), role: "user", content: [{ type: "text", text: "Plan a garden" }], attachments: [], metadata: { custom: {} } };
    const stream = await createChatThreadListAdapter("Nova", { titlePollMs: 1 }).generateTitle("conv-example123", [message]);
    const parts: string[] = [];
    await readTextDeltas(stream, parts);
    expect(parts.join("")).toBe("Garden layout");
    expect(calls.every((call) => call.startsWith("GET "))).toBe(true);
  });

  test("when the hub never writes a title the stream is empty and nothing is renamed", async () => {
    const methods: string[] = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      // Only this chat's own requests count: a request from another test's still-mounted component can reach this mock.
      if (String(input).endsWith("/conv-example123")) methods.push(init?.method ?? "GET");
      return Response.json({ id: "conv-example123", title: null });
    }) as unknown as typeof fetch;
    const message: ThreadMessage = { id: "msg-1", createdAt: new Date(), role: "user", content: [{ type: "text", text: "Plan a garden" }], attachments: [], metadata: { custom: {} } };
    const stream = await createChatThreadListAdapter("Nova", { titlePollMs: 1, titlePollAttempts: 3 }).generateTitle("conv-example123", [message]);
    const parts: string[] = [];
    await readTextDeltas(stream, parts);
    expect(parts).toEqual([]);
    expect(methods).toEqual(["GET", "GET", "GET"]);
  });

  test("server failures reject rename and delete instead of pretending to persist", async () => {
    globalThis.fetch = mock(async () => Response.json({ error: "Cannot save" }, { status: 500 })) as unknown as typeof fetch;
    const adapter = createChatThreadListAdapter("Nova");
    await expect(adapter.rename("conv-example123", "Garden")).rejects.toThrow();
    await expect(adapter.delete("conv-example123")).rejects.toThrow();
  });

  test("archive and unarchive persist through the hub, and the list reports archived chats with their status", async () => {
    const bodies: Array<{ method: string; path: string; body: unknown }> = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (init?.method === "PATCH") {
        bodies.push({ method: "PATCH", path, body: JSON.parse(String(init.body)) });
        return Response.json({});
      }
      bodies.push({ method: "GET", path, body: undefined });
      return Response.json([
        { id: "conv-live", title: "Keep this chat", surface: "chat", created_at: "2026-09-07T00:00:00Z", last_turn_at: null, pinned: false, archived: false },
        { id: "conv-shelved", title: "Shelved chat", surface: "chat", created_at: "2026-09-06T00:00:00Z", last_turn_at: null, pinned: false, archived: true },
      ]);
    }) as unknown as typeof fetch;
    const adapter = createChatThreadListAdapter("Nova");
    const { threads } = await adapter.list();
    expect(bodies[0]!.path).toBe("/api/conversations?archived=include");
    expect(threads.map((t) => [t.remoteId, t.status])).toEqual([["conv-live", "regular"], ["conv-shelved", "archived"]]);
    await adapter.archive("conv-live");
    await adapter.unarchive("conv-shelved");
    expect(bodies.slice(1)).toEqual([
      { method: "PATCH", path: "/api/conversations/conv-live", body: { archived: true } },
      { method: "PATCH", path: "/api/conversations/conv-shelved", body: { archived: false } },
    ]);
  });

  test("a failed archive rejects so the runtime rolls back, and says so", async () => {
    const errorToast = spyOn(toast, "error");
    try {
      globalThis.fetch = mock(async () => Response.json({ error: "Cannot save" }, { status: 500 })) as unknown as typeof fetch;
      await expect(createChatThreadListAdapter("Nova").archive("conv-archive")).rejects.toThrow();
      expect(errorToast).toHaveBeenCalledWith("Could not archive this chat. Try again.");
    } finally {
      errorToast.mockRestore();
    }
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
      if (path === "/api/conversations?archived=include" && method === "GET") return Response.json([{ ...saved, surface: "chat", created_at: "2026-09-07T00:00:00Z", last_turn_at: null }]);
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

  test("Incognito uses the dedicated session list and does not fetch the durable list", async () => {
    let requestedPath = "";
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      requestedPath = String(input);
      return Response.json([{ id: "conv-live-incognito", title: null, surface: "chat", created_at: "2026-09-25T00:00:00Z", last_turn_at: null, pinned: false }]);
    }) as unknown as typeof fetch;
    const result = await createChatThreadListAdapter("Nova", { incognito: true }).list();
    expect(requestedPath).toBe("/api/conversations/incognito");
    expect(result.threads.map((thread) => thread.remoteId)).toEqual(["conv-live-incognito"]);
  });

  // Issue #163: initialize() used to call POST /api/conversations with no
  // mode at all, whatever `incognito` this adapter was built with - a real,
  // durable conversation minted before the first message (carrying
  // `temporary: true`) ever went out. The fix is this one request body.
  test("a temporary-chat adapter's initialize() asks the server for a temporary conversation, not a durable one", async () => {
    let requestedBody: unknown;
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/conversations");
      requestedBody = JSON.parse(String(init?.body));
      return Response.json({ id: "conv-temp-1", title: null, surface: "chat", mode: "temporary", created_at: "2026-09-26T00:00:00Z", pinned: false }, { status: 201 });
    }) as unknown as typeof fetch;
    const { remoteId } = await createChatThreadListAdapter("Nova", { incognito: true }).initialize("local-temp");
    expect(requestedBody).toEqual({ surface: "chat", mode: "temporary" });
    expect(remoteId).toBe("conv-temp-1");
  });

  test("an ordinary adapter's initialize() sends no mode at all", async () => {
    let requestedBody: unknown;
    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestedBody = JSON.parse(String(init?.body));
      return Response.json({ id: "conv-regular-1", title: null, surface: "chat", mode: "chat", created_at: "2026-09-26T00:00:00Z", pinned: false }, { status: 201 });
    }) as unknown as typeof fetch;
    await createChatThreadListAdapter("Nova").initialize("local-regular");
    expect(requestedBody).toEqual({ surface: "chat" });
  });
});

// THIN-INC row 5 (docs/BACKLOG.md): while Incognito is on the list is exclusive (only the live temporary
// thread, no stored chat listed or opened) and turning it off discards that thread with no draft left behind.
describe("THIN-INC row 5: the Incognito thread list", () => {
  const temporaryRow = (id: string) => ({ id, title: null, surface: "chat", mode: "temporary", created_at: "2026-10-03T00:00:00Z", last_turn_at: null, pinned: false, archived: false });
  const draftKey = (id: string) => `maipai:chat-draft:${id}`;
  afterEach(async () => {
    globalThis.fetch = mock(async () => Response.json({ discarded: 0 })) as unknown as typeof fetch;
    await discardIncognitoThreads();
    window.localStorage.clear();
  });

  test("an Incognito session only ever talks to the temporary routes: list, initialize and fetch never touch the stored list", async () => {
    const requests: string[] = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      requests.push(`${init?.method ?? "GET"} ${path}`);
      if (path === "/api/conversations" && init?.method === "POST") return Response.json(temporaryRow("conv-temp-nova"), { status: 201 });
      if (path === "/api/conversations/incognito") return Response.json([temporaryRow("conv-temp-nova")]);
      return Response.json(temporaryRow("conv-temp-nova"));
    }) as unknown as typeof fetch;
    const adapter = createChatThreadListAdapter("Nova", { incognito: true });
    await adapter.initialize("local-temp");
    await adapter.list();
    await adapter.fetch("conv-temp-nova");
    expect(requests.filter((request) => request.startsWith("GET /api/conversations?"))).toEqual([]);
    expect(requests).toContain("GET /api/conversations/incognito");
  });

  test("Incognito never opens a stored chat: fetch of an id the temporary list never held rejects without a request", async () => {
    const requests: string[] = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      requests.push(String(input));
      return Response.json({ id: "conv-stored-iris", title: "Taxes", surface: "chat", mode: "chat", created_at: "2026-09-07T00:00:00Z", pinned: false });
    }) as unknown as typeof fetch;
    await expect(createChatThreadListAdapter("Nova", { incognito: true }).fetch("conv-stored-iris")).rejects.toThrow();
    expect(requests).toEqual([]);
  });

  test("Incognito still opens its own live thread once the temporary list or initialize has named it", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/conversations/incognito") return Response.json([temporaryRow("conv-temp-listed")]);
      return Response.json(temporaryRow("conv-temp-listed"));
    }) as unknown as typeof fetch;
    const adapter = createChatThreadListAdapter("Nova", { incognito: true });
    await adapter.list();
    expect((await adapter.fetch("conv-temp-listed")).remoteId).toBe("conv-temp-listed");
  });

  test("if the hub answers an Incognito initialize with a stored row, the adapter refuses it instead of adopting it", async () => {
    globalThis.fetch = mock(async () => Response.json({ id: "conv-durable-leak", title: null, surface: "chat", mode: "chat", created_at: "2026-10-03T00:00:00Z", pinned: false }, { status: 201 })) as unknown as typeof fetch;
    await expect(createChatThreadListAdapter("Nova", { incognito: true }).initialize("local-temp")).rejects.toThrow();
  });

  test("an Incognito thread never writes a draft: initialize, list and fetch leave storage untouched", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/conversations/incognito") return Response.json([temporaryRow("conv-temp-ember")]);
      return Response.json(temporaryRow("conv-temp-ember"), { status: init?.method === "POST" ? 201 : 200 });
    }) as unknown as typeof fetch;
    const adapter = createChatThreadListAdapter("Nova", { incognito: true });
    await adapter.initialize("local-temp");
    await adapter.list();
    await adapter.fetch("conv-temp-ember");
    expect(window.localStorage.length).toBe(0);
  });

  test("turning Incognito off discards the hub's temporary sessions and any draft under their ids, and leaves stored chats' drafts alone", async () => {
    const requests: string[] = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(`${init?.method ?? "GET"} ${String(input)}`);
      if (String(input) === "/api/conversations/incognito/discard") return Response.json({ discarded: 1 });
      if (String(input) === "/api/conversations/incognito") return Response.json([temporaryRow("conv-temp-quill")]);
      return Response.json(temporaryRow("conv-temp-quill"), { status: 201 });
    }) as unknown as typeof fetch;
    const adapter = createChatThreadListAdapter("Nova", { incognito: true });
    await adapter.initialize("local-temp");
    await adapter.list();
    window.localStorage.setItem(draftKey("conv-temp-quill"), JSON.stringify({ text: "private", savedAt: "2026-10-03T00:00:00Z" }));
    window.localStorage.setItem(draftKey("conv-stored-oliver"), JSON.stringify({ text: "keep me", savedAt: "2026-10-03T00:00:00Z" }));
    await discardIncognitoThreads();
    expect(requests).toContain("POST /api/conversations/incognito/discard");
    expect(window.localStorage.getItem(draftKey("conv-temp-quill"))).toBeNull();
    expect(window.localStorage.getItem(draftKey("conv-stored-oliver"))).not.toBeNull();
    // The discarded thread is no longer this device's to open.
    await expect(createChatThreadListAdapter("Nova", { incognito: true }).fetch("conv-temp-quill")).rejects.toThrow();
  });

  test("a failed discard keeps the thread known so the next attempt can still clear it, and the error reaches the caller", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/conversations/incognito/discard") return Response.json({ error: "down" }, { status: 500 });
      return Response.json(temporaryRow("conv-temp-sage"), { status: 201 });
    }) as unknown as typeof fetch;
    await createChatThreadListAdapter("Nova", { incognito: true }).initialize("local-temp");
    window.localStorage.setItem(draftKey("conv-temp-sage"), JSON.stringify({ text: "x", savedAt: "2026-10-03T00:00:00Z" }));
    await expect(discardIncognitoThreads()).rejects.toThrow();
    expect(window.localStorage.getItem(draftKey("conv-temp-sage"))).toBeNull();
  });
});

describe("a title that arrives while the person was away (TITLEBUG)", () => {
  const message: ThreadMessage = { id: "msg-1", createdAt: new Date(), role: "user", content: [{ type: "text", text: "Plan a garden" }], attachments: [], metadata: { custom: {} } };

  test("a poll that gave up before the hub titled the chat is replaced by a fresh adapter's poll after remount", async () => {
    let title: string | null = null;
    globalThis.fetch = mock(async () => Response.json({ id: "conv-away1", title })) as unknown as typeof fetch;
    // The page was left: the first adapter's short poll ended with nothing.
    const before: string[] = [];
    await readTextDeltas(await createChatThreadListAdapter("Nova", { titlePollMs: 1, titlePollAttempts: 2 }).generateTitle("conv-away1", [message]), before);
    expect(before).toEqual([]);
    // The hub titles the chat while nobody is looking; the remounted page builds a new adapter and asks again.
    title = "Garden layout";
    const after: string[] = [];
    await readTextDeltas(await createChatThreadListAdapter("Nova", { titlePollMs: 1 }).generateTitle("conv-away1", [message]), after);
    expect(after.join("")).toBe("Garden layout");
  });

  test("two callers asking for the same chat share one poll", async () => {
    let gets = 0;
    globalThis.fetch = mock(async () => {
      gets++;
      return Response.json({ id: "conv-away2", title: gets < 3 ? null : "Garden layout" });
    }) as unknown as typeof fetch;
    const adapter = createChatThreadListAdapter("Nova", { titlePollMs: 1 });
    const [a, b] = await Promise.all([adapter.generateTitle("conv-away2", [message]), adapter.generateTitle("conv-away2", [message])]);
    const first: string[] = [];
    const second: string[] = [];
    await Promise.all([readTextDeltas(a, first), readTextDeltas(b, second)]);
    expect(first.join("")).toBe("Garden layout");
    expect(second.join("")).toBe("Garden layout");
    expect(gets).toBe(3);
  });

  test("Incognito never asks the hub for a title", async () => {
    const fetched = mock(async () => Response.json({ id: "conv-away3", title: "Should not be read" }));
    globalThis.fetch = fetched as unknown as typeof fetch;
    const parts: string[] = [];
    await readTextDeltas(await createChatThreadListAdapter("Nova", { incognito: true, titlePollMs: 1 }).generateTitle("conv-away3", [message]), parts);
    expect(parts).toEqual([]);
    expect(fetched).not.toHaveBeenCalled();
  });

  test("an open chat goes looking for its title only when it is stored, has messages, is idle and has no title", () => {
    const open = { remoteId: "conv-away4", title: undefined, status: "regular" };
    expect(needsTitleCatchUp(open, 2, false, false)).toBe(true);
    expect(needsTitleCatchUp({ ...open, title: "Garden layout" }, 2, false, false)).toBe(false);
    expect(needsTitleCatchUp(open, 0, false, false)).toBe(false);
    expect(needsTitleCatchUp(open, 2, true, false)).toBe(false);
    expect(needsTitleCatchUp(open, 2, false, true)).toBe(false);
    expect(needsTitleCatchUp({ ...open, remoteId: undefined }, 2, false, false)).toBe(false);
    expect(needsTitleCatchUp({ ...open, status: "new" }, 2, false, false)).toBe(false);
  });
});
