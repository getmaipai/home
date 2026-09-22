import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@maipai/ui/src/ui/tooltip";
import { NextChatPage } from "@/next/pages/NextChatPage";
import type { Roster } from "@/lib/api";
import { FakeAudioContext } from "../../../tests/fakeAudioContext";
import { ndjsonStream } from "../../../tests/ndjsonStream";

// CHAT-UI-03 (6): the rail's own default-collapsed state now reads
// `window.matchMedia("(max-width: 1024px)")` on mount - happy-dom's own
// default virtual viewport happens to match that query, which silently
// flipped every existing test's own "starts open" assumption. Stubbed
// wide (not matching) by default here so the rest of this file's own
// tests are unaffected by an environment default they never asked
// about; `stubMatchMedia(true)` opts a specific test into the narrow
// case instead.
function stubMatchMedia(matches: boolean): void {
  window.matchMedia = mock((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// A review caught this: `bunfig.toml` preloads happy-dom's `window` once
// for the whole `bun test` process, so every test FILE in one run shares
// the same global - `stubMatchMedia` overwriting it here with no restore
// would leak this file's mock into any file that runs afterward and
// reads `window.matchMedia` itself. Captured once and restored in
// `afterEach`, the same way `AudioContext` below is reset per test.
const ORIGINAL_MATCH_MEDIA = window.matchMedia;

beforeEach(() => {
  stubMatchMedia(false);
});

afterEach(() => {
  cleanup();
  window.matchMedia = ORIGINAL_MATCH_MEDIA;
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = undefined;
});

// SHELL-02 slice 4: the artifact-card/canvas-split Elements both use
// react-query (`api.artifactCurrent`) - HealthSection.test.tsx's own
// pattern, a fresh no-retry client per render so a failed fetch in one
// test doesn't hang the next on a retry backoff.
function renderPage(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // App.tsx's own tree wraps every route in TooltipProvider - the rail
  // toggle's own tooltip (CHAT-UI-03) needs it too, or Radix throws.
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>{ui}</TooltipProvider>
    </QueryClientProvider>,
  );
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

  // Slice 5(a), CHAT-UI-03's own sources follow-up (2026-09-22): a
  // turn's `sources` render through the shipped `Sources` Element
  // (elements/sources.tsx), its trigger in the assistant message's own
  // action bar (not a standalone row under the reply text anymore -
  // Jesse's own screenshots), collapsed by default per spec.md - the
  // same synthetic-tool-call-part composition this describe block's own
  // weather case already proves for the structured card, mapping
  // spec's `Source.site` onto the Element's own `domain`.
  test("a turn's sources render through a trigger in the action bar, collapsed by default", async () => {
    const SOURCE = { id: "src-tide123", kind: "web" as const, title: "Lantern Bay tide chart", url: "https://example.com/tides", site: "example.com", snippet: null, source: "turn-tide123", created_at: "2026-09-22T00:00:00.000Z", hlc: "1788000000000:0:test" };
    const restore = stubTurnFetch(
      ndjsonStream([
        { type: "delta", text: "High tide is at 4pm." },
        { type: "done", value: { turn_id: "turn-tide123", reply: { text: "High tide is at 4pm." }, source: "model", safety: SAFETY, sources: [SOURCE] } },
      ]),
    );
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/next/chat"]}>
          <NextChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await sendMessage(view, "when's high tide");
      await view.findByText("High tide is at 4pm.");
      const trigger = view.getByRole("button", { name: /Sources/ });
      expect(trigger).toBeVisible();
      // Collapsed by default - the source's own title isn't in the DOM
      // yet (a Collapsible unmounts its own content when closed).
      expect(view.queryByText("Lantern Bay tide chart")).toBeNull();
      fireEvent.click(trigger);
      expect(await view.findByText("Lantern Bay tide chart")).toBeVisible();
      // `domain` reads spec's `site`, not `url` or `id`.
      expect(view.getByText("example.com")).toBeVisible();
    } finally {
      restore();
    }
  });

  test("a reply with no sources renders no Sources trigger", async () => {
    const restore = stubTurnFetch(
      ndjsonStream([
        { type: "delta", text: "Basil and parsley are easy herbs." },
        { type: "done", value: { turn_id: "turn-herbs456", reply: { text: "Basil and parsley are easy herbs." }, source: "model", safety: SAFETY } },
      ]),
    );
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/next/chat"]}>
          <NextChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await sendMessage(view, "what herbs should I grow");
      await view.findByText("Basil and parsley are easy herbs.");
      expect(view.queryByRole("button", { name: /Sources/ })).toBeNull();
    } finally {
      restore();
    }
  });

  // TOOL-EVENTS-01's own frontend half (2026-09-22): scripted the same
  // way as the sources tests above, since no real package emits
  // tool_call/tool_result/tool_error yet (the backend half hasn't
  // landed) - proves the registration reaches the shipped ToolTimeline
  // Element, not that a real turn produces one today.
  test("a turn with tool_call/tool_result events renders through the tool timeline, collapsed by default", async () => {
    const restore = stubTurnFetch(
      ndjsonStream([
        { t: "tool_call", package_id: "websearch", args: { query: "tide chart" }, call_id: "call-1" },
        { t: "tool_result", call_id: "call-1", package_id: "websearch", outcome: { text: "3 results" } },
        { type: "delta", text: "High tide is at 4pm." },
        { type: "done", value: { turn_id: "turn-tools123", reply: { text: "High tide is at 4pm." }, source: "model", safety: SAFETY } },
      ]),
    );
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/next/chat"]}>
          <NextChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await sendMessage(view, "when's high tide");
      await view.findByText("High tide is at 4pm.");
      const trigger = view.getByRole("button", { name: /1 tool call/ });
      expect(trigger).toBeVisible();
      expect(view.queryByText("websearch")).toBeNull();
      fireEvent.click(trigger);
      expect(await view.findByText("websearch")).toBeVisible();
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

describe("NextChatPage (CHAT-UI-01 finding 4 / CHAT-UI-02: the desktop rail collapse and peek)", () => {
  // Jesse's literal spec (22:04, refined 22:22): no floating placement
  // for the column itself - it's one node (`next-chat-rail`) that always
  // lives in the page's own layout at its own slot: open is normal flow,
  // collapsed is `hidden`, peeked is the SAME node with `absolute
  // inset-y-0 left-0` inside the row's own `relative` box, at its normal
  // open width. happy-dom computes no real box layout, so "the peeked
  // box equals the open box" is proven structurally here (same node
  // reference across states, the peeked classes anchoring it to
  // left-0/inset-y-0 against the same positioned ancestor the open flow
  // already starts at, the same w-64 sizing class in both) rather than
  // by a measured rect; the live probe against 8787 is what proves the
  // actual pixels.
  // The toggle, per 22:22: open and peeked render it INLINE (true flow,
  // first cell of the header row, beside New Thread) - only collapsed
  // (no row left to be inline with) falls back to a second,
  // identically-styled instance positioned at that row's own former
  // top-left. Exactly one of the two is ever mounted at a time.
  const rail = () => document.getElementById("next-chat-rail")!;
  const classes = (el: Element) => el.className.split(/\s+/);

  test("open: the toggle is inline in the column's own header row, beside New Thread, no floating instance", async () => {
    const restore = stubFetch();
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/next/chat"]}>
          <NextChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await view.findByLabelText("Message input");
      expect(classes(rail())).toContain("w-64");
      expect(classes(rail())).not.toContain("absolute");
      const toggle = view.getByRole("button", { name: "Hide conversations" });
      expect(toggle).toHaveAttribute("aria-controls", "next-chat-rail");
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(classes(toggle)).not.toContain("absolute");
      // Inside the rail, in the same header row as New Thread - not a
      // floating sibling, not a row of its own above the column.
      expect(rail().contains(toggle)).toBe(true);
      const newThread = within(rail()).getByRole("button", { name: "New Thread" });
      expect(newThread.parentElement).toBe(toggle.parentElement);
      expect(view.queryByRole("button", { name: "Show conversations" })).toBeNull();
    } finally {
      restore();
    }
  });

  test("collapsed: the rail is hidden and out of flow, a second toggle instance takes over at the row's former top-left", async () => {
    const restore = stubFetch();
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/next/chat"]}>
          <NextChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await view.findByLabelText("Message input");
      const openToggle = view.getByRole("button", { name: "Hide conversations" });
      fireEvent.click(openToggle);
      // Hidden via a CSS class (the same `hidden` pattern the
      // phone/tablet split already used), not unmounted - a code review
      // on an earlier draft caught `railCollapsed ? null : ...` leaving
      // `aria-controls` pointing at an id absent from the DOM at the
      // exact moment it mattered most.
      expect(classes(rail())).toContain("hidden");
      expect(classes(rail())).not.toContain("absolute");
      // The inline instance is still mounted inside the now-hidden rail
      // (happy-dom applies no real stylesheet, so `hidden`'s `display:
      // none` isn't actually computed here - the live check on 8787 is
      // what proves it's actually invisible) - both it and the
      // collapsed-only instance now share the "Show conversations"
      // label, so this scopes to the one OUTSIDE the rail, the one a
      // real pointer would actually be able to reach.
      const allExpandToggles = view.getAllByRole("button", { name: "Show conversations" });
      expect(allExpandToggles).toHaveLength(2);
      const expandToggle = allExpandToggles.find((btn) => !rail().contains(btn))!;
      expect(expandToggle).toBeDefined();
      expect(classes(expandToggle)).toContain("absolute");
      expect(expandToggle).toHaveAttribute("aria-controls", "next-chat-rail");
      expect(expandToggle).toHaveAttribute("aria-expanded", "false");
      // The composer is still there - collapsing the rail never touches
      // the thread itself.
      expect(view.getByLabelText("Message input")).toBeVisible();
    } finally {
      restore();
    }
  });

  test("peeked: hovering the collapsed toggle repositions the rail onto the open box's own left edge, showing the inline toggle again; leaving closes it", async () => {
    const restore = stubFetch();
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/next/chat"]}>
          <NextChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await view.findByLabelText("Message input");
      const railNode = rail();
      fireEvent.click(view.getByRole("button", { name: "Hide conversations" }));
      // Two "Show conversations" toggles exist at this point (the inline
      // one, inert inside the now-hidden rail, and the collapsed-only
      // floating one) - the one a real pointer can actually reach is the
      // one outside the rail.
      const collapsedToggle = view.getAllByRole("button", { name: "Show conversations" }).find((btn) => !railNode.contains(btn))!;
      // A click-triggered "phantom" pointerenter (the browser recomputing
      // hover when this node mounts under a stationary pointer) is
      // suppressed until a real leave - a real hover needs one first.
      fireEvent.pointerLeave(collapsedToggle, { relatedTarget: document.body });
      fireEvent.pointerEnter(collapsedToggle);
      // Never remounted, never a second column instance - the exact same
      // node that was measured "open" a moment ago.
      expect(rail()).toBe(railNode);
      expect(classes(rail())).toEqual(expect.arrayContaining(["absolute", "inset-y-0", "left-0", "w-64"]));
      // The collapsed-only toggle instance is gone; the inline one, now
      // visible again inside the peeked rail, is what's on screen.
      expect(view.queryAllByRole("button", { name: "Show conversations" })).toHaveLength(1);
      const peekedToggle = within(rail()).getByRole("button", { name: "Show conversations" });
      expect(classes(peekedToggle)).not.toContain("absolute");
      expect(peekedToggle).toHaveAttribute("aria-expanded", "true");
      expect(within(rail()).getByRole("button", { name: "New Thread" })).toBeVisible();
      // Leaving the rail (the toggle's own real ancestor now) for
      // something outside it closes the peek.
      fireEvent.pointerLeave(rail(), { relatedTarget: document.body });
      expect(classes(rail())).toContain("hidden");
      expect(classes(rail())).not.toContain("absolute");
      // Closing re-mounts the collapsed-only instance alongside the
      // (again inert) inline one - the reachable one, outside the rail,
      // is what should report closed.
      const closedToggle = view.getAllByRole("button", { name: "Show conversations" }).find((btn) => !rail().contains(btn))!;
      expect(closedToggle).toHaveAttribute("aria-expanded", "false");
    } finally {
      restore();
    }
  });

  test("a click on the toggle still pins the column open, peek or not", async () => {
    const restore = stubFetch();
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/next/chat"]}>
          <NextChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await view.findByLabelText("Message input");
      fireEvent.click(view.getByRole("button", { name: "Hide conversations" }));
      const collapsedToggle = view.getAllByRole("button", { name: "Show conversations" }).find((btn) => !rail().contains(btn))!;
      // A real hover, not the click's own suppressed phantom enter.
      fireEvent.pointerLeave(collapsedToggle, { relatedTarget: document.body });
      fireEvent.pointerEnter(collapsedToggle);
      expect(classes(rail())).toContain("absolute");
      // Hovering swapped the collapsed-only instance for the inline one
      // now visible inside the peeked rail - that's the live instance a
      // real pointer would be over next, so the click lands on it, not
      // the (now unmounted) collapsed-only button.
      fireEvent.click(within(rail()).getByRole("button", { name: "Show conversations" }));
      expect(classes(rail())).toContain("w-64");
      expect(classes(rail())).toContain("lg:block");
      expect(classes(rail())).not.toContain("absolute");
      // Pinning open resets the peek - collapsing again later starts
      // from a real hover, not a stale peek left over from before.
      expect(view.getByRole("button", { name: "Hide conversations" })).toHaveAttribute("aria-expanded", "true");
    } finally {
      restore();
    }
  });

  test("clicking to collapse with the pointer still over the toggle's spot does not immediately re-open the peek", async () => {
    // A real defect Jesse found (Firefox, hard reload): a browser
    // recomputes what's under a stationary pointer whenever the DOM
    // changes there - clicking the open toggle unmounts it and mounts
    // the collapsed instance at the identical screen position, so the
    // browser fires a "phantom" pointerenter on the new node with no
    // real mouse movement. Before the fix, that read as a hover and
    // immediately re-opened the peek, undoing the collapse's own
    // visible effect in the same frame - from Jesse's own eyes, the
    // click did nothing.
    const restore = stubFetch();
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/next/chat"]}>
          <NextChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await view.findByLabelText("Message input");
      fireEvent.click(view.getByRole("button", { name: "Hide conversations" }));
      const collapsedToggle = view.getAllByRole("button", { name: "Show conversations" }).find((btn) => !rail().contains(btn))!;
      // The phantom pointerenter a real browser fires on the freshly-
      // mounted node, pointer never having actually moved.
      fireEvent.pointerEnter(collapsedToggle);
      expect(classes(rail())).toContain("hidden");
      expect(classes(rail())).not.toContain("absolute");
      // Moving away for real, then back, is a genuine hover again - the
      // peek opens.
      fireEvent.pointerLeave(collapsedToggle, { relatedTarget: document.body });
      fireEvent.pointerEnter(collapsedToggle);
      expect(classes(rail())).toContain("absolute");
    } finally {
      restore();
    }
  });

  test("keyboard focus on the collapsed toggle opens the peek and moves onto the now-visible inline toggle, not lost to <body>", async () => {
    // A review on the two-instance toggle caught this: since the inline
    // and collapsed toggles are separate `Button`s and never both
    // mounted at once, focusing the one that's visible and triggering
    // the state change that swaps them unmounts the very node the
    // browser had focus on - with nothing to transfer it, focus reverts
    // to `<body>` and the next Tab restarts from the top of the
    // document instead of continuing into the now-open column.
    const restore = stubFetch();
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/next/chat"]}>
          <NextChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await view.findByLabelText("Message input");
      fireEvent.click(view.getByRole("button", { name: "Hide conversations" }));
      const collapsedToggle = view.getAllByRole("button", { name: "Show conversations" }).find((btn) => !rail().contains(btn))!;
      collapsedToggle.focus();
      fireEvent.focus(collapsedToggle);
      expect(classes(rail())).toContain("absolute");
      expect(document.activeElement).not.toBe(document.body);
      expect(document.activeElement).toBe(within(rail()).getByRole("button", { name: "Show conversations" }));
    } finally {
      restore();
    }
  });

  test("mouse-only hover never programmatically focuses the toggle", async () => {
    // A re-review on the fix above caught this: its first version used
    // `document.activeElement === document.body` as the signal that
    // focus needed following - a check that can't tell "the toggle a
    // person was tabbed onto just unmounted" apart from "nothing has
    // ever been focused," true for every mouse-only visitor
    // (`onPointerEnter` shares the same peek-opening logic `onFocus`
    // does). That would have had keyboard focus silently forced onto
    // the toggle despite never touching a keyboard. Proven directly
    // here, on the toggle's own `.focus()` method, rather than on
    // `document.activeElement` globally: this page has an unrelated,
    // pre-existing element that already holds focus across renders for
    // reasons of its own (present before this item, confirmed against
    // the pre-rebuild file too), so the global active element isn't a
    // stable signal to assert against in this suite - whether THIS
    // toggle's own `.focus()` was ever called is.
    const restore = stubFetch();
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/next/chat"]}>
          <NextChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await view.findByLabelText("Message input");
      fireEvent.click(view.getByRole("button", { name: "Hide conversations" }));
      const collapsedToggle = view.getAllByRole("button", { name: "Show conversations" }).find((btn) => !rail().contains(btn))!;
      let collapsedFocusCalled = false;
      collapsedToggle.focus = () => {
        collapsedFocusCalled = true;
      };
      // A real hover, not the click's own suppressed phantom enter.
      fireEvent.pointerLeave(collapsedToggle, { relatedTarget: document.body });
      fireEvent.pointerEnter(collapsedToggle);
      expect(classes(rail())).toContain("absolute");
      expect(collapsedFocusCalled).toBe(false);
      const inlineToggle = within(rail()).getByRole("button", { name: "Show conversations" });
      let inlineFocusCalled = false;
      inlineToggle.focus = () => {
        inlineFocusCalled = true;
      };
      fireEvent.pointerLeave(rail(), { relatedTarget: document.body });
      expect(classes(rail())).toContain("hidden");
      expect(inlineFocusCalled).toBe(false);
    } finally {
      restore();
    }
  });

  test("below the auto-collapse width, the column starts collapsed by default - hover-to-peek and click-to-pin still work", async () => {
    // CHAT-UI-03 (6): Jesse's own side-by-side against ChatGPT at a
    // narrow window - ChatGPT collapses its sidebar rather than letting
    // it cover the conversation; ours kept the column open and cut off
    // the greeting and composer underneath it. This is a DEFAULT, not a
    // lock - the same hover/click controls the wide-viewport tests
    // above already exercise still work identically once collapsed.
    stubMatchMedia(true);
    const restore = stubFetch();
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/next/chat"]}>
          <NextChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await view.findByLabelText("Message input");
      expect(classes(rail())).toContain("hidden");
      expect(classes(rail())).not.toContain("absolute");
      const collapsedToggle = view.getAllByRole("button", { name: "Show conversations" }).find((btn) => !rail().contains(btn))!;
      fireEvent.pointerEnter(collapsedToggle);
      expect(classes(rail())).toContain("absolute");
      fireEvent.click(within(rail()).getByRole("button", { name: "Show conversations" }));
      expect(classes(rail())).toContain("w-64");
      expect(classes(rail())).not.toContain("absolute");
    } finally {
      restore();
    }
  });
});

