import { afterEach, describe, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { NextChatPage } from "@/next/pages/NextChatPage";
import type { Roster } from "@/lib/api";
import { FakeAudioContext } from "../../../tests/fakeAudioContext";
import { ndjsonStream } from "../../../tests/ndjsonStream";

afterEach(() => {
  cleanup();
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = undefined;
});

// SHELL-02 slice 4: the artifact-card/canvas-split Elements both use
// react-query (`api.artifactCurrent`) - HealthSection.test.tsx's own
// pattern, a fresh no-retry client per render so a failed fetch in one
// test doesn't hang the next on a retry backoff.
function renderPage(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

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
    enabled: true,
    guest_expires_at: null,
    memorialized_at: null,
    hlc: "1788000000000:0:test",
    hasSecret: true,
  };
}

// The thread-list runtime lists conversations on mount (slice 2's own
// createChatThreadListAdapter) - a bare Response.json([]) is enough for
// a smoke test that only needs the composer and an empty thread list to
// render without throwing.
function stubFetch(): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/conversations")) return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

describe("NextChatPage (SHELL-02's first slice)", () => {
  // findByLabelText (not getByLabelText): AuiProvider's own mount does an
  // async state update (the same "assistant-ui async init" ChatPage.test.tsx
  // already works around with findBy queries) - a synchronous get here
  // still passes but throws a React "not wrapped in act()" console warning.
  test("mounts the Elements composer, ready for a real turn", async () => {
    const restore = stubFetch();
    try {
      const { findByLabelText } = renderPage(
        <MemoryRouter initialEntries={["/next/chat"]}>
          <NextChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      expect(await findByLabelText("Message input")).toBeVisible();
    } finally {
      restore();
    }
  });
});

describe("NextChatPage (SHELL-02's slice 2: the thread list)", () => {
  test("shows New Thread and an empty thread list with no past conversations", async () => {
    const restore = stubFetch();
    try {
      const { findByText } = renderPage(
        <MemoryRouter initialEntries={["/next/chat"]}>
          <NextChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      expect(await findByText("New Thread")).toBeVisible();
    } finally {
      restore();
    }
  });

  test("a past conversation's real title renders in the list", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/conversations")) {
        return Promise.resolve(
          Response.json([{ id: "conv-past123", title: "A past chat", surface: "chat", created_at: "2026-09-07T00:00:00Z", pinned: false }]),
        );
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;
    try {
      const { findByText } = renderPage(
        <MemoryRouter initialEntries={["/next/chat"]}>
          <NextChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      expect(await findByText("A past chat")).toBeVisible();
    } finally {
      globalThis.fetch = original;
    }
  });

  // Found live, on 8787, verifying this slice: clicking "New Thread"
  // from the phone/tablet Sheet started a fresh conversation but left
  // the Sheet open over it, blocking the composer until it was
  // manually dismissed - `NextThreadList`'s own composed `onClick` on
  // `ThreadListNew` (not the shipped `<ThreadList>`, which hardcodes
  // it with no hook) is the fix. ChatPage.test.tsx's own sibling test
  // ("thread history opens as a phone sheet...") is the pattern this
  // mirrors: the Sheet's own heading, not the toggle button, proves
  // open/closed once Radix aria-hides the rest of the page.
  test("New Thread closes the phone/tablet Sheet, the same as selecting a past conversation", async () => {
    const restore = stubFetch();
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/next/chat"]}>
          <NextChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await view.findByLabelText("Message input");
      fireEvent.click(view.getByRole("button", { name: "Show threads" }));
      const dialog = await view.findByRole("heading", { name: "Conversations" });
      fireEvent.click(within(dialog.closest('[role="dialog"]')!).getByText("New Thread"));
      await view.findByRole("button", { name: "Show threads" });
      expect(view.queryByRole("heading", { name: "Conversations" })).toBeNull();
    } finally {
      restore();
    }
  });
});

const SAFETY = { flagged: false, categories: [], action: "allow" as const, notify_parent: false, matched_signals: [], checked_at: "2026-09-04T00:00:00.000Z" };

describe("NextChatPage (SHELL-02's slice 3: tools and generative UI)", () => {
  // A real turn end to end: initialize (POST /api/conversations), resume,
  // then the streamed reply - ChatPage.test.tsx's own stubFetch shape,
  // narrowed to what a send from this page actually calls.
  function stubTurnFetch(streamBody: ReadableStream<Uint8Array>): () => void {
    const original = globalThis.fetch;
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/conversations") && init?.method === "POST") return Promise.resolve(Response.json({ id: "conv-weather123", status: "open", surface: "chat" }));
      if (url.includes("/api/conversations")) return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      if (url.includes("/api/turn/stream")) return Promise.resolve(new Response(streamBody, { status: 200, headers: { "content-type": "application/x-ndjson" } }));
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;
    return () => {
      globalThis.fetch = original;
    };
  }

  // ChatPage.test.tsx's own sendMessage helper: the Send button starts
  // disabled (a readiness check, not just an empty composer), so a
  // click that races it does nothing.
  async function sendMessage(view: ReturnType<typeof render>, text: string): Promise<void> {
    fireEvent.change(await view.findByLabelText("Message input"), { target: { value: text } });
    const send = (await view.findByLabelText("Send message")) as HTMLButtonElement;
    await waitFor(() => expect(send.disabled).toBe(false));
    fireEvent.click(send);
  }

  test("a weather turn's structured result renders through the spec-sheet Element, not prose", async () => {
    const structuredPart = { kind: "spec_sheet" as const, tool_id: "weather", title: "Lantern Bay", rows: [{ label: "Temperature", value: "61°F" }] };
    const restore = stubTurnFetch(
      ndjsonStream([
        { type: "delta", text: "It's 61°F in Lantern Bay." },
        { type: "done", value: { turn_id: "turn-weather123", reply: { text: "It's 61°F in Lantern Bay." }, source: "plugin", safety: SAFETY, structured_part: structuredPart } },
      ]),
    );
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/next/chat"]}>
          <NextChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await sendMessage(view, "what's the weather");
      // The spec-sheet's own title/row, not the reply text repeating it -
      // proves the structured part actually reached SpecSheet, not just
      // that the turn completed.
      expect(await view.findByText("Lantern Bay")).toBeVisible();
      expect(await view.findByText("Temperature")).toBeVisible();
      expect(await view.findByText("61°F")).toBeVisible();
    } finally {
      restore();
    }
  });

  test("a plain-text reply renders no spec-sheet, unchanged", async () => {
    const restore = stubTurnFetch(
      ndjsonStream([
        { type: "delta", text: "Basil and parsley are easy herbs." },
        { type: "done", value: { turn_id: "turn-herbs123", reply: { text: "Basil and parsley are easy herbs." }, source: "model", safety: SAFETY } },
      ]),
    );
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/next/chat"]}>
          <NextChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await sendMessage(view, "what herbs should I grow");
      expect(await view.findByText("Basil and parsley are easy herbs.")).toBeVisible();
      expect(view.queryByText("Lantern Bay")).toBeNull();
    } finally {
      restore();
    }
  });
});

