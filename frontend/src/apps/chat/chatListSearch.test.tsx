import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { useChatContentMatches } from "@/apps/chat/chatListSearch";

const originalFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

describe("useChatContentMatches", () => {
  test("asks the hub's title-and-message index once typing settles, and returns the matching chat ids", async () => {
    const paths: string[] = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      paths.push(String(input));
      return Response.json([{ id: "conv-lake", title: null, surface: "chat", created_at: "2026-09-07T00:00:00Z", last_turn_at: null, pinned: false, archived: false }]);
    }) as unknown as typeof fetch;
    const { result, rerender } = renderHook(({ q }) => useChatContentMatches(q, 10), { initialProps: { q: "" } });
    expect(result.current).toBeNull();
    rerender({ q: "s" });
    rerender({ q: "sunscreen" });
    await waitFor(() => expect([...(result.current ?? [])]).toEqual(["conv-lake"]));
    expect(paths).toEqual(["/api/conversations?q=sunscreen&archived=include"]);
  });

  test("clearing the search drops the matches, and a failed lookup falls back to title-only", async () => {
    globalThis.fetch = mock(async () => Response.json({ error: "down" }, { status: 500 })) as unknown as typeof fetch;
    const { result, rerender } = renderHook(({ q }) => useChatContentMatches(q, 10), { initialProps: { q: "lake" } });
    await Bun.sleep(40);
    expect(result.current).toBeNull();
    rerender({ q: "" });
    expect(result.current).toBeNull();
  });
});
