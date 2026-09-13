import { describe, expect, test, mock } from "bun:test";
import { forgetMessage, rememberMessage } from "@/apps/chat/chatMemoryActions";
import { useMemoryState } from "@/apps/chat/chatMemoryState";
import { renderHook } from "@testing-library/react";

function stubFetch(): { restore: () => void; calls: { url: string; body: unknown }[] } {
  const original = globalThis.fetch;
  const calls: { url: string; body: unknown }[] = [];
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    if (url.includes("/archive")) {
      return Promise.resolve(new Response(JSON.stringify({ id: "mem-1", status: "archived" }), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify({ id: "mem-1", ...body }), { status: 201 }));
  }) as unknown as typeof fetch;
  return { restore: () => (globalThis.fetch = original), calls };
}

// Reads chatMemoryState.ts's own store for a turn, without seeding it -
// the way the chip and the action-bar buttons do (a seed only fills a
// GAP, never overwrites what rememberMessage/forgetMessage already wrote).
function storedState(turnId: string) {
  const { result } = renderHook(() => useMemoryState(turnId));
  return result.current;
}

describe("rememberMessage", () => {
  // Defaults decided 2026-09-05 against memory-record.schema.json and the
  // maintenance job's decay rules (chatMemoryActions.ts's own comment has
  // the full reasoning) - this is the contract test that catches a future
  // edit silently drifting from it.
  test("posts to /api/memory with the decided one-click defaults, attributed to the turn and actor", async () => {
    const env = stubFetch();
    try {
      await rememberMessage({ text: "We're going to Boston in July", turnId: "turn-1", conversationId: "conv-1", actorId: "person-abc123" });
      expect(env.calls).toHaveLength(1);
      expect(env.calls[0]!.url).toContain("/api/memory");
      expect(env.calls[0]!.body).toEqual({
        text: "We're going to Boston in July",
        category: "fact",
        tier: "durable",
        scope: "person",
        person: "person-abc123",
        source: "turn-1",
        importance: 0.6,
      });
    } finally {
      env.restore();
    }
  });
});

describe("chatMemoryState store, updated by remember/forget", () => {
  // CHAT-20: replaces the earlier localStorage-backed map - the real
  // memory id now lives in the same store the chip and the turns-endpoint
  // poll read, so a reload isn't needed to see it, and there is nothing
  // left to persist across a reload (GET /:id/turns' own real memory_ids
  // is that source once one happens).
  test("rememberMessage() writes the real memory id into the shared store as 'saved'", async () => {
    const env = stubFetch();
    try {
      await rememberMessage({ text: "a fact", turnId: "turn-persist", conversationId: "conv-1", actorId: "person-abc123" });
      const state = storedState("turn-persist");
      expect(state).toMatchObject({ status: "saved", memoryIds: ["mem-1"] });
    } finally {
      env.restore();
    }
  });

  test("forgetMessage() archives every id it's given and clears the turn back to not_saved", async () => {
    const env = stubFetch();
    try {
      await rememberMessage({ text: "a fact", turnId: "turn-persist-2", conversationId: "conv-1", actorId: "person-abc123" });
      await forgetMessage("turn-persist-2", ["mem-1"]);
      expect(env.calls[1]!.url).toContain("/api/memory/mem-1/archive");
      const state = storedState("turn-persist-2");
      expect(state).toMatchObject({ status: "not_saved", memoryIds: [] });
    } finally {
      env.restore();
    }
  });
});

describe("forgetMessage", () => {
  test("archives the memory a prior rememberMessage() call for the same turn created", async () => {
    const env = stubFetch();
    try {
      await rememberMessage({ text: "a fact", turnId: "turn-2", conversationId: "conv-1", actorId: "person-abc123" });
      await forgetMessage("turn-2", ["mem-1"]);
      expect(env.calls[1]!.url).toContain("/api/memory/mem-1/archive");
    } finally {
      env.restore();
    }
  });

  test("does nothing (no request) when given no memory ids", async () => {
    const env = stubFetch();
    try {
      await forgetMessage("turn-never-remembered", []);
      expect(env.calls).toHaveLength(0);
    } finally {
      env.restore();
    }
  });
});
