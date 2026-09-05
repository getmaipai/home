import { describe, test, expect, mock, afterEach } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ChatPage } from "@/apps/chat/ChatPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { FakeAudioContext } from "../../../tests/fakeAudioContext";
import { ndjsonStream } from "../../../tests/ndjsonStream";
import type { Roster } from "@/lib/api";

afterEach(() => {
  cleanup();
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = undefined;
});

function makePerson(): Roster {
  return {
    id: "person-abc123",
    display_name: "Nova",
    nickname: null,
    role: "owner",
    avatar_seed: "person-abc123",
    source: "hub",
    local_only: false,
    created_at: "2026-09-04T00:00:00.000Z",
    updated_at: "2026-09-04T00:00:00.000Z",
    deleted_at: null,
    hasSecret: true,
  };
}

const SAFETY = { flagged: false, categories: [], action: "allow" as const, notify_parent: false, matched_signals: [], checked_at: "2026-09-04T00:00:00.000Z" };

function stubFetch(options: { ttsCalls?: string[] } = {}): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/conversations")) return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
    if (url.includes("/api/plugins")) return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
    if (url.includes("/api/notifications")) return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
    if (url.includes("/api/turn/stream")) {
      return Promise.resolve(
        new Response(
          ndjsonStream([
            { type: "delta", text: "A canned reply." },
            { type: "done", value: { reply: { text: "A canned reply." }, source: "model", safety: SAFETY } },
          ]),
          { status: 200, headers: { "content-type": "application/x-ndjson" } },
        ),
      );
    }
    if (url.includes("/api/tts")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { text?: string };
      options.ttsCalls?.push(body.text ?? "");
      const header = new Uint8Array(44);
      const view = new DataView(header.buffer);
      const writeString = (offset: number, s: string) => {
        for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
      };
      writeString(0, "RIFF");
      writeString(8, "WAVE");
      writeString(12, "fmt ");
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, 24_000, true);
      view.setUint16(34, 16, true);
      writeString(36, "data");
      return Promise.resolve(new Response(header.buffer as ArrayBuffer, { status: 200, headers: { "content-type": "audio/wav" } }));
    }
    throw new Error(`unstubbed fetch: ${url}`);
  }) as unknown as typeof fetch;
  return () => (globalThis.fetch = original);
}

// The full assistant-ui wiring (useRemoteThreadListRuntime wrapping
// useLocalRuntime, the mocked thread-list and suggestion adapters, the
// actor context) is exercised end to end here; the delicate streaming/
// think-tag/TTS logic itself has its own direct unit tests
// (chatModelAdapter.test.ts) rather than being re-verified through a full
// render, per the plan's own testing split.
//
// "Remember this"/"Forget this" (chatActionBar.tsx) live inside
// assistant-ui's ActionBarMorePrimitive, a Radix popover-style menu that
// - unlike NotificationBell.tsx's simpler RadixPopover, which DOES open
// under plain fireEvent.click in this same test environment - never
// actually opens its content under happy-dom no matter how it's
// triggered (confirmed: the click lands, no exception, but the content
// never mounts): a real environment gap, not a lead worth chasing
// further given the underlying functions are unit-tested directly
// (chatMemoryActions.test.ts) and the click-through was verified live in
// the running app instead.
describe("ChatPage", () => {
  test("renders the composer once history loads, without crashing", async () => {
    const restore = stubFetch();
    try {
      const { findByLabelText } = renderWithQueryClient(<ChatPage person={makePerson()} />);
      await findByLabelText("Message input");
    } finally {
      restore();
    }
  });

  test("Listen on a sent reply calls /api/tts with that reply's text", async () => {
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    const ttsCalls: string[] = [];
    const restore = stubFetch({ ttsCalls });
    try {
      const { findByLabelText, findByText, findByRole } = renderWithQueryClient(<ChatPage person={makePerson()} />);
      const input = await findByLabelText("Message input");
      fireEvent.change(input, { target: { value: "hi there" } });
      fireEvent.click(await findByLabelText("Send message"));
      await findByText("A canned reply.");
      // A fresh reply already speaks itself once automatically as it
      // streams in (chatModelAdapter.ts) - Listen adds a second, on-demand
      // call for the same text, not the only one.
      fireEvent.click(await findByRole("button", { name: "Listen" }));
      await waitFor(() => expect(ttsCalls.length).toBeGreaterThanOrEqual(2));
      expect(ttsCalls.every((call) => call === "A canned reply.")).toBe(true);
    } finally {
      restore();
    }
  });
});
