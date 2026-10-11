import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "@/lib/queryClient";
import { useChatComposerNotice } from "@/apps/chat/useChatAvailability";

// STATUS-REASON-01: chat is up, but the Chat status app is degraded for a
// reason other than search (an optional part). The composer says so.
const realFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = realFetch; });

const READY = { chat: { kind: "url", pid: null, alive: true, availability: "ready" } };

function view(apps: unknown[], person: { role: string; age_band: string }) {
  globalThis.fetch = mock((url: string | URL | Request) =>
    Promise.resolve(Response.json(String(url).includes("/api/status/apps") ? apps : { engines: READY }))) as unknown as typeof fetch;
  const client = createQueryClient();
  return renderHook(() => useChatComposerNotice(person as never), { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}
const chat = (reason: string) => [{ id: "chat", name: "Chat", state: "degraded", reason }];

describe("useChatComposerNotice for a degraded Chat app", () => {
  test("owner sees the reason and the Repairs link", async () => {
    const v = view(chat("Chat is working, but Memory isn't running."), { role: "owner", age_band: "adult" });
    await waitFor(() => expect(v.result.current).toEqual({ text: "Chat is working, but Memory isn't running.", repairsLink: "Open Repairs" }));
  });
  test("a non-admin gets a plain line with no part names and no link", async () => {
    const v = view(chat("Chat is working, but Memory isn't running."), { role: "adult", age_band: "adult" });
    await waitFor(() => expect(v.result.current).toEqual({ text: "Some chat features may be limited right now.", repairsLink: null }));
  });
  test("search-limited keeps its own text", async () => {
    const v = view(chat("Household web search isn't reachable."), { role: "owner", age_band: "adult" });
    await waitFor(() => expect(v.result.current).toEqual({ text: "Searches may be limited right now.", repairsLink: null }));
  });
  test("an operational Chat app shows nothing", async () => {
    const v = view([{ id: "chat", name: "Chat", state: "operational", reason: null }], { role: "owner", age_band: "adult" });
    await new Promise((r) => setTimeout(r, 50));
    expect(v.result.current).toBeNull();
  });
});
