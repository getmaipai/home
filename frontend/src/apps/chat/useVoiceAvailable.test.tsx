import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "@/lib/queryClient";
import { engineDownReason, useVoiceAvailable } from "@/apps/chat/useChatAvailability";

// ENGINE-DOWN-UI-01: Read aloud follows the voice service's own health row, for
// any person, and never the chat engine.
const realFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = realFetch; });

function withHealth(engines: Record<string, unknown>) {
  globalThis.fetch = mock(() => Promise.resolve(Response.json({ engines }))) as unknown as typeof fetch;
  const client = createQueryClient();
  return renderHook(() => useVoiceAvailable(), { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}

describe("useVoiceAvailable", () => {
  test("is true while voice is ready even though chat is stopped", async () => {
    const view = withHealth({ chat: { kind: "stopped", pid: null, alive: false, availability: "unavailable" }, voice: { kind: "url", pid: null, alive: true, availability: "ready" } });
    await waitFor(() => expect(view.result.current).toBe(true));
  });
  test("is false while voice is down even though chat is ready", async () => {
    const view = withHealth({ chat: { kind: "url", pid: null, alive: true, availability: "ready" }, voice: { kind: "stopped", pid: null, alive: false, availability: "unavailable" } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(view.result.current).toBe(false);
  });
  test("is false before the health row has answered", () => {
    globalThis.fetch = mock(() => new Promise(() => {})) as unknown as typeof fetch;
    const client = createQueryClient();
    const view = renderHook(() => useVoiceAvailable(), { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
    expect(view.result.current).toBe(false);
  });
});

describe("engineDownReason", () => {
  test("ready has no reason; paused and starting each have a short one", () => {
    expect(engineDownReason("ready")).toBeUndefined();
    expect(engineDownReason("unavailable")).toBe("Chat is paused");
    expect(engineDownReason("starting")).toBe("Chat is starting");
  });
});
