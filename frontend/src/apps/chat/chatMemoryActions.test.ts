import { describe, expect, test, mock } from "bun:test";
import { forgetMessage, rememberMessage } from "@/apps/chat/chatMemoryActions";

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

describe("rememberMessage", () => {
  // Defaults decided 2026-09-05 against memory-record.schema.json and the
  // maintenance job's decay rules (chatMemoryActions.ts's own comment has
  // the full reasoning) - this is the contract test that catches a future
  // edit silently drifting from it.
  test("posts to /api/memory with the decided one-click defaults", async () => {
    const env = stubFetch();
    try {
      await rememberMessage({ text: "We're going to Boston in July", turnId: "turn-1", actorId: "person-abc123" });
      expect(env.calls).toHaveLength(1);
      expect(env.calls[0]!.url).toContain("/api/memory");
      expect(env.calls[0]!.body).toEqual({
        text: "We're going to Boston in July",
        category: "fact",
        tier: "durable",
        scope: "person",
        person: "person-abc123",
        importance: 0.6,
      });
    } finally {
      env.restore();
    }
  });
});

describe("remembered-id persistence", () => {
  // A code review (2026-09-05) found the earlier in-memory-only version
  // lost this the moment the page reloaded (chatHistoryAdapter.ts's
  // load() runs on every mount), even though the memory record itself
  // was still real - a second "remember this" click on the same message
  // in a later session would have silently created a duplicate record.
  test("survives what a reload would do: the id is readable from localStorage after rememberMessage()", async () => {
    const env = stubFetch();
    try {
      await rememberMessage({ text: "a fact", turnId: "turn-persist", actorId: "person-abc123" });
      const stored = JSON.parse(localStorage.getItem("maipai.chat.rememberedByTurnId") ?? "{}");
      expect(stored["turn-persist"]).toBe("mem-1");
    } finally {
      env.restore();
      localStorage.removeItem("maipai.chat.rememberedByTurnId");
    }
  });

  test("forgetMessage() removes the turn from localStorage too", async () => {
    const env = stubFetch();
    try {
      await rememberMessage({ text: "a fact", turnId: "turn-persist-2", actorId: "person-abc123" });
      await forgetMessage("turn-persist-2");
      const stored = JSON.parse(localStorage.getItem("maipai.chat.rememberedByTurnId") ?? "{}");
      expect(stored["turn-persist-2"]).toBeUndefined();
    } finally {
      env.restore();
      localStorage.removeItem("maipai.chat.rememberedByTurnId");
    }
  });
});

describe("forgetMessage", () => {
  test("archives the memory a prior rememberMessage() call for the same turn created", async () => {
    const env = stubFetch();
    try {
      await rememberMessage({ text: "a fact", turnId: "turn-2", actorId: "person-abc123" });
      await forgetMessage("turn-2");
      expect(env.calls[1]!.url).toContain("/api/memory/mem-1/archive");
    } finally {
      env.restore();
    }
  });

  test("does nothing for a turn nothing was ever remembered from", async () => {
    const env = stubFetch();
    try {
      await forgetMessage("turn-never-remembered");
      expect(env.calls).toHaveLength(0);
    } finally {
      env.restore();
    }
  });
});