describe("NextChatPage (SHELL-02's slice 4: artifacts)", () => {
  const ARTIFACT = {
    id: "art-example123",
    conversation_id: "conv-artifact123",
    turn_id: "turn-artifact123",
    kind: "markdown" as const,
    title: "Pizza night",
    body: "Every Friday night.",
    version: 1,
    parent_version: null,
    created_by: "person-abc123",
    provenance: "artifact-tool:turn-artifact123",
    created_at: "2026-09-21T00:00:00.000Z",
    hlc: "1788000000000:0:test",
  };

  // stubTurnFetch's own shape, plus GET /api/artifacts/:id/current -
  // the same route ArtifactCardToolRender and ArtifactCanvasPanel both
  // call (api.artifactCurrent), never the bare per-version GET.
  function stubArtifactTurnFetch(streamBody: ReadableStream<Uint8Array>): () => void {
    const original = globalThis.fetch;
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/conversations") && init?.method === "POST") return Promise.resolve(Response.json({ id: "conv-artifact123", status: "open", surface: "chat" }));
      if (url.includes("/api/conversations")) return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      if (url.includes(`/api/artifacts/${ARTIFACT.id}/current`)) return Promise.resolve(Response.json(ARTIFACT));
      if (url.includes("/api/turn/stream")) return Promise.resolve(new Response(streamBody, { status: 200, headers: { "content-type": "application/x-ndjson" } }));
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;
    return () => {
      globalThis.fetch = original;
    };
  }

  async function sendMessage(view: ReturnType<typeof render>, text: string): Promise<void> {
    fireEvent.change(await view.findByLabelText("Message input"), { target: { value: text } });
    const send = (await view.findByLabelText("Send message")) as HTMLButtonElement;
    await waitFor(() => expect(send.disabled).toBe(false));
    fireEvent.click(send);
  }

  test("a write_document turn renders an artifact card; clicking it opens the canvas with the real document, closing it keeps the thread", async () => {
    const restore = stubArtifactTurnFetch(
      ndjsonStream([
        { type: "delta", text: "Wrote it." },
        {
          type: "done",
          value: {
            turn_id: "turn-artifact123",
            reply: { text: "Wrote it." },
            source: "plugin",
            plugin_id: "write_document",
            safety: SAFETY,
            artifact: { id: ARTIFACT.id, version: ARTIFACT.version },
          },
        },
      ]),
    );
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/next/chat"]}>
          <NextChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await sendMessage(view, "write me a short note about pizza night");
      expect(await view.findByText("Wrote it.")).toBeVisible();
      // The card's own fetched title, not a placeholder - proves the
      // artifact tool-call part reached ArtifactCard through a real
      // api.artifactCurrent() round trip, not just that the turn
      // completed.
      const card = await view.findByText(ARTIFACT.title);
      fireEvent.click(card);
      // Two mounts of the same panel exist in jsdom at once (the
      // desktop pane, CSS-hidden below `lg`, and the phone/tablet
      // Sheet, a real Radix dialog only mounted while open) - the same
      // reason "New Thread closes the phone/tablet Sheet" above scopes
      // to the dialog rather than querying the whole document. The
      // Sheet's own sr-only title is the scoping handle here.
      const dialogTitle = await view.findByRole("heading", { name: "Document" });
      const dialog = within(dialogTitle.closest('[role="dialog"]')!);
      expect(await dialog.findByText("Every Friday night.")).toBeVisible();
      fireEvent.click(dialog.getByRole("button", { name: "Close the canvas" }));
      await waitFor(() => expect(view.queryByRole("heading", { name: "Document" })).toBeNull());
      // Closing the canvas never touches the thread.
      expect(view.getByText("Wrote it.")).toBeVisible();
    } finally {
      restore();
    }
  });
});
