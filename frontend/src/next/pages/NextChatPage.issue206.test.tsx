// getmaipai/home#206: the first message sent into a saved, empty chat
// vanished (the thread went back to the welcome screen) until a reload when
// the hub was slow to answer for the chat's details. The exact inputs from
// the issue: only GET /api/conversations and GET /api/conversations/<id> are
// delayed by 1500 ms; /turns and /api/turn/stream answer at once.
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { TooltipProvider } from "@maipai/ui/src/ui/tooltip";
import { NextChatPage } from "@/next/pages/NextChatPage";
import { IncognitoProvider } from "@/next/incognitoContext";
import type { Roster } from "@/lib/api";
import { FakeAudioContext } from "../../../tests/fakeAudioContext";
import { assistantStreamBody as ndjsonStream, ASSISTANT_STREAM_HEADERS } from "../../../tests/assistantStreamBody";

const ORIGINAL_MATCH_MEDIA = window.matchMedia;
beforeEach(() => {
  window.matchMedia = mock((query: string) => ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  cleanup();
  window.matchMedia = ORIGINAL_MATCH_MEDIA;
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = undefined;
});

const SAFETY = { flagged: false, categories: [], action: "allow" as const, notify_parent: false, matched_signals: [], checked_at: "2026-10-06T00:00:00.000Z" };
const CONVERSATION = { id: "conv-empty206", title: "Garden plans", surface: "chat", status: "open", created_at: "2026-10-06T00:00:00Z", pinned: false };
const SLOW_MS = 1_500;
const later = <T,>(value: () => T) => new Promise<T>((resolve) => setTimeout(() => resolve(value()), SLOW_MS));

function person(): Roster {
  return { id: "person-abc123", display_name: "Nova", nickname: null, role: "owner", avatar_seed: "person-abc123", source: "hub", local_only: false, created_at: "2026-09-04T00:00:00.000Z", updated_at: "2026-09-04T00:00:00.000Z", deleted_at: null, enabled: true, guest_expires_at: null, memorialized_at: null, hlc: "1788000000000:0:test", hasSecret: true };
}

describe("getmaipai/home#206", () => {
  test("the first message in a saved empty chat and its reply stay on screen while the hub is slow", async () => {
    const original = globalThis.fetch;
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      const path = new URL(url, "http://hub.example.com").pathname;
      if (path === "/api/conversations/conv-empty206/turns") return Promise.resolve(Response.json([]));
      if (path === "/api/conversations/conv-empty206") return later(() => Response.json(CONVERSATION));
      if (path === "/api/conversations") return later(() => Response.json([CONVERSATION]));
      if (path.startsWith("/api/conversations/conv-empty206/")) return Promise.resolve(Response.json(CONVERSATION));
      if (path === "/api/turn/stream") {
        return Promise.resolve(new Response(ndjsonStream([
          { type: "turn_meta", conversation_id: "conv-empty206", turn_id: "turn-empty206" },
          { type: "delta", text: "Tomatoes like full sun." },
          { type: "done", value: { turn_id: "turn-empty206", conversation_id: "conv-empty206", reply: { text: "Tomatoes like full sun." }, source: "model", safety: SAFETY } },
        ]), { status: 200, headers: ASSISTANT_STREAM_HEADERS }));
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;
    try {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const view = render(
        <QueryClientProvider client={client}><IncognitoProvider><TooltipProvider>
          <MemoryRouter initialEntries={["/chat?conversation=conv-empty206"]}>
            <NextChatPage person={person()} />
          </MemoryRouter>
        </TooltipProvider></IncognitoProvider></QueryClientProvider>,
      );
      fireEvent.change(await view.findByLabelText("Message input"), { target: { value: "Where should the tomatoes go?" } });
      // Send waits while the saved chat is still opening (the slow answer);
      // the typed text is still in the box once it opens.
      expect(((await view.findByLabelText("Send message")) as HTMLButtonElement).disabled).toBe(true);
      await waitFor(() => expect(((view.getByLabelText("Send message")) as HTMLButtonElement).disabled).toBe(false), { timeout: 4_000 });
      expect((view.getByLabelText("Message input") as HTMLTextAreaElement).value).toBe("Where should the tomatoes go?");
      fireEvent.click(view.getByLabelText("Send message"));
      expect(await view.findByText("Where should the tomatoes go?", {}, { timeout: 4_000 })).toBeTruthy();
      // Past the slow details answer, and then some: the turn must still be there.
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, SLOW_MS + 1_500)); });
      expect(view.queryByText("Where should the tomatoes go?")).toBeTruthy();
      expect(await view.findByText("Tomatoes like full sun.", {}, { timeout: 2_000 })).toBeTruthy();
      expect(view.queryByText("How can I help you today?")).toBeNull();
    } finally {
      globalThis.fetch = original;
    }
  }, 15_000);

  test("a saved chat that cannot be opened does not leave Send held", async () => {
    const original = globalThis.fetch;
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const path = new URL(typeof input === "string" ? input : input.toString(), "http://hub.example.com").pathname;
      if (path === "/api/conversations/conv-empty206") return Promise.resolve(Response.json({ error: "Not found" }, { status: 404 }));
      if (path.startsWith("/api/conversations")) return Promise.resolve(Response.json([]));
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;
    try {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const view = render(
        <QueryClientProvider client={client}><IncognitoProvider><TooltipProvider>
          <MemoryRouter initialEntries={["/chat?conversation=conv-empty206"]}>
            <NextChatPage person={person()} />
          </MemoryRouter>
        </TooltipProvider></IncognitoProvider></QueryClientProvider>,
      );
      fireEvent.change(await view.findByLabelText("Message input"), { target: { value: "Hello?" } });
      await waitFor(() => expect((view.getByLabelText("Send message") as HTMLButtonElement).disabled).toBe(false), { timeout: 3_000 });
    } finally {
      globalThis.fetch = original;
    }
  }, 10_000);

  test("a draft typed in a new chat before opening a saved one stays out of the saved chat", async () => {
    const original = globalThis.fetch;
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const path = new URL(typeof input === "string" ? input : input.toString(), "http://hub.example.com").pathname;
      if (path === "/api/conversations/conv-empty206/turns") return Promise.resolve(Response.json([]));
      if (path === "/api/conversations/conv-empty206") return later(() => Response.json(CONVERSATION));
      if (path === "/api/conversations") return Promise.resolve(Response.json([]));
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;
    function OpenSaved() {
      const navigate = useNavigate();
      return <button type="button" onClick={() => navigate("/chat?conversation=conv-empty206")}>Open saved chat</button>;
    }
    try {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const view = render(
        <QueryClientProvider client={client}><IncognitoProvider><TooltipProvider>
          <MemoryRouter initialEntries={["/chat"]}>
            <OpenSaved />
            <NextChatPage person={person()} />
          </MemoryRouter>
        </TooltipProvider></IncognitoProvider></QueryClientProvider>,
      );
      fireEvent.change(await view.findByLabelText("Message input"), { target: { value: "hello" } });
      fireEvent.click(view.getByRole("button", { name: "Open saved chat" }));
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, SLOW_MS + 800)); });
      expect((view.getByLabelText("Message input") as HTMLTextAreaElement).value).toBe("");
    } finally {
      globalThis.fetch = original;
    }
  }, 10_000);
});
