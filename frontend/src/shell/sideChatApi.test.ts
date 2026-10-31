import { afterEach, describe, expect, mock, test } from "bun:test";
import { api } from "@/lib/api";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe("side conversation API", () => {
  test("creates one side conversation with its companion and temporary mode", async () => {
    let requestBody: unknown;
    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return Response.json({ id: "side-1" });
    }) as unknown as typeof fetch;

    const created = await api.createConversation("temporary", undefined, undefined, "companion-1", "side");
    expect(created.id).toBe("side-1");
    expect(requestBody).toEqual({ surface: "chat", placement: "side", mode: "temporary", companion_id: "companion-1" });
  });

  test("creates a bot side chat with device_id", async () => {
    let requestBody: unknown;
    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return Response.json({ id: "bot-side-1" });
    }) as unknown as typeof fetch;
    await api.createConversation(undefined, undefined, undefined, "companion-1", "side", "robot-1");
    expect(requestBody).toEqual({ surface: "chat", placement: "side", companion_id: "companion-1", device_id: "robot-1" });
  });

  test("lists all placements and hands a side conversation to Chat", async () => {
    const requested: Array<{ url: string; method: string; body?: unknown }> = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      requested.push({
        url: String(input),
        method: init?.method ?? "GET",
        ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
      });
      return Response.json([]);
    }) as unknown as typeof fetch;

    await api.conversationList(undefined, undefined, "include", "all");
    await api.setConversationPlacement("side-1", "chat");
    expect(requested[0]?.url).toContain("placement=all");
    expect(requested[1]?.method).toBe("PATCH");
    expect(requested[1]?.body).toEqual({ placement: "chat" });
  });
});