describe("NextChatPage (ADMIN-COMPARE-01: compare with the bare model)", () => {
  function makeAdultPerson(): Roster {
    return { ...makePerson(), id: "person-adult456", display_name: "Marlow", role: "adult" };
  }

  // stubTurnFetch's own shape (SHELL-02 slice 3, above), plus POST
  // /api/turn/bare - a fresh ndjsonStream() per call, not one shared
  // stream object, since the panel mounts twice at once (the desktop
  // pane and the mobile Sheet, the identical doubling ArtifactCanvasPanel
  // already has) and a stream can only be read once.
  function stubCompareFetch(bareEvents: unknown[]): () => void {
    const original = globalThis.fetch;
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/conversations") && init?.method === "POST") return Promise.resolve(Response.json({ id: "conv-compare123", status: "open", surface: "chat" }));
      if (url.includes("/api/conversations")) return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      if (url.includes("/api/turn/bare")) return Promise.resolve(new Response(ndjsonStream(bareEvents), { status: 200, headers: { "content-type": "application/x-ndjson" } }));
      if (url.includes("/api/turn/stream")) {
        return Promise.resolve(
          new Response(
            ndjsonStream([
              { type: "delta", text: "It's sunny." },
              { type: "done", value: { turn_id: "turn-compare123", conversation_id: "conv-compare123", reply: { text: "It's sunny." }, source: "model", safety: SAFETY } },
            ]),
            { status: 200, headers: { "content-type": "application/x-ndjson" } },
          ),
        );
      }
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

  // chatMemoryChip.test.tsx's own established fix: Radix's DropdownMenu
  // trigger (ActionBarMorePrimitive, radix-ui underneath) opens on
  // pointerdown, not a plain click - happy-dom's click alone leaves it
  // closed.
  async function openMoreMenu(view: ReturnType<typeof render>): Promise<void> {
    const trigger = await view.findByRole("button", { name: "More" });
    act(() => {
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1 });
      fireEvent.click(trigger);
    });
  }

  const TRACE_EVENT = {
    type: "trace",
    trace: {
      rung: "model_knowledge",
      rules: ["signal.rule"],
      routing_tier: null,
      routing_score: null,
      guard_reason: null,
      source: "model",
      plugin_id: null,
      command_id: null,
      stats: { prompt_tokens: 10, predicted_tokens: 5, tokens_per_second: 20, time_to_first_token_ms: 40, total_time_ms: 200, context_tokens: 10, context_used_percent: null, cache_reuse_tokens: null, cache_reuse_percent: null, engine: "local family.gguf", stop_reason: "stop", thinking: true },
      persona_fragments: "Warm and concise.",
    },
  };

  test("the owner sees Compare with the bare model in the More menu, and it opens a two-column view", async () => {
    const restore = stubCompareFetch([TRACE_EVENT, { type: "delta", text: "It's " }, { type: "delta", text: "probably sunny too." }, { type: "done" }]);
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/next/chat"]}>
          <NextChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await sendMessage(view, "what's the weather");
      expect(await view.findByText("It's sunny.")).toBeVisible();
      await openMoreMenu(view);
      const compareItem = await view.findByText("Compare with the bare model");
      fireEvent.click(compareItem);
      // Two mounts at once (the desktop pane and the mobile Sheet) - the
      // same reason the artifact panel's own test scopes to the dialog.
      const dialogTitle = await view.findByRole("heading", { name: "Compare with the bare model" });
      const dialog = within(dialogTitle.closest('[role="dialog"]')!);
      expect(await dialog.findByText("It's sunny.")).toBeVisible();
      expect(await dialog.findByText("It's probably sunny too.")).toBeVisible();
      expect(await dialog.findByText(/Thinking: on/)).toBeVisible();
      expect(await dialog.findByText(/Rung: model_knowledge/)).toBeVisible();
      expect(await dialog.findByText(/Warm and concise\./)).toBeVisible();
    } finally {
      restore();
    }
  });

  test("a non-admin household member never sees Compare with the bare model", async () => {
    const restore = stubCompareFetch([]);
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/next/chat"]}>
          <NextChatPage person={makeAdultPerson()} />
        </MemoryRouter>,
      );
      await sendMessage(view, "what's the weather");
      expect(await view.findByText("It's sunny.")).toBeVisible();
      await openMoreMenu(view);
      // The menu itself still works - Export as Markdown is the kit's
      // own unconditional item - proven open before asserting the
      // admin-only item's absence, so a menu that never opened at all
      // can't read as "correctly hidden."
      expect(await view.findByText("Export as Markdown")).toBeVisible();
      expect(view.queryByText("Compare with the bare model")).toBeNull();
    } finally {
      restore();
    }
  });

  test("a refused bare reply shows the refusal, not the unsafe text", async () => {
    const restore = stubCompareFetch([TRACE_EVENT, { type: "refused" }]);
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/next/chat"]}>
          <NextChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await sendMessage(view, "what's the weather");
      await openMoreMenu(view);
      fireEvent.click(await view.findByText("Compare with the bare model"));
      const dialogTitle = await view.findByRole("heading", { name: "Compare with the bare model" });
      const dialog = within(dialogTitle.closest('[role="dialog"]')!);
      expect(await dialog.findByText(/refused/i)).toBeVisible();
    } finally {
      restore();
    }
  });
});
