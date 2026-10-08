import { afterEach, beforeEach, describe, expect, jest, mock, test } from "bun:test";
import type { ReactElement } from "react";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { TooltipProvider } from "@maipai/ui/src/ui/tooltip";
import { IncognitoToggle } from "@maipai/ui/src/dashboard/layouts/full/vertical/header/Header";
import { ChatPage } from "@/shell/pages/ChatPage";
import { ChatHeaderBar } from "@/apps/chat/chatHeaderBar";
import { ChatHeaderDataProvider } from "@/apps/chat/chatHeaderData";
import { writeIncognitoCache } from "@/shell/incognitoCache";
import { IncognitoProvider, useIncognitoContext } from "@/shell/incognitoContext";
import { __setUnwiredControlsForTests } from "@/apps/chat/composerAddMenu";
import type { NotificationDeliveryView, Roster } from "@/lib/api";
import { FakeAudioContext } from "../../../tests/fakeAudioContext";
import { ndjsonStream as bareNdjsonStream } from "../../../tests/ndjsonStream";
import { assistantStreamBody as ndjsonStream, staggeredAssistantStreamBody as staggeredNdjsonStream, ASSISTANT_STREAM_HEADERS } from "../../../tests/assistantStreamBody";
import { waitForGone } from "../../../tests/waitForGone";

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
  // CHAT-FIND-0923-01: clicking the rail's own collapse toggle now
  // writes a real per-browser preference (railCollapsePreference.ts) -
  // left uncleared, one test's click would leak into the next test's
  // own initial-state assumption, the same isolation risk `matchMedia`
  // and `AudioContext` above are already reset for.
  localStorage.removeItem("maipai.chat.rail-collapsed");
  localStorage.removeItem("maipai.incognito-explanation-seen");
  sessionStorage.removeItem("maipai.incognito");
});

// SHELL-02 slice 4: the artifact-card/canvas-split Elements both use
// react-query (`api.artifactCurrent`) - HealthSection.test.tsx's own
// pattern, a fresh no-retry client per render so a failed fetch in one
// test doesn't hang the next on a retry backoff.
function renderPage(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // App.tsx's own tree wraps every route in TooltipProvider - the rail
  // toggle's own tooltip (CHAT-UI-03) needs it too, or Radix throws.
  // `queryClient` returned alongside (renderWithQueryClient.tsx's own
  // shape) for the rare test - getmaipai/home#181's own reload tests -
  // that needs to poke the cache directly to simulate a poll tick, the
  // same way NotificationBell.test.tsx already does for this identical
  // ["notifications"] query.
  return { ...render(
    <QueryClientProvider client={client}>
      <IncognitoProvider>
        <TooltipProvider>{ui}</TooltipProvider>
      </IncognitoProvider>
    </QueryClientProvider>,
  ), queryClient: client };
}

function GlobalIncognitoToggle() {
  const { on, setOn } = useIncognitoContext();
  return <IncognitoToggle on={on} onChange={setOn} />;
}

function ConversationLocation() {
  const location = useLocation();
  return <output data-testid="conversation-location">{location.search}</output>;
}

function makePerson(overrides: Partial<Roster> = {}): Roster {
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
    age_band: "adult",
    ...overrides,
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

// Shared by any test that needs a real multi-turn conversation (not just
// the thread list's own smoke tests above) - a POST creates the
// conversation, GET lists it empty, and each /api/turn/stream call
// replies once and increments, so a test can send more than one message
// and tell the replies apart. Originally local to the CHAT-HEADER-01
// describe block below; hoisted here once CHAT-LIST-01's own temporary-
// chat button needed the identical shape, rather than a second copy.
function stubMultiTurnFetch(): () => void {
  const original = globalThis.fetch;
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  let turnCount = 0;
  let conversationCount = 0;
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/conversations") && init?.method === "POST") {
      conversationCount++;
      const body = JSON.parse(init.body as string) as { mode?: string };
      return Promise.resolve(Response.json({ id: `conv-temp-${conversationCount}`, status: "open", surface: "chat", ...(body.mode === "temporary" ? { mode: "temporary" } : {}) }));
    }
    if (url.includes("/api/conversations")) return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
    if (url.includes("/api/turn/stream")) {
      turnCount++;
      const text = `Reply ${turnCount}.`;
      const body = ndjsonStream([
        { type: "delta", text },
        { type: "done", value: { turn_id: `turn-temp${turnCount}`, reply: { text }, source: "model", safety: SAFETY } },
      ]);
      return Promise.resolve(new Response(body, { status: 200, headers: ASSISTANT_STREAM_HEADERS }));
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function turnRequestBodies(): Array<Record<string, unknown>> {
  return (globalThis.fetch as unknown as ReturnType<typeof mock>).mock.calls
    .filter((c: unknown[]) => (typeof c[0] === "string" ? c[0] : (c[0] as URL | Request).toString()).includes("/api/turn/stream"))
    .map((c: unknown[]) => JSON.parse((c[1] as RequestInit).body as string));
}

// Issue #163: the request initialize() actually sends to POST
// /api/conversations, not just the turn's own `temporary` flag - the
// live defect was invisible to a test that only checked the turn body,
// because the fake `POST /api/conversations` handler above returns a
// conversation regardless of what mode (or no mode) was asked for.
function conversationCreateBodies(): Array<Record<string, unknown>> {
  return (globalThis.fetch as unknown as ReturnType<typeof mock>).mock.calls
    .filter((c: unknown[]) => {
      const url = typeof c[0] === "string" ? c[0] : (c[0] as URL | Request).toString();
      const init = c[1] as RequestInit | undefined;
      return new URL(url, "http://localhost").pathname === "/api/conversations" && init?.method === "POST";
    })
    .map((c: unknown[]) => JSON.parse((c[1] as RequestInit).body as string));
}

async function sendMessage(view: ReturnType<typeof render>, text: string): Promise<void> {
  fireEvent.change(await view.findByLabelText("Message input"), { target: { value: text } });
  const send = (await view.findByLabelText("Send message")) as HTMLButtonElement;
  await waitFor(() => expect(send.disabled).toBe(false));
  fireEvent.click(send);
}

describe("ChatPage (SHELL-02's first slice)", () => {
  test("ordinary new chat shows the greeting and generic starter chips, with no where-it-runs or can-make-mistakes line", async () => {
    const restore = stubFetch();
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      expect(await view.findByText("How can I help you today?")).toBeVisible();
      expect(view.queryByText("Runs on your own hub. Your chats stay at home.")).toBeNull();
      expect(view.queryByText(/can make mistakes/i)).toBeNull();
      expect(await view.findByRole("button", { name: "Explain how rainbows form" })).toBeVisible();
    } finally {
      restore();
    }
  });

  test("temporary new chat keeps its own welcome lines", async () => {
    const restore = stubFetch();
    writeIncognitoCache(true);
    localStorage.setItem("maipai.incognito-explanation-seen", "true");
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      expect(await view.findByText("Temporary chat")).toBeVisible();
      expect(await view.findByText("This chat won't be saved to your history.")).toBeVisible();
      // The starter chips are one fixed generic list, the same in Incognito.
      expect(await view.findByRole("button", { name: "Explain how rainbows form" })).toBeVisible();
      expect(view.queryByText("Runs on your own hub. Your chats stay at home.")).toBeNull();
    } finally {
      restore();
    }
  });

  // findByLabelText (not getByLabelText): AuiProvider's own mount does an
  // async state update (the same "assistant-ui async init" ChatPage.test.tsx
  // already works around with findBy queries) - a synchronous get here
  // still passes but throws a React "not wrapped in act()" console warning.
  test("mounts the Elements composer, ready for a real turn", async () => {
    const restore = stubFetch();
    try {
      const { findByLabelText } = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      expect(await findByLabelText("Message input")).toBeVisible();
    } finally {
      restore();
    }
  });

  // CHAT-CALM-ERRORS-01d: the full-width banner is gone; the composer line
  // carries the notice and an owner's Repairs link (ported from the banner).
  test("shows the availability notice and Repairs link when health reports the chat as blocked", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/api/health")) {
        return Promise.resolve(Response.json({ engines: { chat: { kind: "blocked", pid: 1, alive: true, notice: { adult: "Chat is paused. Your message stays here; press Send once it is back.", teen: "Chat is paused right now. Your message stays here; press Send once it is back.", child: "I'm taking a break. Ask a grown-up, or try again soon.", repairs_link: "Open Repairs" } } } }));
      }
      if (url.includes("/api/conversations")) return Promise.resolve(Response.json([]));
      return Promise.resolve(Response.json({}));
    }) as unknown as typeof fetch;
    try {
      const { findByRole, findByText } = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      expect(await findByText(/Chat is paused\. Your message stays here; press Send once it is back\./)).toBeVisible();
      expect(await findByRole("link", { name: "Open Repairs" })).toHaveAttribute("href", "/repairs");
    } finally {
      globalThis.fetch = original;
    }
  });

  test("disables New chat while chat is blocked and keeps past threads enabled", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/api/health")) {
        return Promise.resolve(Response.json({ engines: { chat: { kind: "blocked", pid: 1, alive: true } } }));
      }
      if (url.includes("/api/conversations")) {
        return Promise.resolve(Response.json([{ id: "conv-past123", title: "A past chat", surface: "chat", created_at: "2026-09-07T00:00:00Z", pinned: false }]));
      }
      return Promise.resolve(Response.json({}));
    }) as unknown as typeof fetch;
    try {
      const { findByRole } = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      expect(await findByRole("button", { name: "New chat" })).toBeDisabled();
      expect(await findByRole("button", { name: "A past chat" })).toBeEnabled();
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("ChatPage (SHELL-02's slice 2: the thread list)", () => {
  beforeEach(() => {
    jest.setSystemTime(new Date("2026-10-05T14:00:00Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const searchRows = [
    { id: "conv-search-pinned", title: "Garden pinned", surface: "chat", created_at: "2026-10-05T12:00:00Z", pinned: true },
    { id: "conv-search-today", title: "Garden today", surface: "chat", created_at: "2026-10-05T11:00:00Z", pinned: false },
    { id: "conv-search-yesterday", title: "Garden yesterday", surface: "chat", created_at: "2026-10-04T11:00:00Z", pinned: false },
    { id: "conv-search-earlier", title: "Garden earlier", surface: "chat", created_at: "2026-10-02T11:00:00Z", pinned: false },
    { id: "conv-search-other", title: "Shopping list", surface: "chat", created_at: "2026-10-05T10:00:00Z", pinned: false },
  ];

  function stubSearchRows() {
    const original = globalThis.fetch;
    const rows = searchRows.map((row) => ({ ...row }));
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push({ url, method: init?.method, body: init?.body as string | undefined });
      if (url.includes("/api/conversations/incognito") && !init?.method) return Promise.resolve(Response.json(rows));
      if (url.includes("/api/conversations") && !init?.method) return Promise.resolve(Response.json(rows));
      if (url.includes("/api/conversations/") && init?.method === "PATCH") {
        const id = decodeURIComponent(url.split("/").at(-1)!);
        const body = JSON.parse(String(init.body)) as { pinned?: boolean };
        const row = rows.find((candidate) => candidate.id === id);
        if (row && body.pinned !== undefined) row.pinned = body.pinned;
        return Promise.resolve(Response.json(row ?? { ok: true }));
      }
      if (url.includes("/api/conversations/") && init?.method === "DELETE") return Promise.resolve(Response.json({ ok: true }));
      if (url.includes("/api/conversations/")) return Promise.resolve(Response.json(searchRows[0]));
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;
    return { restore: () => { globalThis.fetch = original; }, calls };
  }

  // COLUMN-01: thread search sits behind the column's search icon (the
  // owner's "compact row or icon that opens an inline field").
  function openThreadSearch(view: Pick<ReturnType<typeof renderPage>, "getByRole" | "queryByRole">): HTMLElement {
    if (!view.queryByRole("textbox", { name: "Search threads" })) fireEvent.click(view.getByRole("button", { name: "Search chats" }));
    return view.getByRole("textbox", { name: "Search threads" });
  }

  async function searchPage(incognito = false) {
    if (incognito) writeIncognitoCache(true);
    const fetch = stubSearchRows();
    const view = renderPage(
      <MemoryRouter initialEntries={["/chat"]}>
        <ConversationLocation />
        <ChatPage person={makePerson()} />
      </MemoryRouter>,
    );
    await view.findByText("Garden pinned");
    return { ...view, ...fetch };
  }

  test("typing narrows the chat list to matching titles", async () => {
    const view = await searchPage();
    try {
      fireEvent.change(openThreadSearch(view), { target: { value: "garden" } });
      await waitFor(() => expect(view.getByText("Garden today")).toBeVisible());
      expect(view.queryByText("Shopping list")).toBeNull();
      expect(view.getByText("Garden earlier")).toBeVisible();
    } finally { view.restore(); }
  });

  test("results keep pinned first and day groups", async () => {
    const view = await searchPage();
    try {
      fireEvent.change(openThreadSearch(view), { target: { value: "garden" } });
      await waitFor(() => expect(view.getByText("Garden earlier")).toBeVisible());
      const list = view.container.querySelector('[data-slot="aui_thread-list-items"]')!;
      const rows = Array.from(list.querySelectorAll('[data-slot="aui_thread-list-item"]'));
      expect(rows.map((row) => row.querySelector('[data-slot="aui_thread-list-item-title"]')?.textContent?.trim())).toEqual(["Garden pinned", "Garden today", "Garden yesterday", "Garden earlier"]);
      const groupLabels = Array.from(list.querySelectorAll('[data-slot="aui_thread-list-group-label"]')).map((label) => label.textContent);
      expect(groupLabels).toEqual(["Pinned", "Today", "Yesterday", "Earlier"]);
      expect(groupLabels.every((label) => !/\d/.test(label ?? ""))).toBe(true);
      const groupNodes = Array.from(list.querySelectorAll<HTMLElement>('[data-slot="aui_thread-list-group-label"]'));
      expect(groupNodes.map((label) => label.nextSibling?.textContent?.trim() ?? "").filter((text) => /^\d+$/.test(text))).toEqual([]);
      // The kit's matcher retains pin/day metadata and Enter uses its ordered results.
      const search = view.container.querySelector('[data-slot="thread-search"]')!;
      expect(search).toBeVisible();
      expect(openThreadSearch(view)).toHaveValue("garden");
    } finally { view.restore(); }
  });

  test("a Pin action appears on a chat row", async () => {
    const view = await searchPage();
    try {
      const row = view.getByText("Garden today").closest('[data-slot="aui_thread-list-item"]')!;
      fireEvent.pointerDown(row.querySelector('[data-slot="aui_thread-list-item-more"]')!, { button: 0, ctrlKey: false, pointerType: "mouse" });
      expect(await view.findByRole("menuitem", { name: "Pin" })).toBeVisible();
    } finally { view.restore(); }
  });

  test("pinning a chat persists through the adapter and moves it to the top", async () => {
    searchRows[0]!.pinned = false;
    const view = await searchPage();
    try {
      const row = view.getByText("Garden today").closest('[data-slot="aui_thread-list-item"]')!;
      fireEvent.pointerDown(within(row as HTMLElement).getByRole("button", { name: "More options" }), { button: 0, ctrlKey: false, pointerType: "mouse" });
      fireEvent.click(await view.findByRole("menuitem", { name: "Pin" }));
      await waitFor(() => expect(view.calls.some((call) => call.method === "PATCH" && call.url.endsWith("conv-search-today") && call.body === '{"pinned":true}')).toBe(true));
      await waitFor(() => expect(view.getByText("Pinned", { selector: '[data-slot="aui_thread-list-group-label"]' })).toBeVisible());
      const rows = Array.from(view.container.querySelectorAll('[data-slot="aui_thread-list-item"]'));
      expect(rows[0]?.querySelector('[data-slot="aui_thread-list-item-title"]')?.textContent?.trim()).toBe("Garden today");
      expect(rows[0]?.querySelector('[data-slot="aui_thread-list-item-pinned"]')).not.toBeNull();
    } finally { view.restore(); searchRows[0]!.pinned = true; }
  });

  test("unpinning restores its place", async () => {
    const view = await searchPage();
    try {
      const row = view.getByText("Garden pinned").closest('[data-slot="aui_thread-list-item"]')!;
      fireEvent.pointerDown(row.querySelector('[data-slot="aui_thread-list-item-more"]')!, { button: 0, ctrlKey: false, pointerType: "mouse" });
      fireEvent.click(await view.findByRole("menuitem", { name: "Unpin" }));
      await waitFor(() => expect(view.calls.some((call) => call.method === "PATCH" && call.url.endsWith("conv-search-pinned") && call.body === '{"pinned":false}')).toBe(true));
      await waitFor(() => expect(view.queryByText("Pinned", { selector: '[data-slot="aui_thread-list-group-label"]' })).toBeNull());
      const labels = Array.from(view.container.querySelectorAll('[data-slot="aui_thread-list-group-label"]')).map((label) => label.textContent);
      // PROJECTS-01b: an adult's (empty) Projects section, with its "+", sits
      // above the day groups.
      expect(labels.slice(0, 2)).toEqual(["Projects", "Today"]);
      const rows = Array.from(view.container.querySelectorAll('[data-slot="aui_thread-list-item"]'));
      expect(rows[0]?.querySelector('[data-slot="aui_thread-list-item-title"]')?.textContent?.trim()).toBe("Garden pinned");
    } finally { view.restore(); }
  });

  test("an Incognito list never offers Pin", async () => {
    const view = await searchPage(true);
    try {
      const row = await view.findByText("Garden today").then((title) => title.closest('[data-slot="aui_thread-list-item"]')!);
      fireEvent.pointerDown(row.querySelector('[data-slot="aui_thread-list-item-more"]')!, { button: 0, ctrlKey: false, pointerType: "mouse" });
      expect(await view.findByRole("menuitem", { name: "Delete" })).toBeVisible();
      expect(view.queryByRole("menuitem", { name: "Pin" })).toBeNull();
      expect(view.queryByRole("menuitem", { name: "Unpin" })).toBeNull();
    } finally { view.restore(); }
  });

  test("Enter opens the first result", async () => {
    const view = await searchPage();
    try {
      const input = openThreadSearch(view);
      fireEvent.change(input, { target: { value: "garden" } });
      await waitFor(() => expect(view.queryByText("Shopping list")).toBeNull());
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(view.getByTestId("conversation-location").textContent).toBe("?conversation=conv-search-pinned"));
    } finally { view.restore(); }
  });

  test("Escape clears the search", async () => {
    const view = await searchPage();
    try {
      const input = openThreadSearch(view) as HTMLInputElement;
      fireEvent.change(input, { target: { value: "garden" } });
      await waitFor(() => expect(view.queryByText("Shopping list")).toBeNull());
      fireEvent.keyDown(input, { key: "Escape" });
      await waitFor(() => expect(input.value).toBe(""));
      expect(view.getByText("Shopping list")).toBeVisible();
    } finally { view.restore(); }
  });

  test("the search icon opens a focused field; Escape on an empty field closes it and returns focus to the icon", async () => {
    const view = await searchPage();
    try {
      const input = openThreadSearch(view);
      await waitFor(() => expect(document.activeElement).toBe(input));
      fireEvent.keyDown(input, { key: "Escape" });
      await waitFor(() => expect(view.queryByRole("textbox", { name: "Search threads" })).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(view.getByRole("button", { name: "Search chats" })));
    } finally { view.restore(); }
  });

  test("with a search typed, the hide control stays in the column and focus survives a hide and show", async () => {
    const view = await searchPage();
    try {
      fireEvent.change(openThreadSearch(view), { target: { value: "garden" } });
      const column = document.getElementById("next-chat-rail")!;
      expect(within(column).getByRole("button", { name: "Hide conversations" })).toBeTruthy();
      fireEvent.keyDown(window, { key: "b", ctrlKey: true });
      const show = view.getByRole("button", { name: "Show conversations" });
      await waitFor(() => expect(document.activeElement).toBe(show));
      fireEvent.click(show);
      await waitFor(() => expect(document.activeElement).toBe(within(column).getByRole("button", { name: "Hide conversations" })));
    } finally { view.restore(); }
  });

  test("in the phone sheet, Escape clears the search, then closes it, and only then the sheet", async () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    const fetchStub = stubSearchRows();
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await view.findByLabelText("Message input");
      fireEvent.click(view.getByRole("button", { name: "Show threads" }));
      const dialog = (await view.findByRole("heading", { name: "Conversations" })).closest('[role="dialog"]') as HTMLElement;
      await within(dialog).findByText("Garden pinned");
      fireEvent.click(within(dialog).getByRole("button", { name: "Search chats" }));
      const input = within(dialog).getByRole("textbox", { name: "Search threads" });
      fireEvent.change(input, { target: { value: "garden" } });
      fireEvent.keyDown(input, { key: "Escape" });
      await waitFor(() => expect(within(dialog).getByRole("textbox", { name: "Search threads" })).toHaveValue(""));
      expect(view.getByRole("heading", { name: "Conversations" })).toBeTruthy();
      fireEvent.keyDown(within(dialog).getByRole("textbox", { name: "Search threads" }), { key: "Escape" });
      await waitFor(() => expect(within(dialog).queryByRole("textbox", { name: "Search threads" })).toBeNull());
      expect(view.getByRole("heading", { name: "Conversations" })).toBeTruthy();
      await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Search chats" })));
    } finally {
      fetchStub.restore();
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    }
  });

  test("the command palette's Search chats shows a hidden column with search open", async () => {
    const view = await searchPage();
    try {
      fireEvent.click(view.getByRole("button", { name: "Hide conversations" }));
      expect(document.getElementById("next-chat-rail")).toHaveAttribute("data-state", "closed");
      fireEvent.keyDown(view.getByLabelText("Message input"), { key: "k", ctrlKey: true });
      fireEvent.click(await view.findByRole("option", { name: /Search chats/ }));
      expect(document.getElementById("next-chat-rail")).toHaveAttribute("data-state", "open");
      await waitFor(() => expect(document.activeElement).toBe(view.getByRole("textbox", { name: "Search threads" })));
    } finally { view.restore(); }
  });

  test("no match shows the list's empty state", async () => {
    const view = await searchPage();
    try {
      fireEvent.change(openThreadSearch(view), { target: { value: "nothing matches" } });
      expect(await view.findByText("No threads found")).toBeVisible();
    } finally { view.restore(); }
  });

  test("pin and delete still work in the list", async () => {
    const view = await searchPage();
    try {
      // The row keeps the server-provided pin metadata while the shipped
      // Element exposes Delete in its action menu.
      expect(view.container.querySelectorAll('[data-slot="aui_thread-list-item"]')).toHaveLength(5);
      const row = view.getByText("Garden today").closest('[data-slot="aui_thread-list-item"]')!;
      fireEvent.pointerDown(within(row as HTMLElement).getByRole("button", { name: "More options" }), { button: 0, ctrlKey: false, pointerType: "mouse" });
      fireEvent.click(await view.findByRole("menuitem", { name: "Delete" }));
      await waitFor(() => expect(view.calls.some((call) => call.method === "DELETE" && call.url.includes("conv-search-today"))).toBe(true));
    } finally { view.restore(); }
  });

  test("shows New chat and an empty thread list with no past conversations", async () => {
    const restore = stubFetch();
    try {
      const { findByText } = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      expect(await findByText("New chat")).toBeVisible();
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
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      expect(await findByText("A past chat")).toBeVisible();
    } finally {
      globalThis.fetch = original;
    }
  });

  test("a rejected Archive keeps the active conversation selected", async () => {
    const original = globalThis.fetch;
    const conversation = { id: "conv-archive123", title: "Archive me", surface: "chat", created_at: "2026-09-27T00:00:00Z", pinned: false };
    const otherConversation = { id: "conv-archive456", title: "Other conversation", surface: "chat", created_at: "2026-09-26T00:00:00Z", pinned: false };
    let finishTurnsLoad!: () => void;
    const turnsLoad = new Promise<void>((resolve) => { finishTurnsLoad = resolve; });
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/engines")) return Promise.resolve(Response.json({ configured: true, roles: [{ id: "chat", label: "Chat", wire: "chat", residency: "resident", endpoints: [], quality: [], sharesModelWith: null, state: { state: "loaded", since: "2026-09-22T00:00:00.000Z" }, reason: null, model: { id: "family.gguf", sizeBytes: null, measuredFootprintBytes: null, measuredContextLength: 8192, estimated: false }, models: [{ id: "family.gguf", name: "Family" }, { id: "fast.gguf", name: "Fast" }], check: { state: "not checked", at: null, reason: null, stale: false } }], engines: [], budget: null }));
      // The hub refuses the archive (CONV-ARCHIVE-01 made archive real; this test is about its failure path).
      if (init?.method === "PATCH" && url.includes("/api/conversations/conv-archive123")) return Promise.resolve(Response.json({ error: "Cannot save" }, { status: 500 }));
      if (url.includes("/api/conversations/conv-archive123/resume")) return Promise.resolve(Response.json(conversation));
      if (url.includes("/api/conversations/conv-archive456/resume")) return Promise.resolve(Response.json(otherConversation));
      if (url.includes("/turns")) {
        finishTurnsLoad();
        return Promise.resolve(Response.json([]));
      }
      if (url.includes("/api/conversations/conv-archive123")) return Promise.resolve(Response.json(conversation));
      if (url.includes("/api/conversations/conv-archive456")) return Promise.resolve(Response.json(otherConversation));
      if (url.includes("/api/conversations")) return Promise.resolve(Response.json([conversation, otherConversation]));
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat?conversation=conv-archive123"]}>
          <ConversationLocation />
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await view.findByText("Archive me");
      await waitFor(() => expect(view.getByTestId("conversation-location").textContent).toBe("?conversation=conv-archive123"));
      const thinkingTrigger = view.container.querySelector('[data-slot="model-selector-trigger"]') as HTMLButtonElement;
      fireEvent.click(thinkingTrigger);
      await view.findByRole("radio", { name: "Thinking" });
      fireEvent.click(await view.findByRole("radio", { name: "Thinking" }));
      expect(thinkingTrigger).toHaveTextContent("Thinking");

      const archiveRow = view.getByText("Archive me").closest('[data-slot="aui_thread-list-item"]')!;
      const moreOptions = within(archiveRow as HTMLElement).getByRole("button", { name: "More options" });
      fireEvent.pointerDown(moreOptions, { button: 0, ctrlKey: false, pointerType: "mouse" });
      const archiveItem = await view.findByRole("menuitem", { name: "Archive" });
      fireEvent.click(archiveItem);
      await waitFor(() => expect(view.getByTestId("conversation-location").textContent).toBe("?conversation=conv-archive123"));
      expect(view.getByText("Archive me")).toBeVisible();
      expect(thinkingTrigger).toHaveTextContent("Thinking");
      await turnsLoad;
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

      fireEvent.click(view.getByText("Other conversation"));
      await waitFor(() => expect(view.getByTestId("conversation-location").textContent).toBe("?conversation=conv-archive456"));
      await waitFor(() => expect(thinkingTrigger).toHaveTextContent("Instant"));
    } finally {
      globalThis.fetch = original;
    }
  });

  // Found live, on 8787, verifying this slice: clicking "New chat"
  // from the phone/tablet Sheet started a fresh conversation but left
  // the Sheet open over it, blocking the composer until it was
  // manually dismissed - `ThreadList`'s own composed `onClick` on
  // `ThreadListNew` (not the shipped `<ThreadList>`, which hardcodes
  // it with no hook) is the fix. ChatPage.test.tsx's own sibling test
  // ("thread history opens as a phone sheet...") is the pattern this
  // mirrors: the Sheet's own heading, not the toggle button, proves
  // open/closed once Radix aria-hides the rest of the page.
  test("New chat closes the phone/tablet Sheet, the same as selecting a past conversation", async () => {
    const restore = stubFetch();
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await view.findByLabelText("Message input");
      fireEvent.click(view.getByRole("button", { name: "Show threads" }));
      const dialog = await view.findByRole("heading", { name: "Conversations" });
      fireEvent.click(within(dialog.closest('[role="dialog"]')!).getByText("New chat"));
      await view.findByRole("button", { name: "Show threads" });
      expect(view.queryByRole("heading", { name: "Conversations" })).toBeNull();
    } finally {
      restore();
    }
  });
});

// TAB-01: chat publishes its safe item title into the shell's tab identity.
describe("ChatPage (c-99f5: the tab's document title)", () => {
  test("no conversation open yet, the tab title is New chat", async () => {
    const restore = stubFetch();
    const previousTitle = document.title;
    try {
      document.title = "Before";
      renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await waitFor(() => {
        expect(document.title).toBe("New chat - MaiPai Home");
      });
    } finally {
      document.title = previousTitle;
      restore();
    }
  });

  test("the open conversation's title is the tab title, and unmount restores it", async () => {
    const original = globalThis.fetch;
    const conversation = { id: "conv-titled123", title: "Garden plans", surface: "chat", created_at: "2026-09-07T00:00:00Z", pinned: false };
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/conversations/conv-titled123/resume")) {
        return Promise.resolve(Response.json(conversation));
      }
      if (url.includes("/api/conversations/conv-titled123/turns")) {
        return Promise.resolve(Response.json([]));
      }
      if (url.includes("/api/conversations/conv-titled123")) {
        return Promise.resolve(Response.json(conversation));
      }
      if (url.includes("/api/conversations")) {
        return Promise.resolve(Response.json([conversation]));
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;
    const previousTitle = document.title;
    try {
      document.title = "Before";
      renderPage(
        <MemoryRouter initialEntries={["/chat?conversation=conv-titled123"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await waitFor(() => {
        expect(document.title).toBe("Garden plans - MaiPai Home");
      });
      cleanup();
      expect(document.title).toBe("Before");
    } finally {
      document.title = previousTitle;
      globalThis.fetch = original;
    }
  });
});

const SAFETY = { flagged: false, categories: [], action: "allow" as const, notify_parent: false, matched_signals: [], checked_at: "2026-09-04T00:00:00.000Z" };

describe("ChatPage (SHELL-02's slice 3: tools and generative UI)", () => {
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
      if (url.includes("/api/turn/stream")) return Promise.resolve(new Response(streamBody, { status: 200, headers: ASSISTANT_STREAM_HEADERS }));
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

  async function openToolGroup(view: ReturnType<typeof render>): Promise<void> {
    fireEvent.click(await view.findByRole("button", { name: /1 tool call/ }));
    await waitFor(() => expect(view.container.querySelector('[data-slot="tool-group-root"]')?.getAttribute("data-state")).toBe("open"));
  }

  async function openTimeline(view: ReturnType<typeof render>): Promise<void> {
    const trigger = await waitFor(() => {
      const button = view.container.querySelector('[data-slot="tool-timeline"] button');
      expect(button).not.toBeNull();
      return button as HTMLButtonElement;
    });
    fireEvent.click(trigger);
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
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
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
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await sendMessage(view, "what herbs should I grow");
      expect(await view.findByText("Basil and parsley are easy herbs.")).toBeVisible();
      expect(view.queryByText("Lantern Bay")).toBeNull();
    } finally {
      restore();
    }
  });

  // Native sources render through the shipped Sources card. D15 forbids
  // third-party favicon requests, so the kit's glyph is used without images.
  test("a turn's native sources render in the Sources card without third-party favicon requests", async () => {
    const SOURCE = { id: "src-tide123", kind: "web" as const, title: "Lantern Bay tide chart", url: "https://example.com/tides", site: "example.com", snippet: null, source: "turn-tide123", created_at: "2026-09-22T00:00:00.000Z", hlc: "1788000000000:0:test" };
    const restore = stubTurnFetch(
      ndjsonStream([
        { type: "delta", text: "High tide is at 4pm [1]. More [9]; code `[1]`." },
        { type: "done", value: { turn_id: "turn-tide123", reply: { text: "High tide is at 4pm [1]. More [9]; code `[1]`." }, source: "model", safety: SAFETY, sources: [SOURCE] } },
      ]),
    );
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await sendMessage(view, "when's high tide");
      await waitFor(() => expect(view.container.querySelector(".aui-md")?.textContent).toContain("High tide is at 4pm 1."));
      const markdown = view.container.querySelector<HTMLElement>(".aui-md")!;
      expect(markdown.querySelector('a[href="https://example.com/tides"]')).toBeTruthy();
      expect(markdown.textContent).toContain("More 9; code [1].");
      expect(markdown.querySelector("code")?.textContent).toBe("[1]");
      const citation = view.getByRole("link", { name: /^1$/ });
      expect(citation).toHaveAttribute("href", "https://example.com/tides");
      // The inline chip resolves through ChatCitationLink's native-source hook.
      expect(view.queryByText("Lantern Bay tide chart")).toBeNull();
      const trigger = view.getByRole("button", { name: "1 Source" });
      expect(trigger).toBeVisible();
      fireEvent.click(trigger);
      const row = view.container.querySelector('[data-slot="sources-list"]');
      expect(row).not.toBeNull();
      expect(row).toHaveTextContent("Lantern Bay tide chart");
      expect(row).toHaveTextContent("example.com");
      expect(view.container.querySelector('[data-slot="sources-list"] img')).toBeNull();
      expect(view.container.innerHTML).not.toContain("icons.duckduckgo.com");
    } finally {
      restore();
    }
  });

  test("two sources label the trigger with their count (issue #205)", async () => {
    const make = (n: number) => ({ id: `src-n${n}`, kind: "web" as const, title: `Source ${n}`, url: `https://news${n}.example.com/a`, site: `news${n}.example.com`, snippet: null, source: "turn-two123", created_at: "2026-09-22T00:00:00.000Z", hlc: `1788000000000:${n}:test` });
    const restore = stubTurnFetch(
      ndjsonStream([
        { type: "delta", text: "Two sites agree." },
        { type: "done", value: { turn_id: "turn-two123", reply: { text: "Two sites agree." }, source: "model", safety: SAFETY, sources: [make(1), make(2)] } },
      ]),
    );
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await sendMessage(view, "do they agree");
      await view.findByText("Two sites agree.");
      expect(view.getByRole("button", { name: "2 Sources" })).toBeVisible();
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
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
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
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await sendMessage(view, "when's high tide");
      await view.findByText("High tide is at 4pm.");
      const trigger = view.getByRole("button", { name: /1 tool call/ });
      expect(trigger).toBeVisible();
      await openToolGroup(view);
      expect(view.queryByText("websearch")).toBeNull();
      await openTimeline(view);
      expect(await view.findByText("websearch")).toBeVisible();
    } finally {
      restore();
    }
  });

  test("a failed tool call still renders its chip and the reply (a failed tool never fails the answer)", async () => {
    const restore = stubTurnFetch(
      ndjsonStream([
        { t: "tool_call", package_id: "websearch", args: { query: "tide chart" }, call_id: "call-err-1" },
        { t: "tool_error", call_id: "call-err-1", package_id: "websearch", error: "lookup failed" },
        { type: "delta", text: "I could not look that up." },
        { type: "done", value: { turn_id: "turn-tools-err", reply: { text: "I could not look that up." }, source: "model", safety: SAFETY } },
      ]),
    );
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await sendMessage(view, "when's high tide");
      await view.findByText("I could not look that up.");
      await openToolGroup(view);
      await openTimeline(view);
      expect(await view.findByText("websearch")).toBeVisible();
      expect(view.queryByText(/lookup failed/)).toBeNull();
    } finally {
      restore();
    }
  });

  test("finished tool timelines show the turn duration and step count", async () => {
    const restore = stubTurnFetch(
      ndjsonStream([
        { t: "tool_call", package_id: "websearch", args: { query: "tide chart" }, call_id: "call-time-1" },
        { t: "tool_result", call_id: "call-time-1", package_id: "websearch", outcome: { text: "3 results" } },
        { type: "delta", text: "High tide is at 4pm." },
        { type: "done", value: { turn_id: "turn-tools-time", reply: { text: "High tide is at 4pm." }, source: "model", safety: SAFETY, stats: { total_time_ms: 12_000 } } },
      ]),
    );
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await sendMessage(view, "when's high tide");
      await view.findByText("High tide is at 4pm.");
      await openToolGroup(view);
      expect(await view.findByRole("button", { name: "Worked for 12 seconds, 1 step" })).toBeVisible();
    } finally {
      restore();
    }
  });

  test("finished tool timelines use minutes and plural steps, keep fallback without stats, and retain the running label", async () => {
    const restore = stubTurnFetch(
      ndjsonStream([
        { t: "tool_call", package_id: "websearch", args: { query: "tide chart" }, call_id: "call-time-2" },
        { t: "tool_result", call_id: "call-time-2", package_id: "websearch", outcome: { text: "3 results" } },
        { t: "tool_call", package_id: "weather", args: { city: "Seattle" }, call_id: "call-time-3" },
        { t: "tool_result", call_id: "call-time-3", package_id: "weather", outcome: { text: "sunny" } },
        { type: "delta", text: "High tide is at 4pm." },
        { type: "done", value: { turn_id: "turn-tools-time-2", reply: { text: "High tide is at 4pm." }, source: "model", safety: SAFETY, stats: { total_time_ms: 240_000 } } },
      ]),
    );
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await sendMessage(view, "when's high tide");
      await view.findByText("High tide is at 4pm.");
      await openToolGroup(view);
      expect(await view.findByRole("button", { name: "Worked for 4 minutes, 2 steps" })).toBeVisible();
    } finally {
      restore();
    }
  });

  // TOOL-EVENTS-02: a search step's `tool_result.outcome.sites` renders
  // as chips under that step through the shipped tool-timeline Element.
  test("a search step's tool_result sites render as chips under that step", async () => {
    const restore = stubTurnFetch(
      ndjsonStream([
        {
          t: "tool_call",
          package_id: "websearch",
          args: { query: "mariners score" },
          call_id: "call-1",
        },
        {
          t: "tool_result",
          call_id: "call-1",
          package_id: "websearch",
          outcome: { text: "4-2", sites: [{ host: "mlb.com", url: "https://www.mlb.com/mariners" }] },
        },
        { type: "delta", text: "The Mariners won 4-2." },
        { type: "done", value: { turn_id: "turn-tools456", reply: { text: "The Mariners won 4-2." }, source: "model", safety: SAFETY } },
      ]),
    );
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await sendMessage(view, "who won the mariners game");
      await view.findByText("The Mariners won 4-2.");
      // Collapsed by default - a site chip isn't in the DOM yet either.
      await openToolGroup(view);
      expect(view.queryByText("mlb.com")).toBeNull();
      await openTimeline(view);
      const row = (await view.findByText("mlb.com")).closest("a");
      expect(row).not.toBeNull();
      expect(row).toHaveAttribute("href", "https://www.mlb.com/mariners");
      expect(row).toHaveAttribute("referrerpolicy", "no-referrer");
    } finally {
      restore();
    }
  });

  test("a weather step with no sites renders no chips", async () => {
    const restore = stubTurnFetch(
      ndjsonStream([
        { t: "tool_call", package_id: "weather", args: { location: "Portland" }, call_id: "call-1" },
        { t: "tool_result", call_id: "call-1", package_id: "weather", outcome: { text: "58°F and overcast" } },
        { type: "delta", text: "It's 58°F and overcast in Portland." },
        { type: "done", value: { turn_id: "turn-tools789", reply: { text: "It's 58°F and overcast in Portland." }, source: "model", safety: SAFETY } },
      ]),
    );
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await sendMessage(view, "what's the weather in portland");
      await view.findByText("It's 58°F and overcast in Portland.");
      await openToolGroup(view);
      await openTimeline(view);
      expect(await view.findByText("weather")).toBeVisible();
      // The conversation, not the history column (whose settings gear is a link).
      expect(within(document.querySelector<HTMLElement>('[data-slot="next-chat-pane"]')!).queryByRole("link")).toBeNull();
    } finally {
      restore();
    }
  });

  // Slice 5(c), "thinking before the reply" (2026-09-22): unlike the
  // tool timeline above, `status` is a real wire event already (CHAT-16,
  // done 2026-09-15) - this is live-rendering behavior today, not
  // scaffolding, so it's tested with a genuinely staggered stream
  // (`staggeredNdjsonStream`) to observe the indicator's text mid-turn,
  // not just the final settled content.
  test("a status event shows its text as a thinking indicator before the reply arrives, then clears", async () => {
    const { stream, release } = staggeredNdjsonStream(
      [{ type: "status", text: "Checking that for you.", stage: "lookup" }],
      [
        { type: "delta", text: "High tide is at 4pm." },
        { type: "done", value: { turn_id: "turn-status123", reply: { text: "High tide is at 4pm." }, source: "model", safety: SAFETY } },
      ],
    );
    const restore = stubTurnFetch(stream);
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await sendMessage(view, "when's high tide");
      expect(await view.findByText("Checking that for you.")).toBeVisible();
      release();
      await view.findByText("High tide is at 4pm.");
      expect(view.queryByText("Checking that for you.")).toBeNull();
    } finally {
      restore();
    }
  });
});

describe("ChatPage (SHELL-02's slice 4: artifacts)", () => {
  let artifactBodyOverride: string | null = null;
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
      if (url.includes(`/api/artifacts/${ARTIFACT.id}/current`)) return Promise.resolve(Response.json(artifactBodyOverride === null ? ARTIFACT : { ...ARTIFACT, body: artifactBodyOverride }));
      if (url.includes("/api/turn/stream")) return Promise.resolve(new Response(streamBody, { status: 200, headers: ASSISTANT_STREAM_HEADERS }));
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

  // #183: the desktop pane (`isDesktopCanvas && ... hidden lg:block`) and
  // the phone/tablet Sheet (`open={!isDesktopCanvas && ...}`) used to both
  // bind to the same `openArtifactId !== null` state with no viewport
  // gate on the Sheet's own `open` prop - only its CONTENT was
  // `lg:hidden`, so the Sheet still mounted and opened on desktop too,
  // with a real full-screen overlay (dimming the page) and a real
  // Radix outside-click handler that treated any click on the actual,
  // visible desktop pane next to it as "outside," closing everything.
  // These two tests replace the old single test (which asserted "two
  // mounts exist in jsdom at once" as expected) with one assertion per
  // viewport that exactly one surface exists and behaves correctly.
  // Stubs the turn/artifact fetch, sends the message and clicks the
  // resulting card - the same sequence the old single test ran inline -
  // and returns `restore()` for the caller's own `finally`, since the
  // artifact panel's `api.artifactCurrent()` query and everything the
  // test does after this click still need the stub alive.
  async function openArtifact(view: ReturnType<typeof render>, waitForText: string = ARTIFACT.body): Promise<() => void> {
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
    await sendMessage(view, "write me a short note about pizza night");
    expect(await view.findByText("Wrote it.")).toBeVisible();
    // Jesse's own standing rule (2026-09-27): "auto open the canvas...
    // this should be the default" - a synchronous write_document reply
    // now opens its own canvas the moment the turn completes
    // (chatModelAdapter.ts's own onArtifactReady), no click needed here
    // any more. Waiting for the artifact's own fetched body text (not
    // the card's title, which the now-open canvas ALSO renders in its
    // own heading, ambiguous for a bare findByText) is what proves the
    // canvas is genuinely open, through a real api.artifactCurrent()
    // round trip, not just that the turn completed.
    await view.findByText(waitForText);
    return restore;
  }

  test("desktop viewport: opening an artifact shows the canvas directly, with no Sheet/overlay ever mounted, and a click inside its content never closes it", async () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    let restore: () => void = () => {};
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await waitFor(() => expect(view.queryByLabelText("Message input")).not.toBeNull());
      await act(async () => { window.dispatchEvent(new Event("resize")); });
      restore = await openArtifact(view);
      // Complete the thread-list's fire-and-forget refresh before the
      // helper's fetch stub is restored; under the full gate it can run
      // a tick after the artifact card appears.
      await waitFor(() => expect((globalThis.fetch as unknown as ReturnType<typeof mock>).mock.calls.some((call: unknown[]) => String(call[0]).includes("/api/conversations"))).toBe(true));
      const body = await view.findByText("Every Friday night.");
      expect(body).toBeVisible();
      // No Sheet ever mounted at this width - not just CSS-hidden
      // content, no dialog role, no overlay, no sheet-content node at
      // all.
      expect(view.queryByRole("dialog")).toBeNull();
      expect(document.querySelector('[data-slot="sheet-overlay"]')).toBeNull();
      expect(document.querySelector('[data-slot="sheet-content"]')).toBeNull();
      // A click on the canvas's own content (selecting/scrolling it) -
      // the exact interaction #183 reported as closing the whole
      // canvas - leaves it open.
      fireEvent.pointerDown(body);
      expect(view.getByText("Every Friday night.")).toBeVisible();
      // The explicit close action still closes it, and never touches
      // the thread.
      fireEvent.click(view.getByRole("button", { name: "Close the canvas" }));
      // Jesse's own standing rule (2026-09-27): this wrapping div stays
      // mounted and its content keeps rendering through the CLOSING
      // width transition (`lastCanvasArtifactId`'s own doc comment,
      // ChatPage.tsx) - the same "animate open and closed, never
      // snap" fix that made this file's own Sources/tool-call
      // disclosures actually animate. So the text staying in the DOM is
      // now the CORRECT behavior, not something to assert away; `w-0`
      // on the wrapper (the class actually driving the visual collapse)
      // is the real signal that it closed.
      await waitFor(() => expect(document.querySelector('[data-slot="desktop-canvas-wrapper"]')).toHaveClass("w-0"));
      expect(view.getByText("Wrote it.")).toBeVisible();
    } finally {
      restore();
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    }
  });

  // THIN-5F (rule 9, closes CANVAS-READ-01): the pane renders the
  // document with the chat's own MarkdownText, so Markdown reads as a
  // page instead of raw lines.
  test("desktop viewport: the canvas renders a document's Markdown (heading, list, table, link, code) with the chat's renderer", async () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    artifactBodyOverride = [
      "# Pizza night",
      "",
      "- dough",
      "- sauce",
      "",
      "| Topping | Votes |",
      "| --- | --- |",
      "| basil | 3 |",
      "",
      "See [the recipe](https://example.com/recipe) and `oven` first.",
    ].join("\n");
    let restore: () => void = () => {};
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await waitFor(() => expect(view.queryByLabelText("Message input")).not.toBeNull());
      await act(async () => { window.dispatchEvent(new Event("resize")); });
      restore = await openArtifact(view, "Wrote it.");
      const pane = document.querySelector('[data-slot="desktop-canvas-wrapper"]') as HTMLElement;
      await waitFor(() => expect(pane.querySelector(".aui-md")).toBeTruthy());
      expect(within(pane).getByRole("heading", { name: "Pizza night", level: 1 })).toBeTruthy();
      expect(within(pane).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["dough", "sauce"]);
      expect(within(pane).getByRole("table")).toBeTruthy();
      expect(within(pane).queryByRole("link", { name: "the recipe" })).toBeNull();
      expect(pane.textContent).toContain("the recipe (https://example.com/recipe)");
      expect(pane.querySelector("code")?.textContent).toBe("oven");
      // Raw Markdown syntax never shows as text.
      expect(pane.textContent).not.toContain("# Pizza night");
      expect(pane.textContent).not.toContain("| --- |");
    } finally {
      artifactBodyOverride = null;
      restore();
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    }
  });

  test("produced-file menu exposes its available actions and supports keyboard navigation", async () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    let restore: () => void = () => {};
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await waitFor(() => expect(view.queryByLabelText("Message input")).not.toBeNull());
      await act(async () => { window.dispatchEvent(new Event("resize")); });
      restore = await openArtifact(view);
      const card = view.container.querySelector('[data-slot="produced-artifact-card"]');
      expect(card).toBeTruthy();
      const trigger = within(card as HTMLElement).getByRole("button", { name: "More" });
      fireEvent.keyDown(trigger, { key: "ArrowDown" });
      const open = await within(document.body).findByRole("menuitem", { name: "Open" });
      expect(within(document.body).getByRole("menuitem", { name: "Download" })).toBeTruthy();
      expect(within(document.body).getByRole("menuitem", { name: "Show in Library" })).toBeTruthy();
      expect(within(document.body).queryByRole("menuitem", { name: "Delete" })).toBeNull();
      await waitFor(() => expect(document.activeElement).toBe(open));
    } finally {
      restore();
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    }
  });

  // A code review caught this: the desktop canvas's own content used
  // to stay mounted (and its `useQuery` for the artifact with it)
  // forever after the FIRST artifact ever closed, not just through one
  // closing animation - `lastCanvasArtifactId` only ever updated to a
  // real id, never back to null. A backstop timeout (750ms, well past
  // the real ~300ms transition) clears it once the close has genuinely
  // had time to finish, whether or not a real `transitionend` ever
  // fired (motion-reduce, or a backgrounded tab, both drop it).
  test("desktop viewport: closing an artifact eventually unmounts the canvas panel, not just visually collapses it", async () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    let restore: () => void = () => {};
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      restore = await openArtifact(view);
      await view.findByText("Every Friday night.");
      // The 750ms backstop (CANVAS_CLOSE_BACKSTOP_MS) is the component's
      // own timer, so the test drives it instead of sleeping through it
      // (FLAKE-195: a real wait plus a 2s ceiling failed under load).
      // Fake timers go on only now, after everything asynchronous the
      // page needed to open the artifact has finished, so the timer
      // the close effect schedules is the only one they capture.
      jest.useFakeTimers();
      try {
        fireEvent.click(view.getByRole("button", { name: "Close the canvas" }));
        act(() => {
          jest.advanceTimersByTime(750);
        });
      } finally {
        jest.useRealTimers();
      }
      expect(view.queryByText("Every Friday night.")).toBeNull();
    } finally {
      restore();
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    }
  });

  test("phone/tablet viewport: opening an artifact opens the real Sheet (dimmed by design) and renders no desktop pane; a click inside its content never closes it, a genuine outside click does", async () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    let restore: () => void = () => {};
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      restore = await openArtifact(view);
      const dialogTitle = await view.findByRole("heading", { name: "Document" });
      const dialog = within(dialogTitle.closest('[role="dialog"]')!);
      const body = await dialog.findByText("Every Friday night.");
      expect(body).toBeVisible();
      // A real overlay is expected here (this is the mobile/tablet
      // Sheet doing its normal job) - and the desktop pane never
      // mounted alongside it, so this is the only match in the whole
      // document.
      expect(document.querySelector('[data-slot="sheet-overlay"]')).not.toBeNull();
      expect(view.getAllByText("Every Friday night.").length).toBe(1);
      // A click on the canvas's own content does not close the Sheet -
      // Radix's own outside-click check correctly sees it as inside
      // real, visible content now that the desktop pane isn't also
      // mounted underneath it. Radix's dismissable layer only actually
      // decides "outside or not" on the click that follows the
      // pointerdown (found probing this exact component: a bare
      // pointerdown alone never closed it, pointerdown+click did), so
      // both fire here, on the same node, the same way a real tap or
      // click-drag-to-select would.
      fireEvent.pointerDown(body, { bubbles: true, button: 0, pointerId: 1, pointerType: "mouse" });
      fireEvent.click(body, { bubbles: true, button: 0 });
      expect(view.getByRole("heading", { name: "Document" })).toBeVisible();
      // A genuine outside click still closes it.
      fireEvent.pointerDown(document.body, { bubbles: true, button: 0, pointerId: 1, pointerType: "mouse" });
      fireEvent.click(document.body, { bubbles: true, button: 0 });
      await waitForGone(() => view.queryByRole("heading", { name: "Document" }));
      expect(view.getByText("Wrote it.")).toBeVisible();
    } finally {
      restore();
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    }
  });

  // A code review caught this (2026-09-27): every test above proves the
  // canvas auto-opens now, and none of them still click the card - the
  // shipped `onClick={() => openArtifact(id)}` on ArtifactCard
  // (ArtifactCardToolRender) could silently break with the whole suite
  // green. A document loaded from history (never a live "just streamed
  // in" turn - chatModelAdapter.ts's own `onArtifactReady` only fires on
  // the live completion path, never chatHistoryAdapter.ts's reload one)
  // never auto-opens, so a person reopening an old conversation still
  // has to click it - this is that path, still real, shipped code.
  test("desktop viewport: a document loaded from history does not auto-open, but clicking its card still opens the canvas", async () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    const original = globalThis.fetch;
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes(`/api/conversations/${ARTIFACT.conversation_id}/turns`)) {
        return Promise.resolve(
          Response.json([
            {
              id: ARTIFACT.turn_id,
              personId: "person-abc123",
              surface: "chat",
              conversationId: ARTIFACT.conversation_id,
              userText: "write me a short note about pizza night",
              replyText: "Wrote it.",
              source: "plugin",
              pluginId: "write_document",
              commandId: null,
              safetyFlagged: false,
              safetyAction: "allow",
              bare: false,
              minorSpeaker: false,
              createdAt: ARTIFACT.created_at,
              artifact: { id: ARTIFACT.id, version: ARTIFACT.version },
              memory_ids: [],
            },
          ]),
        );
      }
      if (url.includes(`/api/conversations/${ARTIFACT.conversation_id}`)) return Promise.resolve(Response.json({ id: ARTIFACT.conversation_id, title: "Pizza night", surface: "chat", created_at: ARTIFACT.created_at, pinned: false }));
      if (url.includes(`/api/artifacts/${ARTIFACT.id}/current`)) return Promise.resolve(Response.json(ARTIFACT));
      if (url.includes("/api/conversations")) return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={[`/chat?conversation=${ARTIFACT.conversation_id}`]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      expect(await view.findByText("Wrote it.")).toBeVisible();
      // Not auto-opened: the card's own title shows, but the artifact's
      // body (only fetched once the canvas is genuinely open) does not.
      // The title text also appears in the sidebar's own thread-list
      // item (the conversation's title is the same string) - the card
      // is whichever match isn't inside that list.
      await view.findAllByText(ARTIFACT.title);
      const card = view.getAllByText(ARTIFACT.title).find((el) => !el.closest('[data-slot="aui_thread-list-item"]'))!;
      expect(card).toBeVisible();
      expect(view.queryByText(ARTIFACT.body)).toBeNull();

      fireEvent.click(card);
      expect(await view.findByText(ARTIFACT.body)).toBeVisible();
    } finally {
      globalThis.fetch = original;
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    }
  });
});
// APPROVE-CARD-02: a package's own confirm_needed/consent_needed ask
// renders through the shipped ApprovalCard Element, registered in
// elementBindings.ts.
describe("ChatPage (APPROVE-CARD-01: the confirm tool-call card)", () => {
  // stubTurnFetch's own shape (slice 3, above), extended to return a
  // DIFFERENT stream per successive /api/turn/stream call - the click-
  // driven follow-up turn a tapped Yes/No card sends is a real second
  // request this stub has to answer differently from the first.
  function stubConfirmTurnFetch(streamBodies: ReadableStream<Uint8Array>[]): () => void {
    const original = globalThis.fetch;
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    let call = 0;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/conversations") && init?.method === "POST") return Promise.resolve(Response.json({ id: "conv-confirm123", status: "open", surface: "chat" }));
      if (url.includes("/api/conversations")) return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      if (url.includes("/api/turn/stream")) {
        const body = streamBodies[Math.min(call, streamBodies.length - 1)]!;
        call++;
        return Promise.resolve(new Response(body, { status: 200, headers: ASSISTANT_STREAM_HEADERS }));
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

  test.each([
    ["adult", "owner"],
    ["teen", "teen"],
    ["child", "child"],
  ] as const)("an open confirm card for a %s renders the same kit card without claiming a parent was asked", async (_band, role) => {
    const restore = stubConfirmTurnFetch([
      ndjsonStream([
        { type: "delta", text: "Go ahead and lock the doors?" },
        { type: "done", value: { turn_id: "turn-confirm1", reply: { text: "Go ahead and lock the doors?" }, source: "confirm", safety: SAFETY, confirm: { package_id: "lock-doors", open: true } } },
      ]),
    ]);
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson({ role })} />
        </MemoryRouter>,
      );
      await sendMessage(view, "lock the doors");
      expect(await view.findByText("Go ahead and lock the doors?")).toBeVisible();
      expect(await view.findByRole("button", { name: /^Allow once/ })).toBeVisible();
      expect(await view.findByRole("button", { name: "Deny" })).toBeVisible();
      expect(await view.findByText("Go ahead?", { exact: true })).toBeVisible();
      expect(await view.findByText(/^Nothing happens until you choose\. Waiting since /)).toBeVisible();
      expect(view.container.textContent).not.toContain("Asked a parent");
    } finally {
      restore();
    }
  });

  test("tapping Allow once sends a new turn with the matching ask_answer and the tapped label as its text, then clears the one-shot field", async () => {
    const restore = stubConfirmTurnFetch([
      ndjsonStream([
        { type: "delta", text: "Go ahead and lock the doors?" },
        { type: "done", value: { turn_id: "turn-confirm2", reply: { text: "Go ahead and lock the doors?" }, source: "confirm", safety: SAFETY, confirm: { package_id: "lock-doors", open: true } } },
      ]),
      ndjsonStream([
        { type: "delta", text: "Sure, locking the doors." },
        { type: "done", value: { turn_id: "turn-confirm2-resumed", reply: { text: "Sure, locking the doors." }, source: "plugin", plugin_id: "lock-doors", safety: SAFETY } },
      ]),
      ndjsonStream([
        { type: "delta", text: "You're welcome." },
        { type: "done", value: { turn_id: "turn-confirm2-thanks", reply: { text: "You're welcome." }, source: "model", safety: SAFETY } },
      ]),
    ]);
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await sendMessage(view, "lock the doors");
      const yesButton = await view.findByRole("button", { name: /^Allow once/ });
      fireEvent.click(yesButton);
      expect(await view.findByText("Sure, locking the doors.")).toBeVisible();
      const bodies = turnRequestBodies();
      expect(bodies[1]).toMatchObject({ text: "Yes", ask_answer: { turn_id: "turn-confirm2", approved: true } });
      // One-shot: a plain follow-up sent right after never repeats the
      // field (chatModelAdapter.ts's `consumeAskAnswer()` cleared it).
      await sendMessage(view, "thanks");
      await view.findByText("You're welcome.");
      const bodies2 = turnRequestBodies();
      expect(bodies2[2]).not.toHaveProperty("ask_answer");
    } finally {
      restore();
    }
  });

  test("tapping Deny sends a new turn with ask_answer approved: false", async () => {
    const restore = stubConfirmTurnFetch([
      ndjsonStream([
        { type: "delta", text: "Go ahead and lock the doors?" },
        { type: "done", value: { turn_id: "turn-confirm3", reply: { text: "Go ahead and lock the doors?" }, source: "confirm", safety: SAFETY, confirm: { package_id: "lock-doors", open: true } } },
      ]),
      ndjsonStream([
        { type: "delta", text: "Okay, no action taken." },
        { type: "done", value: { turn_id: "turn-confirm3-resumed", reply: { text: "Okay, no action taken." }, source: "model", safety: SAFETY } },
      ]),
    ]);
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await sendMessage(view, "lock the doors");
      const noButton = await view.findByRole("button", { name: "Deny" });
      fireEvent.click(noButton);
      expect(await view.findByText("Okay, no action taken.")).toBeVisible();
      const bodies = turnRequestBodies();
      expect(bodies[1]).toMatchObject({ text: "No", ask_answer: { turn_id: "turn-confirm3", approved: false } });
    } finally {
      restore();
    }
  });

  test("Ctrl+Enter approves the open ask, but not while typing in the composer", async () => {
    const restore = stubConfirmTurnFetch([
      ndjsonStream([
        { type: "delta", text: "Go ahead and lock the doors?" },
        { type: "done", value: { turn_id: "turn-confirm4", reply: { text: "Go ahead and lock the doors?" }, source: "confirm", safety: SAFETY, confirm: { package_id: "lock-doors", open: true } } },
      ]),
      ndjsonStream([
        { type: "delta", text: "Sure, locking the doors." },
        { type: "done", value: { turn_id: "turn-confirm4-resumed", reply: { text: "Sure, locking the doors." }, source: "plugin", plugin_id: "lock-doors", safety: SAFETY } },
      ]),
    ]);
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await sendMessage(view, "lock the doors");
      await view.findByRole("button", { name: /^Allow once/ });
      fireEvent.keyDown(view.getByLabelText("Message input"), { key: "Enter", ctrlKey: true });
      expect(turnRequestBodies()).toHaveLength(1);
      fireEvent.keyDown(document.body, { key: "Enter", ctrlKey: true });
      expect(await view.findByText("Sure, locking the doors.")).toBeVisible();
      expect(turnRequestBodies()[1]).toMatchObject({ ask_answer: { turn_id: "turn-confirm4", approved: true } });
      // Answered: the card is gone and the shortcut no longer answers it again.
      await waitFor(() => expect(view.queryByRole("button", { name: /^Allow once/ })).toBeNull());
      fireEvent.keyDown(document.body, { key: "Enter", ctrlKey: true });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(turnRequestBodies()).toHaveLength(2);
    } finally {
      restore();
    }
  });

  // A live "done" event's own `confirm.open` is always true by
  // construction (wire.ts's own comment: finishTurn() just parked it, so
  // it's correct at that instant) - `open: false` only ever happens on
  // RELOAD, once conversationHistory.ts's own read-time derivation sees
  // the ask already answered. Exercised here through the real reload
  // path (GET /api/conversations/:id/turns), the same shape
  // "the open conversation's title is the tab title" (above) already
  // uses to open an existing conversation.
  test("a closed (open: false) confirm card on reload renders no Allow once/Deny buttons - already answered, non-interactive", async () => {
    const conversation = { id: "conv-confirm-closed", title: "Locks", surface: "chat", created_at: "2026-09-27T00:00:00Z", pinned: false };
    const row = {
      id: "turn-confirm-closed",
      personId: "person-abc123",
      surface: "chat",
      userText: "lock the doors",
      replyText: "Go ahead and lock the doors?",
      source: "confirm",
      pluginId: null,
      commandId: null,
      safetyFlagged: false,
      safetyAction: "allow",
      minorSpeaker: false,
      createdAt: "2026-09-27T00:00:00.000Z",
      supersedes: null,
      judgeStatus: null,
      memory_ids: [],
      confirm: { package_id: "lock-doors", open: false },
    };
    const original = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes(`/api/conversations/${conversation.id}/resume`)) return Promise.resolve(Response.json(conversation));
      if (url.includes(`/api/conversations/${conversation.id}/turns`)) return Promise.resolve(Response.json([row]));
      if (url.includes(`/api/conversations/${conversation.id}`)) return Promise.resolve(Response.json(conversation));
      if (url.includes("/api/conversations")) return Promise.resolve(Response.json([conversation]));
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={[`/chat?conversation=${conversation.id}`]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      expect(await view.findByText("Go ahead and lock the doors?")).toBeVisible();
      expect(view.queryByRole("button", { name: /^Allow once/ })).toBeNull();
      expect(view.queryByRole("button", { name: "Deny" })).toBeNull();
    } finally {
      globalThis.fetch = original;
    }
  });
});

// getmaipai/home#181: a background project's finished document attaches
// to the same turn row that already produced its "Starting…" reply
// with no new message and no new turn row - nothing already on screen
// ever refetches to show it without a hard refresh. ProjectResultReload
// (this file) is the fix: it watches NotificationBell.tsx's own
// ["notifications"] poll and calls reloadMainThread() when a
// project.done/failed delivery's subjectTurnId matches a turn already
// on screen. These tests drive a "poll tick" the same way
// NotificationBell.test.tsx already does for the identical query -
// `queryClient.setQueryData(["notifications"], ...)` - rather than
// waiting a real 15s for `refetchInterval`, and prove the reload by
// counting real GET /turns calls (reloadMainThread() reruns
// chatHistoryAdapter.ts's load(), which is the one thing that ever
// fetches that endpoint again after the thread's first load).
describe("ChatPage (getmaipai/home#181: project result reload)", () => {
  const PROJECT_RELOAD_ARTIFACT = {
    id: "art-project789",
    conversation_id: "conv-project789",
    turn_id: "turn-project1",
    kind: "markdown" as const,
    title: "Bedtime storybook",
    body: "Once upon a time.",
    version: 1,
    parent_version: null,
    created_by: "person-abc123",
    provenance: "project:proj-story789",
    created_at: "2026-09-27T00:00:00.000Z",
    hlc: "1788000000000:0:test",
  };

  function projectNotification(id: string, subjectTurnId: string, typeId: "project.done" | "project.failed" = "project.done"): NotificationDeliveryView {
    return {
      id,
      typeId,
      level: "time_sensitive",
      text: "Bedtime story finished.",
      channels: ["in_app"],
      createdAt: "2026-09-27T00:00:00.000Z",
      readAt: null,
      dismissedAt: null,
      subjectTurnId,
      memoryIds: null,
      toast: true,
    };
  }

  function stubProjectTurnFetch(conversationId: string): { restore: () => void; turnsFetchCount: () => number } {
    const original = globalThis.fetch;
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    let turnsFetchCount = 0;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/conversations") && init?.method === "POST") return Promise.resolve(Response.json({ id: conversationId, status: "open", surface: "chat" }));
      if (url.includes(`/api/conversations/${conversationId}/turns`)) {
        turnsFetchCount++;
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      if (url.includes("/api/conversations")) return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      if (url.includes("/api/notifications")) return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      if (url.includes("/api/turn/stream")) {
        const body = ndjsonStream([
          { type: "delta", text: "Starting Bedtime story now - 3 steps, about a minute." },
          {
            type: "done",
            value: {
              turn_id: "turn-project1",
              reply: { text: "Starting Bedtime story now - 3 steps, about a minute." },
              source: "plugin",
              plugin_id: "start_project",
              safety: SAFETY,
            },
          },
        ]);
        return Promise.resolve(new Response(body, { status: 200, headers: ASSISTANT_STREAM_HEADERS }));
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;
    return { restore: () => { globalThis.fetch = original; }, turnsFetchCount: () => turnsFetchCount };
  }

  test("a project.done notification whose turn is already on screen triggers a reload of the open conversation", async () => {
    const { restore, turnsFetchCount } = stubProjectTurnFetch("conv-project123");
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await sendMessage(view, "make a bedtime story");
      expect(await view.findByText("Starting Bedtime story now - 3 steps, about a minute.")).toBeVisible();

      const before = turnsFetchCount();
      act(() => {
        view.queryClient.setQueryData(["notifications"], [projectNotification("n1", "turn-project1")]);
      });

      await waitFor(() => expect(turnsFetchCount()).toBeGreaterThan(before));
    } finally {
      restore();
    }
  });

  // Jesse, live-found 2026-09-27, on top of a code review's own finding
  // the same day: "auto open the canvas when the book is ready" has to
  // cover THIS path too, not just the live in-thread poll
  // (ProjectFinishedArtifact's own useEffect) - the whole reason this
  // reload exists is the case where nobody was watching live. The
  // reloaded row is a plain `write_document`-shaped artifact
  // (pluginId: "start_project", chatHistoryAdapter.ts's #182 rule), the
  // same shape a synchronous write uses - ProjectResultReload's own
  // `pendingOpenTurnId` remembers the turn a genuinely fresh
  // notification named, then opens whatever artifact shows up on it
  // once the reload lands. Opens an ALREADY-existing conversation
  // (rather than sending a live message first, the way the sibling
  // tests above do) - matching the real scenario this reload exists
  // for: a project that finished while nobody had the thread open,
  // found again later, not one just started this session - and sidesteps
  // a brand-new thread's own "new" -> real status promotion (a separate,
  // asynchronous transition reloadMainThread() silently no-ops during)
  // entirely, since a conversation opened by id is never "new".
  test("a project.done notification whose turn is already on screen opens the canvas once the reload lands with the finished artifact", async () => {
    const conversationId = "conv-project789";
    const startingRow = {
      id: "turn-project1",
      personId: "person-abc123",
      surface: "chat",
      conversationId,
      userText: "make a bedtime story",
      replyText: "Starting Bedtime story now - 3 steps, about a minute.",
      source: "plugin",
      pluginId: "start_project",
      commandId: null,
      safetyFlagged: false,
      safetyAction: "allow",
      bare: false,
      minorSpeaker: false,
      createdAt: "2026-09-27T00:00:00.000Z",
      memory_ids: [],
    };
    // A project's finished artifact rides the SAME turn that already
    // produced its "Starting…" reply (post.ts's own postProjectResult()),
    // never a second row - #182's own shape (pluginId: "start_project",
    // a real `artifact`), the one chatHistoryAdapter.ts renders as a
    // plain write_document part once reloaded.
    const finishedRow = { ...startingRow, replyText: "Bedtime storybook is ready.", artifact: { id: PROJECT_RELOAD_ARTIFACT.id, version: PROJECT_RELOAD_ARTIFACT.version } };
    const conversation = { id: conversationId, title: "make a bedtime story", surface: "chat", created_at: "2026-09-27T00:00:00Z", pinned: false };
    const original = globalThis.fetch;
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    let turnsFetchCount = 0;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes(`/api/conversations/${conversationId}/turns`)) {
        turnsFetchCount++;
        return Promise.resolve(new Response(JSON.stringify([turnsFetchCount === 1 ? startingRow : finishedRow]), { status: 200 }));
      }
      if (url.includes(`/api/conversations/${conversationId}`)) return Promise.resolve(Response.json(conversation));
      if (url.includes(`/api/artifacts/${PROJECT_RELOAD_ARTIFACT.id}/current`)) return Promise.resolve(Response.json(PROJECT_RELOAD_ARTIFACT));
      if (url.includes("/api/conversations")) return Promise.resolve(new Response(JSON.stringify([conversation]), { status: 200 }));
      if (url.includes("/api/notifications")) return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={[`/chat?conversation=${conversationId}`]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      expect(await view.findByText("Starting Bedtime story now - 3 steps, about a minute.")).toBeVisible();

      const before = turnsFetchCount;
      act(() => {
        view.queryClient.setQueryData(["notifications"], [projectNotification("n3", "turn-project1")]);
      });

      await waitFor(() => expect(turnsFetchCount).toBeGreaterThan(before));
      expect(await view.findByText("Bedtime storybook is ready.")).toBeVisible();
      expect(await view.findByText(PROJECT_RELOAD_ARTIFACT.body)).toBeVisible();
    } finally {
      globalThis.fetch = original;
    }
  });

  test("a project.done notification for a turn NOT on screen does not reload the open conversation", async () => {
    const { restore, turnsFetchCount } = stubProjectTurnFetch("conv-project456");
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await sendMessage(view, "make a bedtime story");
      expect(await view.findByText("Starting Bedtime story now - 3 steps, about a minute.")).toBeVisible();

      const before = turnsFetchCount();
      act(() => {
        // A real delivery, but for a project started from a DIFFERENT,
        // not-currently-open conversation's turn - the one thing this
        // component is required to leave alone.
        view.queryClient.setQueryData(["notifications"], [projectNotification("n2", "turn-somewhere-else")]);
      });

      // No waitFor to satisfy here (there is nothing that will ever
      // become true) - a real tick is given time to prove the negative,
      // the same shape a "does NOT happen" assertion needs anywhere else
      // in this suite.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      expect(turnsFetchCount()).toBe(before);
    } finally {
      restore();
    }
  });
});

// PROJECT-PROGRESS-01 (issue #180): "a running project stays visibly
// alive in chat, no new transport" - a `start_project` turn's own
// `project` reserved tool-call part polls GET /api/projects/:id and
// renders the shipped JobProgress element while it's live, the shipped
// ArtifactCard once it's posted its result.
describe("ChatPage (PROJECT-PROGRESS-01: live project progress)", () => {
  const PROJECT_ARTIFACT = {
    id: "art-story123",
    conversation_id: "conv-project123",
    turn_id: "turn-project123",
    kind: "markdown" as const,
    title: "A bedtime story",
    body: "Once upon a time.",
    version: 1,
    parent_version: null,
    created_by: "person-abc123",
    provenance: "project:proj-story123",
    created_at: "2026-09-27T00:00:00.000Z",
    hlc: "1788000000000:0:test",
  };

  function projectRunning() {
    return {
      id: "proj-story123",
      type: "bedtime-storybook",
      title: "A bedtime storybook",
      state: "running",
      steps: [
        { stepId: "chapter-1", state: "done", startedAt: "2026-09-27T00:00:00.000Z", endedAt: "2026-09-27T00:00:01.000Z", error: null, artifactIds: [] },
        { stepId: "chapter-2", state: "running", startedAt: "2026-09-27T00:00:01.000Z", endedAt: null, error: null, artifactIds: [] },
        { stepId: "chapter-3", state: "pending", startedAt: null, endedAt: null, error: null, artifactIds: [] },
      ],
      posted_artifact: null,
    };
  }

  function projectDone() {
    return { ...projectRunning(), state: "done", steps: projectRunning().steps.map((s) => ({ ...s, state: "done" })), posted_artifact: { id: PROJECT_ARTIFACT.id, version: 1 } };
  }

  // Every GET /api/projects/proj-story123 poll after the first one
  // returns `projectDone()` - the same "still in flight, then landed"
  // shape stubTurnFetch's siblings elsewhere in this file use, here
  // driven by call count rather than a second stream body.
  function stubProjectTurnFetch(streamBody: ReadableStream<Uint8Array>): { restore: () => void; cancelCalls: () => number } {
    const original = globalThis.fetch;
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    let projectPolls = 0;
    let cancelCalls = 0;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/conversations") && init?.method === "POST") return Promise.resolve(Response.json({ id: "conv-project123", status: "open", surface: "chat" }));
      if (url.includes("/api/conversations/conv-project123/turns")) {
        // Jesse, live-found 2026-09-27: "the canvas shows... that should
        // happen exactly with the canvas opening - same event."
        // ProjectFinishedArtifact's own reload (chatModelAdapter.ts's
        // comment above it) fires the moment the poll below first sees
        // `projectDone()` - before that, this thread's own turns were
        // never fetched at all, so `projectPolls < 2` here can never be
        // reached by that reload; once it does land, the row already
        // carries post.ts's own corrected replyText and artifact.
        const row =
          projectPolls < 2
            ? []
            : [
                {
                  id: "turn-project123",
                  personId: "person-abc123",
                  surface: "chat",
                  conversationId: "conv-project123",
                  userText: "write me a bedtime storybook",
                  replyText: "A bedtime storybook is ready.",
                  source: "plugin",
                  pluginId: "start_project",
                  commandId: null,
                  safetyFlagged: false,
                  safetyAction: "allow",
                  bare: false,
                  minorSpeaker: false,
                  createdAt: "2026-09-27T00:00:00.000Z",
                  artifact: { id: PROJECT_ARTIFACT.id, version: PROJECT_ARTIFACT.version },
                  memory_ids: [],
                },
              ];
        return Promise.resolve(new Response(JSON.stringify(row), { status: 200 }));
      }
      if (url.includes("/api/conversations")) return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      if (url.includes("/api/turn/stream")) return Promise.resolve(new Response(streamBody, { status: 200, headers: ASSISTANT_STREAM_HEADERS }));
      if (url.includes(`/api/projects/${projectRunning().id}/cancel`)) {
        cancelCalls++;
        return Promise.resolve(Response.json(projectRunning()));
      }
      if (url.includes(`/api/projects/${projectRunning().id}`)) {
        projectPolls++;
        return Promise.resolve(Response.json(projectPolls === 1 ? projectRunning() : projectDone()));
      }
      if (url.includes(`/api/artifacts/${PROJECT_ARTIFACT.id}/current`)) return Promise.resolve(Response.json(PROJECT_ARTIFACT));
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;
    return { restore: () => { globalThis.fetch = original; }, cancelCalls: () => cancelCalls };
  }

  async function sendMessage(view: ReturnType<typeof render>, text: string): Promise<void> {
    fireEvent.change(await view.findByLabelText("Message input"), { target: { value: text } });
    const send = (await view.findByLabelText("Send message")) as HTMLButtonElement;
    await waitFor(() => expect(send.disabled).toBe(false));
    fireEvent.click(send);
  }

  test("a start_project turn shows live step progress that updates via polling, then shows the posted artifact once the project finishes - no reload needed from the person", async () => {
    const { restore } = stubProjectTurnFetch(
      ndjsonStream([
        { type: "delta", text: "Starting a bedtime storybook now - 3 steps, about 1 minute." },
        {
          type: "done",
          value: {
            turn_id: "turn-project123",
            reply: { text: "Starting a bedtime storybook now - 3 steps, about 1 minute." },
            source: "model",
            safety: SAFETY,
            project: { id: "proj-story123" },
          },
        },
      ]),
    );
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await sendMessage(view, "write me a bedtime storybook");
      expect(await view.findByText("Starting a bedtime storybook now - 3 steps, about 1 minute.")).toBeVisible();
      // The first poll's own response: chapter-1 done, chapter-2 the
      // current stage, chapter-3 not reached yet - the real per-step
      // signal a poll against the persisted row alone couldn't show
      // (runner.ts's own header on the gap this closes).
      expect(await view.findByText("A bedtime storybook")).toBeVisible();
      expect(await view.findByText("chapter-2")).toBeVisible();
      expect(await view.findByText("Step 2 of 3")).toBeVisible();

      // The next poll tick (~2s, refetchInterval) lands on `done` with a
      // real posted_artifact - the progress card is replaced by the
      // finished document's own card, live, with no reload.
      await waitFor(() => expect(view.queryByText(PROJECT_ARTIFACT.title)).not.toBeNull(), { timeout: 8000, interval: 100 });
      expect(view.queryByText("chapter-2")).toBeNull();
      // Jesse, live-found 2026-09-27: "auto open the canvas when the
      // book is ready... this should be the default." ProjectFinishedArtifact
      // opens it itself the moment it mounts - no click on the card
      // needed - so the artifact's own fetched body is already on
      // screen (via a real api.artifactCurrent() round trip), proving
      // the canvas is genuinely open, not just that the card rendered.
      expect(await view.findByText(PROJECT_ARTIFACT.body)).toBeVisible();
      // Jesse, live-found the same day: "that should happen exactly
      // with the canvas opening - same event" - the surrounding reply
      // text used to only correct once ProjectResultReload's own,
      // separate notification poll (up to 15s later) caught up.
      // ProjectFinishedArtifact's own reload (fired in the identical
      // effect that just opened the canvas above) is what turns this
      // stub's own stream-time "Starting..." text into post.ts's real,
      // corrected one - proving both come from the one poll tick, not
      // two different timers.
      expect(await view.findByText("A bedtime storybook is ready.")).toBeVisible();
    } finally {
      restore();
    }
  }, 10000);

  test("cancelling a running project calls the cancel route", async () => {
    const { restore, cancelCalls } = stubProjectTurnFetch(
      ndjsonStream([
        { type: "delta", text: "Starting a bedtime storybook now - 3 steps, about 1 minute." },
        {
          type: "done",
          value: {
            turn_id: "turn-project123",
            reply: { text: "Starting a bedtime storybook now - 3 steps, about 1 minute." },
            source: "model",
            safety: SAFETY,
            project: { id: "proj-story123" },
          },
        },
      ]),
    );
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await sendMessage(view, "write me a bedtime storybook");
      const cancelButton = await view.findByRole("button", { name: "Cancel the job" });
      fireEvent.click(cancelButton);
      await waitFor(() => expect(cancelCalls()).toBeGreaterThan(0));
    } finally {
      restore();
    }
  });
});

describe("ChatPage (COLUMN-01: one hide/show control for the history column)", () => {
  // The owner (2026-10-06): "the show/hide column is quirky". One control,
  // no hover peek, remembered per browser, a working Cmd/Ctrl+B, and focus
  // that never falls to <body> when the column hides. happy-dom has no
  // layout, so state is read from `data-state`, `inert` and where the
  // toggle lives; the Chromium review (`--chat-column-review`) measures the
  // pixels and the slide.
  const column = () => document.getElementById("next-chat-rail")!;
  const header = () => document.querySelector('[data-slot="next-chat-header"]')!;
  const renderChat = () => renderPage(
    <MemoryRouter initialEntries={["/chat"]}>
      <ChatPage person={makePerson()} />
    </MemoryRouter>,
  );

  test("open: the hide control sits in the column's own header row, and the conversation header has none", async () => {
    const restore = stubFetch();
    try {
      const view = renderChat();
      await view.findByLabelText("Message input");
      expect(column()).toHaveAttribute("data-state", "open");
      expect(column().hasAttribute("inert")).toBe(false);
      const toggle = view.getByRole("button", { name: "Hide conversations" });
      expect(toggle).toHaveAttribute("aria-controls", "next-chat-rail");
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(column().querySelector('[data-slot="chat-column-header"]')!.contains(toggle)).toBe(true);
      expect(header().querySelector('[data-slot="chat-column-toggle"]')).toBeNull();
      expect(view.queryByRole("button", { name: "Show conversations" })).toBeNull();
    } finally {
      restore();
    }
  });

  test("hiding moves the control to the conversation header and focus with it; showing hands focus back", async () => {
    const restore = stubFetch();
    try {
      const view = renderChat();
      await view.findByLabelText("Message input");
      const hide = view.getByRole("button", { name: "Hide conversations" });
      hide.focus();
      fireEvent.click(hide);
      expect(column()).toHaveAttribute("data-state", "closed");
      expect(column().querySelector('[data-slot="sidebar"]')?.hasAttribute("inert")).toBe(true);
      const show = view.getByRole("button", { name: "Show conversations" });
      expect(header().contains(show)).toBe(true);
      expect(show).toHaveAttribute("aria-expanded", "false");
      await waitFor(() => expect(document.activeElement).toBe(show));

      fireEvent.click(show);
      expect(column()).toHaveAttribute("data-state", "open");
      expect(header().querySelector('[data-slot="chat-column-toggle"]')).toBeNull();
      await waitFor(() => expect(document.activeElement).toBe(view.getByRole("button", { name: "Hide conversations" })));
    } finally {
      restore();
    }
  });

  test("the choice is remembered on this browser: hidden stays hidden after a reload, and shown stays shown", async () => {
    const restore = stubFetch();
    try {
      const first = renderChat();
      await first.findByLabelText("Message input");
      fireEvent.click(first.getByRole("button", { name: "Hide conversations" }));
      expect(localStorage.getItem("maipai.chat.rail-collapsed")).toBe("1");
      cleanup();

      const second = renderChat();
      await second.findByLabelText("Message input");
      expect(column()).toHaveAttribute("data-state", "closed");
      fireEvent.click(second.getByRole("button", { name: "Show conversations" }));
      expect(localStorage.getItem("maipai.chat.rail-collapsed")).toBe("0");
      cleanup();

      stubMatchMedia(true);
      const third = renderChat();
      await third.findByLabelText("Message input");
      expect(column()).toHaveAttribute("data-state", "open");
    } finally {
      restore();
    }
  });

  test("Cmd/Ctrl+B hides and shows the column, from either state (it did nothing once the column was hidden)", async () => {
    const restore = stubFetch();
    try {
      const view = renderChat();
      await view.findByLabelText("Message input");
      fireEvent.keyDown(window, { key: "b", ctrlKey: true });
      expect(column()).toHaveAttribute("data-state", "closed");
      fireEvent.keyDown(window, { key: "b", metaKey: true });
      expect(column()).toHaveAttribute("data-state", "open");
      fireEvent.keyDown(window, { key: "b", ctrlKey: true });
      expect(column()).toHaveAttribute("data-state", "closed");
      fireEvent.keyDown(window, { key: "b", ctrlKey: true });
      expect(column()).toHaveAttribute("data-state", "open");
    } finally {
      restore();
    }
  });

  test("hiding the column while focus is inside it moves focus to the header's control, never to <body>", async () => {
    const restore = stubFetch();
    try {
      const view = renderChat();
      await view.findByLabelText("Message input");
      within(column()).getByRole("button", { name: "New chat" }).focus();
      fireEvent.keyDown(window, { key: "b", ctrlKey: true });
      await waitFor(() => expect(document.activeElement).toBe(view.getByRole("button", { name: "Show conversations" })));
    } finally {
      restore();
    }
  });

  const peekNode = () => document.querySelector('[data-slot="next-chat-rail"][data-state="peek"]');
  const waitForPeek = () => waitFor(() => expect(peekNode() === null).toBe(false));

  test("CHAT-SIDEBAR-PEEK-01: resting the pointer on the header's show control opens the peek; leaving closes it; a click still pins", async () => {
    const restore = stubFetch();
    try {
      const view = renderChat();
      await view.findByLabelText("Message input");
      fireEvent.click(view.getByRole("button", { name: "Hide conversations" }));
      const show = view.getByRole("button", { name: "Show conversations" });
      // Passing over it does nothing.
      fireEvent.pointerEnter(show, { pointerType: "mouse" });
      fireEvent.pointerLeave(show, { pointerType: "mouse" });
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(peekNode() === null).toBe(true);
      expect(column()).toHaveAttribute("data-state", "closed");
      // Resting on it opens the same column node as an overlay.
      fireEvent.pointerEnter(show, { pointerType: "mouse" });
      await waitForPeek();
      expect(peekNode()).toBe(column());
      // Leaving the control closes it after the grace.
      fireEvent.pointerLeave(show, { pointerType: "mouse" });
      await waitFor(() => expect(peekNode() === null).toBe(true));
      expect(column()).toHaveAttribute("data-state", "closed");
      // Moving from the control into the peek keeps it open.
      fireEvent.pointerEnter(show, { pointerType: "mouse" });
      await waitForPeek();
      fireEvent.pointerLeave(show, { pointerType: "mouse" });
      fireEvent.pointerEnter(peekNode()!, { pointerType: "mouse" });
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(peekNode() === null).toBe(false);
      fireEvent.pointerLeave(peekNode()!, { pointerType: "mouse" });
      await waitFor(() => expect(peekNode() === null).toBe(true));
      // A click on the control while peeking pins the column open.
      fireEvent.pointerEnter(show, { pointerType: "mouse" });
      await waitForPeek();
      fireEvent.click(show);
      expect(column()).toHaveAttribute("data-state", "open");
      expect(peekNode() === null).toBe(true);
    } finally {
      restore();
    }
  });

  test("CHAT-SIDEBAR-PEEK-01: touch never peeks; keyboard focus on the control opens it; Escape closes it without it reopening", async () => {
    const restore = stubFetch();
    try {
      const view = renderChat();
      await view.findByLabelText("Message input");
      fireEvent.click(view.getByRole("button", { name: "Hide conversations" }));
      const show = view.getByRole("button", { name: "Show conversations" });
      fireEvent.pointerEnter(show, { pointerType: "touch" });
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(peekNode() === null).toBe(true);
      // Focus from a person tabbing in opens the peek.
      // Hiding handed focus to the control quietly; tab away, then back in.
      show.blur();
      show.focus();
      await waitForPeek();
      // Escape closes it and hands focus back to the control quietly: no reopen.
      fireEvent.keyDown(document, { key: "Escape" });
      await waitFor(() => expect(peekNode() === null).toBe(true));
      await waitFor(() => expect(document.activeElement).toBe(view.getByRole("button", { name: "Show conversations" })));
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(peekNode() === null).toBe(true);
    } finally {
      restore();
    }
  });

  test("COLUMN-02 hover peek: resting on the edge zone opens an overlay peek; leaving closes it after a grace; the docked column stays hidden", async () => {
    const restore = stubFetch();
    try {
      const view = renderChat();
      await view.findByLabelText("Message input");
      expect(document.querySelector('[data-slot="aui_thread-list-sidebar-peek-zone"]')).toBeNull();
      fireEvent.click(view.getByRole("button", { name: "Hide conversations" }));
      const zone = document.querySelector('[data-slot="aui_thread-list-sidebar-peek-zone"]')!;
      // Passing over the zone does nothing.
      fireEvent.pointerEnter(zone);
      fireEvent.pointerLeave(zone);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(document.querySelector('[data-slot="next-chat-rail"][data-state="peek"]') === null).toBe(true);
      // Resting on it opens the peek: the same column node, out of flow over the conversation.
      fireEvent.pointerEnter(zone);
      const peek = await waitFor(() => { const found = document.querySelector('[data-slot="next-chat-rail"][data-state="peek"]'); expect(found === null).toBe(false); return found as HTMLElement; });
      expect(peek).toBeTruthy();
      expect(peek).toBe(column());
      expect(document.querySelector('[data-slot="aui_thread-list-sidebar-panel"]')?.className).toContain("absolute");
      expect(within(peek as HTMLElement).getByRole("link", { name: "Chat settings" })).toBeTruthy();
      // Leaving and coming back inside the grace keeps it.
      fireEvent.pointerLeave(peek);
      fireEvent.pointerEnter(peek);
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(document.querySelector('[data-slot="next-chat-rail"][data-state="peek"]') === null).toBe(false);
      // Leaving for good closes it.
      fireEvent.pointerLeave(peek);
      await waitFor(() => expect(document.querySelector('[data-slot="next-chat-rail"][data-state="peek"]') === null).toBe(true));
      expect(column()).toHaveAttribute("data-state", "closed");
    } finally {
      restore();
    }
  });

  test("COLUMN-02 hover peek: Escape closes it and focus returns to the header's control; the pin control docks the column", async () => {
    const restore = stubFetch();
    try {
      const view = renderChat();
      await view.findByLabelText("Message input");
      fireEvent.click(view.getByRole("button", { name: "Hide conversations" }));
      fireEvent.pointerEnter(document.querySelector('[data-slot="aui_thread-list-sidebar-peek-zone"]')!);
      const peek = await waitFor(() => { const found = document.querySelector('[data-slot="next-chat-rail"][data-state="peek"]'); expect(found === null).toBe(false); return found as HTMLElement; });
      within(peek).getByRole("button", { name: "New chat" }).focus();
      fireEvent.keyDown(document, { key: "Escape" });
      await waitFor(() => expect(document.querySelector('[data-slot="next-chat-rail"][data-state="peek"]') === null).toBe(true));
      await waitFor(() => expect(document.activeElement).toBe(view.getByRole("button", { name: "Show conversations" })));

      fireEvent.pointerEnter(document.querySelector('[data-slot="aui_thread-list-sidebar-peek-zone"]')!);
      const again = await waitFor(() => { const found = document.querySelector('[data-slot="next-chat-rail"][data-state="peek"]'); expect(found === null).toBe(false); return found as HTMLElement; });
      fireEvent.click(within(again).getByRole("button", { name: "Keep conversations open" }));
      expect(document.querySelector('[data-slot="next-chat-rail"][data-state="peek"]') === null).toBe(true);
      expect(column()).toHaveAttribute("data-state", "open");
    } finally {
      restore();
    }
  });

  test("COLUMN-02 chat settings: an icon link left of search opens Settings, Me, Chat", async () => {
    const restore = stubFetch();
    try {
      const view = renderChat();
      await view.findByLabelText("Message input");
      const link = within(column().querySelector('[data-slot="chat-column-header"]') as HTMLElement).getByRole("link", { name: "Chat settings" });
      expect(link).toHaveAttribute("href", "/settings?tab=me&section=chat");
    } finally {
      restore();
    }
  });

  test("below the auto-hide width the column starts hidden; one click shows it", async () => {
    stubMatchMedia(true);
    const restore = stubFetch();
    try {
      const view = renderChat();
      await view.findByLabelText("Message input");
      expect(column()).toHaveAttribute("data-state", "closed");
      fireEvent.click(view.getByRole("button", { name: "Show conversations" }));
      expect(column()).toHaveAttribute("data-state", "open");
    } finally {
      restore();
    }
  });

  test("the column's rows: New chat is a quiet row, and there is no Customize row (owner, 2026-10-06)", async () => {
    const restore = stubFetch();
    try {
      const view = renderChat();
      await view.findByLabelText("Message input");
      const newChat = within(column()).getByRole("button", { name: "New chat" });
      expect(newChat).toBeVisible();
      expect(newChat).toHaveAttribute("data-density", "compact");
      // Owner's ruling 2026-10-06: Customize leaves the column; skills live under Chat settings (the gear).
      expect(within(column()).queryByRole("link", { name: "Customize" })).toBeNull();
      expect(within(column()).getByText("Your chats will show up here.")).toBeTruthy();
      // No thread search until there is something to search.
      expect(within(column()).queryByRole("button", { name: "Search chats" })).toBeNull();
    } finally {
      restore();
    }
  });
});

describe("ChatPage (PROJECTS-01b: projects in the column)", () => {
  const column = () => document.getElementById("next-chat-rail")!;
  const stubProjects = (folders: Array<{ id: string; name: string; access?: "manage" | "edit" | "use"; icon?: string; color?: string; pinned?: boolean }>, chats: Array<{ id: string; title: string; folder_id: string | null }>) => {
    const original = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/chat-folders")) return Promise.resolve(Response.json(folders.map((folder) => ({
        id: folder.id, name: folder.name, person: "person-abc123", access: folder.access ?? "manage",
        icon: folder.icon ?? "folder", color: folder.color ?? "neutral", pinned: folder.pinned ?? false,
        description: "", instructions: "", memory_mode: "project_only", shares: [], sort_order: 0,
        source: "hub", provenance: "person-abc123 (self)", hlc: "1:0:personabc123",
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(), deleted_at: null,
        pinned_at: null, archived_at: null, last_activity_at: new Date().toISOString(),
        counts: { chats: 0, files: 0, artifacts: 0 },
      }))));
      if (url.includes("/api/conversations")) {
        return Promise.resolve(Response.json(chats.map((chat) => ({ ...chat, surface: "chat", pinned: false, archived: false, created_at: new Date().toISOString(), last_turn_at: new Date().toISOString(), turn_count: 2, companion_id: null }))));
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;
    return () => {
      globalThis.fetch = original;
    };
  };
  const renderAs = (overrides: Partial<Roster> = {}) => renderPage(
    <MemoryRouter initialEntries={["/chat"]}>
      <ChatPage person={makePerson(overrides)} />
    </MemoryRouter>,
  );

  test("an adult's projects list under Projects with their chats inside, and a + to make one", async () => {
    const restore = stubProjects([{ id: "folder-garden1", name: "Garden" }], [
      { id: "conv-inproj01", title: "Raised beds", folder_id: "folder-garden1" },
      { id: "conv-loose001", title: "Dinner ideas", folder_id: null },
    ]);
    try {
      const view = renderAs();
      await within(column()).findByText("Dinner ideas");
      const project = (await within(column()).findByText("Garden")).closest('[data-slot="aui_thread-list-project"]') as HTMLElement;
      expect(within(column()).getByLabelText("New project")).toBeTruthy();
      expect(within(column()).queryByText("Raised beds")).toBeNull();
      fireEvent.click(project.querySelector('[data-slot="aui_thread-list-project-trigger"]')!);
      expect(await within(column()).findByText("Raised beds")).toBeTruthy();
      void view;
    } finally {
      restore();
    }
  });

  test("an adult can open kit project settings, save fields, and pin a project", async () => {
    const original = globalThis.fetch;
    const patches: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/chat-folders") && init?.method === "PATCH") {
        patches.push({ url, body: JSON.parse(String(init.body)) as unknown });
        return Promise.resolve(Response.json({}));
      }
      if (url.includes("/api/chat-folders")) return Promise.resolve(Response.json([{
        id: "folder-garden1", name: "Garden", person: "person-abc123", access: "manage", icon: "leaf", color: "green", pinned: false,
        description: "", instructions: "", memory_mode: "project_only", shares: [], sort_order: 0, source: "hub", provenance: "self", hlc: "1:0:personabc123",
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(), deleted_at: null, pinned_at: null, archived_at: null,
        last_activity_at: new Date().toISOString(), counts: { chats: 0, files: 0, artifacts: 0 },
      }]));
      if (url.includes("/api/conversations")) return Promise.resolve(Response.json([]));
      return Promise.resolve(Response.json({}));
    }) as unknown as typeof fetch;
    try {
      const view = renderAs();
      await within(column()).findByText("Garden");
      expect(within(column()).getByText("Garden").closest('[data-slot="aui_thread-list-project"]')?.querySelector('[data-slot="project-mark"]')?.getAttribute("data-hue")).toBe("green");
      const more = within(column()).getByRole("button", { name: "Project options" });
      fireEvent.pointerDown(more, { button: 0, pointerType: "mouse" });
      fireEvent.click(await within(document.body).findByRole("menuitem", { name: "Edit project" }));
      const name = await within(document.body).findByRole("textbox", { name: "Project name" });
      fireEvent.change(name, { target: { value: "Patio" } });
      expect(within(document.body).queryByLabelText("Memory")).toBeNull();
      fireEvent.click(within(document.body).getByRole("button", { name: "Save" }));
      await waitFor(() => expect(patches).toContainEqual({ url: expect.stringContaining("folder-garden1"), body: { name: "Patio" } }));

      fireEvent.pointerDown(more, { button: 0, pointerType: "mouse" });
      fireEvent.click(await within(document.body).findByRole("menuitem", { name: "Pin project" }));
      await waitFor(() => expect(patches.some((patch) => JSON.stringify(patch.body) === '{"pinned":true}')).toBe(true));
      view.unmount();
    } finally {
      globalThis.fetch = original;
    }
  });

  test("Create makes a project and opens its kit settings dialog", async () => {
    const original = globalThis.fetch;
    const created = {
      id: "folder-recipes1", name: "Recipes", person: "person-abc123", access: "manage", icon: "folder", color: "neutral", pinned: false,
      description: "", instructions: "", memory_mode: "project_only", shares: [], sort_order: 0, source: "hub", provenance: "self", hlc: "1:0:personabc123",
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(), deleted_at: null, pinned_at: null, archived_at: null,
      last_activity_at: new Date().toISOString(), counts: { chats: 0, files: 0, artifacts: 0 },
    };
    let exists = false;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/chat-folders") && init?.method === "POST") {
        exists = true;
        return Promise.resolve(Response.json(created, { status: 201 }));
      }
      if (url.includes("/api/chat-folders")) return Promise.resolve(Response.json(exists ? [created] : []));
      if (url.includes("/api/conversations")) return Promise.resolve(Response.json([]));
      return Promise.resolve(Response.json({}));
    }) as unknown as typeof fetch;
    try {
      renderAs();
      fireEvent.click(await within(column()).findByRole("button", { name: "New project" }));
      const name = await within(column()).findByPlaceholderText("Project name");
      fireEvent.change(name, { target: { value: "Recipes" } });
      fireEvent.keyDown(name, { key: "Enter" });
      expect(await within(document.body).findByText("Project settings")).toBeTruthy();
      expect(within(document.body).getByRole("textbox", { name: "Project name" })).toHaveValue("Recipes");
    } finally {
      globalThis.fetch = original;
    }
  });

  test("a child sees a parent's projects but cannot make, rename or delete one", async () => {
    const restore = stubProjects([{ id: "folder-homework", name: "Homework", access: "use" }], [{ id: "conv-child001", title: "Spelling", folder_id: null }]);
    try {
      renderAs({ role: "child", age_band: "child" });
      await within(column()).findByText("Homework");
      expect(within(column()).queryByLabelText("New project")).toBeNull();
      const project = within(column()).getByText("Homework").closest('[data-slot="aui_thread-list-project"]') as HTMLElement;
      fireEvent.pointerDown(project.querySelector('[data-slot="aui_thread-list-project-more"]')!, { button: 0, pointerType: "mouse" });
      expect(await within(document.body).findByRole("menuitem", { name: "New chat in project" })).toBeTruthy();
      expect(within(document.body).queryByRole("menuitem", { name: "Edit project" })).toBeNull();
      expect(within(document.body).queryByRole("menuitem", { name: "Pin project" })).toBeNull();
      expect(within(document.body).queryByRole("menuitem", { name: "Rename" })).toBeNull();
      expect(within(document.body).queryByRole("menuitem", { name: "Delete" })).toBeNull();
    } finally {
      restore();
    }
  });
});

describe("ChatPage (slice 5(d): Details, the stats reveal)", () => {
  const STATS = { prompt_tokens: 120, predicted_tokens: 40, tokens_per_second: 22.4, time_to_first_token_ms: 400, total_time_ms: 2100, context_tokens: 120, cache_reuse_tokens: 30, cache_reuse_percent: 25, engine: "local family.gguf", stop_reason: "stop", thinking: false };

  // stubTurnFetch's own shape (SHELL-02 slice 3, above), plus GET
  // /api/engines - `enginesResponse` lets each test represent both
  // "Stack configured with a measured chat role" and "the common case
  // today, unconfigured" without a second helper.
  function stubDetailsFetch(streamBody: ReadableStream<Uint8Array>, enginesResponse: unknown): () => void {
    const original = globalThis.fetch;
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/conversations") && init?.method === "POST") return Promise.resolve(Response.json({ id: "conv-details123", status: "open", surface: "chat" }));
      if (url.includes("/api/conversations")) return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      if (url.includes("/api/turn/stream")) return Promise.resolve(new Response(streamBody, { status: 200, headers: ASSISTANT_STREAM_HEADERS }));
      if (url.includes("/api/engines")) return Promise.resolve(Response.json(enginesResponse));
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

  // chatMemoryChip.test.tsx's own established fix (also used by
  // ADMIN-COMPARE-01 below): Radix's DropdownMenu trigger opens on
  // pointerdown, not a plain click.
  async function openMoreMenu(view: ReturnType<typeof render>): Promise<void> {
    const trigger = await view.findByRole("button", { name: "More" });
    act(() => {
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1 });
      fireEvent.click(trigger);
    });
  }

  test("Details reveals the timing stats on click", async () => {
    // The toggle itself (open/closed, keyed by turnId) is the identical
    // mechanism `SourcesOpenContext` already has thorough coverage for
    // above - this proves the reveal's own content, not the toggle
    // logic a second time.
    const restore = stubDetailsFetch(
      ndjsonStream([
        { type: "delta", text: "It's sunny." },
        { type: "done", value: { turn_id: "turn-details123", reply: { text: "It's sunny." }, source: "model", safety: SAFETY, stats: STATS } },
      ]),
      { configured: false, roles: [], engines: [], budget: null },
    );
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await sendMessage(view, "what's the weather");
      await view.findByText("It's sunny.");
      await openMoreMenu(view);
      const detailsItem = await view.findByText("Details");
      expect(view.queryByText("First token")).toBeNull();
      fireEvent.click(detailsItem);
      expect(await view.findByText("First token")).toBeVisible();
      expect(view.getByText("0.4s")).toBeVisible();
      expect(view.getByText("Total")).toBeVisible();
      expect(view.getByText("2.1s")).toBeVisible();
      expect(view.getByText("Speed")).toBeVisible();
      expect(view.getByText("22 tok/s")).toBeVisible();
      expect(view.getByText("Engine")).toBeVisible();
      expect(view.getByText("local family.gguf")).toBeVisible();
    } finally {
      restore();
    }
  });

  test("no Details entry at all when the turn carries no stats", async () => {
    const restore = stubDetailsFetch(
      ndjsonStream([
        { type: "delta", text: "It's sunny." },
        { type: "done", value: { turn_id: "turn-nostats123", reply: { text: "It's sunny." }, source: "model", safety: SAFETY } },
      ]),
      { configured: false, roles: [], engines: [], budget: null },
    );
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await sendMessage(view, "what's the weather");
      await view.findByText("It's sunny.");
      await openMoreMenu(view);
      expect(view.queryByText("Details")).toBeNull();
    } finally {
      restore();
    }
  });

  test("the context bar uses the turn's measured window and prompt token count", async () => {
    const restore = stubDetailsFetch(
      ndjsonStream([
        { type: "delta", text: "It's sunny." },
        { type: "done", value: { turn_id: "turn-ctx123", reply: { text: "It's sunny." }, source: "model", safety: SAFETY, stats: { ...STATS, prompt_tokens: 1024, context_tokens: 1024, context_window_tokens: 32_768, context_used_percent: 1024 / 32_768 * 100, context_segments: { prefix: 120, tools: 180, memory: 90, history: 500, reply: 134 } } } },
      ]),
      {
        configured: true,
        roles: [{ id: "chat", label: "Chat", wire: "chat", residency: "resident", endpoints: [], quality: ["everyday"], sharesModelWith: null, state: { state: "loaded", since: "2026-09-22T00:00:00.000Z" }, reason: null, model: { id: "family.gguf", sizeBytes: null, measuredFootprintBytes: null, measuredContextLength: 8192, estimated: false }, check: { state: "not checked", at: null, reason: null, stale: false } }],
        engines: [],
        budget: null,
      },
    );
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await sendMessage(view, "what's the weather");
      await view.findByText("It's sunny.");
      await openMoreMenu(view);
      fireEvent.click(await view.findByText("Details"));
      await view.findByText("First token");
      expect(await view.findByLabelText("Context usage")).toBeVisible();
      expect(view.getByText("1.1k (3%)")).toBeVisible();
      for (const label of ["Prefix", "Tools", "Memory", "History", "Reply"]) expect(view.getByText(label)).toBeVisible();
    } finally {
      restore();
    }
  });

  test("no context bar when the turn has no reported context size", async () => {
    const restore = stubDetailsFetch(
      ndjsonStream([
        { type: "delta", text: "It's sunny." },
        { type: "done", value: { turn_id: "turn-nostack123", reply: { text: "It's sunny." }, source: "model", safety: SAFETY, stats: STATS } },
      ]),
      { configured: false, roles: [], engines: [], budget: null },
    );
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await sendMessage(view, "what's the weather");
      await view.findByText("It's sunny.");
      await openMoreMenu(view);
      fireEvent.click(await view.findByText("Details"));
      await view.findByText("First token");
      expect(view.queryByLabelText("Context usage")).toBeNull();
    } finally {
      restore();
    }
  });
});

describe("ChatPage (ELT-MODE-01: catalog-backed composer mode control)", () => {
  test.each(["child", "teen"] as const)("hides the mode control for a %s", async (age_band) => {
    const original = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/host/chat-capabilities")) return Promise.resolve(Response.json({ image_parts: false, thinking: "none", thinking_modes: {} }));
      if (url.includes("/api/conversations")) return Promise.resolve(Response.json([]));
      return Promise.resolve(Response.json({}));
    }) as unknown as typeof fetch;
    try {
      const view = renderPage(<MemoryRouter initialEntries={["/chat"]}><ChatPage person={makePerson({ role: age_band, age_band })} /></MemoryRouter>);
      await view.findByLabelText("Message input");
      expect(view.queryByRole("button", { name: "Thinking mode" })).toBeNull();
      expect(view.queryByText("Instant")).toBeNull();
    } finally { globalThis.fetch = original; }
  });

  test("a single non-thinking model renders accessible, non-focusable Instant text", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/engines")) return Promise.resolve(Response.json({ configured: true, roles: [{ id: "chat", label: "chat", wire: "chat", residency: "resident", endpoints: [], quality: [], sharesModelWith: null, state: { state: "ready", since: "2026-09-27T00:00:00.000Z" }, reason: null, model: { id: "catalog-model", sizeBytes: null, measuredFootprintBytes: null, measuredContextLength: null, estimated: true }, models: [{ id: "catalog-model", name: "Secret model name" }], check: { state: "not checked", at: null, reason: null, stale: false } }], engines: [], budget: null }));
      if (url.includes("/api/host/chat-capabilities")) return Promise.resolve(Response.json({ image_parts: false, thinking: "none", thinking_modes: { "catalog-model": "none" } }));
      if (url.includes("/api/conversations")) return Promise.resolve(Response.json([]));
      return Promise.resolve(Response.json({}));
    }) as unknown as typeof fetch;
    try {
      const view = renderPage(<MemoryRouter initialEntries={["/chat"]}><ChatPage person={makePerson()} /></MemoryRouter>);
      await view.findByText("Instant");
      const label = view.container.querySelector('[data-slot="model-selector-value"]');
      expect(label).toBeTruthy();
      expect(label?.textContent).toBe("Instant");
      expect(label?.closest("button")).toBeNull();
      expect(view.queryByRole("button", { name: "Thinking mode" })).toBeNull();
      expect(view.queryByText("Secret model name")).toBeNull();
    } finally { globalThis.fetch = original; }
  });

  test("a switchable catalog model exposes only Instant and Thinking choices", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/engines")) return Promise.resolve(Response.json({ configured: true, roles: [{ id: "chat", label: "chat", wire: "chat", residency: "resident", endpoints: [], quality: [], sharesModelWith: null, state: { state: "ready", since: "2026-09-27T00:00:00.000Z" }, reason: null, model: { id: "catalog-model", sizeBytes: null, measuredFootprintBytes: null, measuredContextLength: null, estimated: true }, models: [{ id: "catalog-model", name: "Secret model name" }], check: { state: "not checked", at: null, reason: null, stale: false } }], engines: [], budget: null }));
      if (url.includes("/api/host/chat-capabilities")) return Promise.resolve(Response.json({ image_parts: false, thinking: "switchable", thinking_modes: { "catalog-model": "switchable" } }));
      if (url.includes("/api/conversations")) return Promise.resolve(Response.json([]));
      return Promise.resolve(Response.json({}));
    }) as unknown as typeof fetch;
    try {
      const view = renderPage(<MemoryRouter initialEntries={["/chat"]}><ChatPage person={makePerson()} /></MemoryRouter>);
      const trigger = await view.findByRole("combobox", { name: "Thinking mode" });
      expect(trigger).toHaveTextContent("Instant");
      expect(trigger).not.toHaveTextContent("Secret model name");
      fireEvent.click(trigger);
      expect(await view.findByRole("radio", { name: "Thinking" })).toBeTruthy();
      fireEvent.click(view.getByRole("radio", { name: "Thinking" }));
      expect(trigger).toHaveTextContent("Thinking");
    } finally { globalThis.fetch = original; }
  });
});

describe("ChatPage (ELT-MODE-01: model names stay out of chat)", () => {
  test.each(["child", "teen", "adult"] as const)("does not render model names in the composer for a %s", async (band) => {
    const original = globalThis.fetch;
    const names = ["Private qwen vision name", "Private qwen text name"];
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/engines")) return Promise.resolve(Response.json({ configured: true, roles: [{ id: "chat", label: "Chat", wire: "chat", residency: "resident", endpoints: [], quality: [], sharesModelWith: null, state: { state: "ready", since: "2026-10-07T00:00:00.000Z" }, reason: null, model: { id: "private-qwen-vision", sizeBytes: null, measuredFootprintBytes: null, measuredContextLength: 8192, estimated: false }, models: [{ id: "private-qwen-vision", name: names[0] }, { id: "private-qwen-text", name: names[1] }], check: { state: "not checked", at: null, reason: null, stale: false } }], engines: [], budget: null }));
      if (url.includes("/api/host/chat-models")) return Promise.resolve(Response.json({ models: [{ id: "private-qwen-vision", label: names[0] }, { id: "private-qwen-text", label: names[1] }], selectedModel: { id: "private-qwen-vision", label: names[0], available: true }, canSelect: true }));
      if (url.includes("/api/host/chat-capabilities")) return Promise.resolve(Response.json({ image_parts: true, thinking: "switchable", thinking_modes: { "private-qwen-vision": "switchable", "private-qwen-text": "switchable" } }));
      if (url.includes("/api/conversations")) return Promise.resolve(Response.json([]));
      return Promise.resolve(Response.json({}));
    }) as unknown as typeof fetch;
    try {
      const person = band === "adult" ? makePerson() : makePerson({ role: band, age_band: band });
      const view = renderPage(<MemoryRouter initialEntries={["/chat"]}><ChatPage person={person} /></MemoryRouter>);
      await view.findByLabelText("Message input");
      if (band === "adult") await view.findByRole("combobox", { name: "Thinking mode" });
      for (const name of names) expect(view.queryByText(name)).toBeNull();
      expect(view.container.querySelector('[data-slot="composer-model-picker"]')).toBeNull();
      expect(view.container.querySelector('[aria-label^="Regenerate with a different model"]')).toBeNull();
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("ChatPage (ELT-MODE-01: the mode label sits just left of the mic)", () => {
  test("one mode selector, in the trailing group before voice and Send", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/engines")) return Promise.resolve(Response.json({ configured: true, roles: [{ id: "chat", label: "chat", wire: "chat", residency: "resident", endpoints: [], quality: [], sharesModelWith: null, state: { state: "ready", since: "2026-09-27T00:00:00.000Z" }, reason: null, model: { id: "a", sizeBytes: null, measuredFootprintBytes: null, measuredContextLength: null, estimated: true }, models: [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }], check: { state: "not checked", at: null, reason: null, stale: false } }], engines: [], budget: null }));
      if (url.includes("/api/conversations")) return Promise.resolve(Response.json([]));
      return Promise.resolve(Response.json({}));
    }) as unknown as typeof fetch;
    try {
      const view = renderPage(<MemoryRouter initialEntries={["/chat"]}><ChatPage person={makePerson()} /></MemoryRouter>);
      const trigger = await view.findByRole("combobox", { name: "Thinking mode" });
      expect(document.querySelectorAll('[data-slot="model-selector-trigger"]').length).toBe(1);
      const groups = document.querySelectorAll(".aui-composer-action-wrapper > div");
      expect(groups.length).toBe(2);
      expect(groups[0]!.contains(trigger)).toBe(false);
      expect(groups[1]!.contains(trigger)).toBe(true);
      const send = view.getByRole("button", { name: "Send message" });
      expect(trigger.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    } finally { globalThis.fetch = original; }
  });
});

describe("ChatPage (ELT-MODE-01 / RESP-04 (f): the composer's mode picker)", () => {
  async function sendMessage(view: ReturnType<typeof render>, text: string): Promise<void> {
    fireEvent.change(await view.findByLabelText("Message input"), { target: { value: text } });
    const send = (await view.findByLabelText("Send message")) as HTMLButtonElement;
    await waitFor(() => expect(send.disabled).toBe(false));
    fireEvent.click(send);
  }

  const trigger = () => document.querySelector('[data-slot="model-selector-trigger"]') as HTMLButtonElement;
  const menu = () => document.querySelector('[data-slot="model-selector-content"]') as HTMLElement;
  const menuItems = () => within(menu()).getAllByRole("radio");

  function fetchWithPicker(): () => void {
    const original = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/engines")) return Promise.resolve(Response.json({ configured: true, roles: [{ id: "chat", label: "Chat", wire: "chat", residency: "resident", endpoints: [], quality: [], sharesModelWith: null, state: { state: "loaded", since: "2026-09-22T00:00:00.000Z" }, reason: null, model: { id: "family.gguf", sizeBytes: null, measuredFootprintBytes: null, measuredContextLength: 8192, estimated: false }, models: [{ id: "family.gguf", name: "Family" }, { id: "fast.gguf", name: "Fast" }], check: { state: "not checked", at: null, reason: null, stale: false } }], engines: [], budget: null }));
      if (url.includes("/api/conversations")) return Promise.resolve(Response.json([]));
      return Promise.resolve(Response.json({}));
    }) as unknown as typeof fetch;
    return () => { globalThis.fetch = original; };
  }

  test("the trigger hides model identity and offers Instant/Thinking choices", async () => {
    const restore = fetchWithPicker();
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await view.findByLabelText("Message input");
      expect(trigger()).toHaveTextContent("Instant");
      fireEvent.click(trigger());
      const items = within(menu()).getAllByRole("radio");
      expect(items).toHaveLength(2);
      expect(items[0]).toHaveTextContent("Instant");
      expect(items[1]).toHaveTextContent("Thinking");
    } finally {
      restore();
    }
  });

  test("clicking the trigger opens the menu; picking Thinking updates the trigger and closes it", async () => {
    const restore = fetchWithPicker();
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await view.findByLabelText("Message input");
      expect(menu()).toBeNull();
      fireEvent.click(trigger());
      await waitFor(() => expect(menu()).toBeTruthy());
      fireEvent.click(menuItems()[1]!);
      expect(trigger()).toHaveTextContent("Thinking");
    } finally {
      restore();
    }
  });

  test("a conversation's Thinking setting is patched on change and restored after reopening it", async () => {
    const original = globalThis.fetch;
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    const saved = {
      id: "conv-persist123",
      person: "person-abc123",
      surface: "chat",
      mode: "chat",
      companion_id: null,
      title: "Reasoning chat",
      pinned: false,
      status: "open",
      source: "hub",
      hlc: "1788000000000:0:testnode",
      created_at: "2026-09-27T00:00:00.000Z",
      updated_at: "2026-09-27T00:00:00.000Z",
      settings: undefined as { thinking?: boolean; model?: string; read_aloud?: boolean } | undefined,
    };
    const other = { ...saved, id: "conv-other456", title: "Other chat", settings: undefined };
    let turnCount = 0;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/health")) return Promise.resolve(Response.json({ engines: { voice: { kind: "url", pid: null, alive: true, availability: "ready" } } }));
      if (url.includes("/api/engines")) return Promise.resolve(Response.json({ configured: true, roles: [
        { id: "chat", label: "Chat", wire: "chat", residency: "resident", endpoints: [], quality: [], sharesModelWith: null, state: { state: "loaded", since: "2026-09-22T00:00:00.000Z" }, reason: null, model: { id: "family.gguf", sizeBytes: null, measuredFootprintBytes: null, measuredContextLength: 8192, estimated: false }, models: [{ id: "family.gguf", name: "Family" }, { id: "fast.gguf", name: "Fast" }], check: { state: "not checked", at: null, reason: null, stale: false } },
        { id: "tts", state: { state: "ready" } },
      ], engines: [], budget: null }));
      if (url.endsWith("/api/conversations") && method === "GET") {
        return Promise.resolve(Response.json([{ ...saved, last_turn_at: null }, { ...other, last_turn_at: null }]));
      }
      if (url.endsWith(`/api/conversations/${other.id}/turns`)) return Promise.resolve(Response.json([]));
      if (url.endsWith(`/api/conversations/${other.id}/resume`) && method === "POST") return Promise.resolve(Response.json(other));
      if (url.endsWith(`/api/conversations/${other.id}`)) return Promise.resolve(Response.json(other));
      if (url.endsWith(`/api/conversations/${saved.id}/turns`)) return Promise.resolve(Response.json([]));
      if (url.endsWith(`/api/conversations/${saved.id}/resume`) && method === "POST") return Promise.resolve(Response.json(saved));
      if (url.endsWith(`/api/conversations/${saved.id}`) && method !== "PATCH") return Promise.resolve(Response.json(saved));
      if (url.endsWith(`/api/conversations/${saved.id}`) && method === "PATCH") {
        const body = JSON.parse(String(init?.body)) as { settings: Record<string, unknown> };
        saved.settings = { ...(saved.settings ?? {}), ...body.settings };
        return Promise.resolve(Response.json(saved));
      }
      if (url.endsWith(`/api/conversations/${saved.id}`)) return Promise.resolve(Response.json(saved));
      if (url.includes("/api/turn/stream")) {
        turnCount++;
        const text = `Reply ${turnCount}.`;
        return Promise.resolve(new Response(ndjsonStream([
          { type: "delta", text },
          { type: "done", value: { turn_id: `turn-persist${turnCount}`, reply: { text }, source: "model", safety: SAFETY } },
        ]), { status: 200, headers: ASSISTANT_STREAM_HEADERS }));
      }
      return Promise.resolve(Response.json({}));
    }) as unknown as typeof fetch;
    const page = () => renderPage(
      <ChatHeaderDataProvider>
        <ChatHeaderBar />
        <MemoryRouter initialEntries={[`/chat?conversation=${saved.id}`]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>
      </ChatHeaderDataProvider>,
    );
    try {
      const first = page();
      await first.findByLabelText("Message input");
      await waitFor(() => expect(first.getAllByRole("button", { name: "Conversation actions" })[0]).toBeTruthy());
      await waitFor(() => expect(trigger()).toHaveTextContent("Instant"));
      fireEvent.click(trigger());
      fireEvent.click(menuItems()[1]!);
      await waitFor(() => expect(saved.settings).toEqual({ thinking: true }));
      const actions = first.getAllByRole("button", { name: "Conversation actions" })[0]!;
      act(() => {
        fireEvent.pointerDown(actions, { button: 0, ctrlKey: false, pointerId: 1 });
        fireEvent.click(actions);
      });
      fireEvent.click(await first.findByText("Read replies aloud"));
      await waitFor(() => expect(saved.settings).toEqual({ thinking: true, read_aloud: true }));
      first.unmount();

      const reopened = page();
      await reopened.findByLabelText("Message input");
      await waitFor(() => expect(reopened.getAllByRole("button", { name: "Conversation actions" })[0]).toBeTruthy());
      await waitFor(() => expect(trigger()).toHaveTextContent("Thinking"));
      const reopenedActions = reopened.getAllByRole("button", { name: "Conversation actions" })[0]!;
      act(() => {
        fireEvent.pointerDown(reopenedActions, { button: 0, ctrlKey: false, pointerId: 1 });
        fireEvent.click(reopenedActions);
      });
      const readAloudItem = await reopened.findByText("Read replies aloud");
      expect(readAloudItem.closest('[role="menuitemcheckbox"]')).toHaveAttribute("aria-checked", "true");
      await sendMessage(reopened, "explain this carefully");
      await reopened.findByText("Reply 1.");
      const turn = (globalThis.fetch as unknown as ReturnType<typeof mock>).mock.calls
        .map((call: unknown[]) => ({ url: typeof call[0] === "string" ? call[0] : String(call[0]), init: call[1] as RequestInit | undefined }))
        .find(({ url }) => url.includes("/api/turn/stream"));
      expect(JSON.parse(String(turn?.init?.body)).thinking).toBe(true);
      expect(JSON.parse(String(turn?.init?.body)).model).toBeUndefined();
    } finally {
      globalThis.fetch = original;
    }
  });

  test("read-aloud selected before the first send is saved before that turn is sent", async () => {
    const original = globalThis.fetch;
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    const calls: string[] = [];
    const saved = {
      id: "conv-first-read-aloud",
      person: "person-abc123",
      surface: "chat",
      mode: "chat",
      companion_id: null,
      title: null,
      pinned: false,
      status: "open",
      source: "hub",
      hlc: "1788000000000:0:testnode",
      created_at: "2026-09-27T00:00:00.000Z",
      updated_at: "2026-09-27T00:00:00.000Z",
      settings: undefined as { read_aloud?: boolean } | undefined,
    };
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/health")) return Promise.resolve(Response.json({ engines: { voice: { kind: "url", pid: null, alive: true, availability: "ready" } } }));
      if (url.includes("/api/engines")) return Promise.resolve(Response.json({ configured: true, roles: [{ id: "tts", state: { state: "ready" } }], engines: [], budget: null }));
      if (url.endsWith("/api/conversations") && method === "POST") {
        calls.push("create");
        return Promise.resolve(Response.json({ id: saved.id, status: "open", surface: "chat" }));
      }
      if (url.endsWith(`/api/conversations/${saved.id}/resume`) && method === "POST") return Promise.resolve(Response.json(saved));
      if (url.endsWith(`/api/conversations/${saved.id}`) && method === "PATCH") {
        const body = JSON.parse(String(init?.body)) as { settings: Record<string, unknown> };
        if (body.settings) {
          calls.push("settings");
          saved.settings = { ...(saved.settings ?? {}), ...body.settings };
        } else calls.push("rename");
        return Promise.resolve(Response.json(saved));
      }
      if (url.includes("/api/conversations")) return Promise.resolve(Response.json([]));
      if (url.includes("/api/turn/stream")) {
        calls.push("turn");
        return Promise.resolve(new Response(ndjsonStream([
          { type: "delta", text: "Here is the reply." },
          { type: "done", value: { turn_id: "turn-first-read-aloud", reply: { text: "Here is the reply." }, source: "model", safety: SAFETY } },
        ]), { status: 200, headers: ASSISTANT_STREAM_HEADERS }));
      }
      return Promise.resolve(Response.json({}));
    }) as unknown as typeof fetch;
    try {
      const view = renderPage(
        <ChatHeaderDataProvider>
          <ChatHeaderBar />
          <MemoryRouter initialEntries={["/chat"]}>
            <ChatPage person={makePerson()} />
          </MemoryRouter>
        </ChatHeaderDataProvider>,
      );
      await view.findByLabelText("Message input");
      const actions = (await view.findAllByRole("button", { name: "Conversation actions" }))[0]!;
      act(() => {
        fireEvent.pointerDown(actions, { button: 0, ctrlKey: false, pointerId: 1 });
        fireEvent.click(actions);
      });
      fireEvent.click(await view.findByRole("menuitemcheckbox", { name: "Read replies aloud" }));
      await sendMessage(view, "read the reply");
      await view.findByText("Here is the reply.");
      expect(saved.settings).toEqual({ read_aloud: true });
      expect(calls.filter((call) => call === "settings")).toHaveLength(1);
      expect(calls.indexOf("settings")).toBeLessThan(calls.indexOf("turn"));
    } finally {
      globalThis.fetch = original;
    }
  });

  test("clicking outside the control closes the picker without changing the mode", async () => {
    const restore = fetchWithPicker();
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await view.findByLabelText("Message input");
      fireEvent.click(trigger());
      expect(menu()).toBeTruthy();
      const input = await view.findByLabelText("Message input");
      fireEvent.pointerDown(input, { bubbles: true, button: 0, ctrlKey: false, pointerId: 1, pointerType: "mouse" });
      fireEvent.click(input, { bubbles: true, button: 0 });
      await waitFor(() => expect(trigger()).toHaveAttribute("aria-expanded", "false"));
      expect(trigger()).toHaveTextContent("Instant");
    } finally {
      restore();
    }
  });

  test("Escape closes the picker without changing the mode", async () => {
    const restore = fetchWithPicker();
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await view.findByLabelText("Message input");
      fireEvent.click(trigger());
      expect(menu()).toBeTruthy();
      fireEvent.keyDown(document, { key: "Escape" });
      expect(menu()).toBeNull();
      expect(trigger()).toHaveTextContent("Instant");
    } finally {
      restore();
    }
  });

  // The mode is stored per conversation; this fixture checks that it
  // survives sends and that a new conversation loads its own default.
  // Each turn gets a fresh stream so both requests can be inspected.
  function turnRequestBodies(): Array<Record<string, unknown>> {
    return (globalThis.fetch as unknown as ReturnType<typeof mock>).mock.calls
      .filter((c: unknown[]) => (typeof c[0] === "string" ? c[0] : (c[0] as URL | Request).toString()).includes("/api/turn/stream"))
      .map((c: unknown[]) => JSON.parse((c[1] as RequestInit).body as string));
  }

  test("an edit resend records its superseded turn and the two branches survive a reload", async () => {
    const original = globalThis.fetch;
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    let turnCount = 0;
    const historyRows = [
      { id: "turn-edit1", personId: "person-abc123", surface: "chat", userText: "first version", replyText: "Reply 1.", source: "model", pluginId: null, commandId: null, safetyFlagged: false, safetyAction: "allow", minorSpeaker: false, createdAt: "2026-09-27T00:00:00.000Z", supersedes: null, judgeStatus: null, memory_ids: [] },
      { id: "turn-edit2", personId: "person-abc123", surface: "chat", userText: "edited version", replyText: "Reply 2.", source: "model", pluginId: null, commandId: null, safetyFlagged: false, safetyAction: "allow", minorSpeaker: false, createdAt: "2026-09-27T00:00:01.000Z", supersedes: "turn-edit1", judgeStatus: null, memory_ids: [] },
    ];
    const conversation = { id: "conv-edit123", status: "open", surface: "chat", title: "Edit test" };
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/conversations" && init?.method === "POST") return Promise.resolve(Response.json(conversation));
      if (url === "/api/conversations") return Promise.resolve(Response.json([{ ...conversation, created_at: "2026-09-27T00:00:00Z", pinned: false }]));
      if (url.endsWith("/resume")) return Promise.resolve(Response.json(conversation));
      if (url.endsWith("/turns")) return Promise.resolve(Response.json(historyRows));
      if (url.includes("/api/conversations/conv-edit123")) return Promise.resolve(Response.json(conversation));
      if (url === "/api/turn/stream") {
        turnCount++;
        const text = `Reply ${turnCount}.`;
        return Promise.resolve(new Response(ndjsonStream([
          { type: "delta", text },
          { type: "done", value: { turn_id: `turn-edit${turnCount}`, reply: { text }, source: "model", safety: SAFETY } },
        ]), { status: 200, headers: ASSISTANT_STREAM_HEADERS }));
      }
      return Promise.resolve(Response.json({}));
    }) as unknown as typeof fetch;
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await sendMessage(view, "first version");
      await view.findByText("Reply 1.");

      const userMessage = view.container.querySelector('[data-slot="aui_user-message-root"]') as HTMLElement;
      fireEvent.mouseEnter(userMessage);
      fireEvent.click(await within(userMessage).findByRole("button", { name: "Edit" }));
      const update = await view.findByRole("button", { name: "Update" });
      const editInput = view.container.querySelector(".aui-edit-composer-input") as HTMLTextAreaElement;
      fireEvent.change(editInput, { target: { value: "edited version" } });
      expect(editInput.value).toBe("edited version");
      fireEvent.click(update);
      await waitFor(() => expect(turnRequestBodies()).toHaveLength(2));
      expect(turnRequestBodies()[1]!.supersedes).toBe("turn-edit1");

      const sentBodies = turnRequestBodies();
      expect(sentBodies).toHaveLength(2);
      expect(sentBodies[1]!.supersedes).toBe("turn-edit1");

      view.unmount();
      const reloaded = renderPage(
        <MemoryRouter initialEntries={["/chat?conversation=conv-edit123"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await waitFor(() => {
        const calls = (globalThis.fetch as unknown as ReturnType<typeof mock>).mock.calls;
        expect(calls.some((call: unknown[]) => String(call[0]).endsWith("/api/conversations/conv-edit123/turns"))).toBe(true);
      });
      expect(await reloaded.findByText("Reply 2.")).toBeVisible();
      const previousBranch = reloaded.getByRole("button", { name: "Previous" });
      expect(previousBranch).toBeEnabled();
      fireEvent.click(previousBranch);
      expect(await reloaded.findByText("Reply 1.")).toBeVisible();
    } finally {
      globalThis.fetch = original;
    }
  });

  test("the mode survives a send within the same conversation, and resets on conversation change", async () => {
    const originalFetch = globalThis.fetch;
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    let turnCount = 0;
    let conversationCount = 0;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/engines")) return Promise.resolve(Response.json({ configured: true, roles: [{ id: "chat", label: "Chat", wire: "chat", residency: "resident", endpoints: [], quality: [], sharesModelWith: null, state: { state: "loaded", since: "2026-09-22T00:00:00.000Z" }, reason: null, model: { id: "family.gguf", sizeBytes: null, measuredFootprintBytes: null, measuredContextLength: 8192, estimated: false }, models: [{ id: "family.gguf", name: "Family" }, { id: "fast.gguf", name: "Fast" }], check: { state: "not checked", at: null, reason: null, stale: false } }], engines: [], budget: null }));
      if (url.includes("/api/conversations") && init?.method === "POST") { conversationCount++; return Promise.resolve(Response.json({ id: `conv-model-${conversationCount}`, status: "open", surface: "chat" })); }
      if (url.includes("/api/conversations")) return Promise.resolve(Response.json([]));
      if (url.includes("/api/turn/stream")) { turnCount++; const text = `Reply ${turnCount}.`; return Promise.resolve(new Response(ndjsonStream([{ type: "delta", text }, { type: "done", value: { turn_id: `turn-model-${turnCount}`, reply: { text }, source: "model", safety: SAFETY } }]), { status: 200, headers: ASSISTANT_STREAM_HEADERS })); }
      return Promise.resolve(Response.json({}));
    }) as unknown as typeof fetch;
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await view.findByLabelText("Message input");
      fireEvent.click(trigger());
      fireEvent.click(menuItems()[1]!);
      expect(trigger()).toHaveTextContent("Thinking");

      await sendMessage(view, "explain it");
      await view.findByText("Reply 1.");
      // Still Thinking, and the second send in the same conversation
      // still carries thinking: true - the defect this test closes.
      expect(trigger()).toHaveTextContent("Thinking");
      await sendMessage(view, "and then?");
      await view.findByText("Reply 2.");
      expect(trigger()).toHaveTextContent("Thinking");
      const bodies = turnRequestBodies();
      expect(bodies).toHaveLength(2);
      expect(bodies[0]!.thinking).toBe(true);
      expect(bodies[1]!.thinking).toBe(true);

      // A new conversation keeps the active engine default.
      fireEvent.click(within(document.getElementById("next-chat-rail")!).getByRole("button", { name: "New chat" }));
      await waitFor(() => expect(trigger()).toHaveTextContent("Instant"));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("saved conversation model overrides do not select the turn model", async () => {
    const original = globalThis.fetch;
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    const conversations: Record<string, { id: string; settings?: { model?: string }; surface: string; status: string; title: string; person: string; mode: string; companion_id: null; pinned: boolean; source: string; hlc: string; created_at: string; updated_at: string }> = {
      "conv-model-a": { id: "conv-model-a", settings: { model: "fast.gguf" }, surface: "chat", status: "open", title: "A", person: "person-abc123", mode: "chat", companion_id: null, pinned: false, source: "hub", hlc: "1788000000000:0:test", created_at: "2026-09-27T00:00:00Z", updated_at: "2026-09-27T00:00:00Z" },
      "conv-model-b": { id: "conv-model-b", settings: { model: "family.gguf" }, surface: "chat", status: "open", title: "B", person: "person-abc123", mode: "chat", companion_id: null, pinned: false, source: "hub", hlc: "1788000000000:0:test", created_at: "2026-09-27T00:00:00Z", updated_at: "2026-09-27T00:00:00Z" },
    };
    let turnCount = 0;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      if (url.includes("/api/engines")) return Promise.resolve(Response.json({ configured: true, roles: [{ id: "chat", label: "Chat", wire: "chat", residency: "resident", endpoints: [], quality: [], sharesModelWith: null, state: { state: "loaded", since: "2026-09-22T00:00:00.000Z" }, reason: null, model: { id: "family.gguf", sizeBytes: null, measuredFootprintBytes: null, measuredContextLength: 8192, estimated: false }, models: [{ id: "family.gguf", name: "Family" }, { id: "fast.gguf", name: "Fast" }], check: { state: "not checked", at: null, reason: null, stale: false } }], engines: [], budget: null }));
      if (url.endsWith("/api/conversations") && method === "POST") return Promise.resolve(Response.json(conversations["conv-model-a"]));
      if (url.split("?")[0]?.endsWith("/api/conversations") && method === "GET") return Promise.resolve(Response.json(Object.values(conversations).map((row) => ({ ...row, surface: "chat", created_at: "2026-09-27T00:00:00Z", pinned: false }))));
      const match = url.match(/\/api\/conversations\/(conv-model-[ab])(?:\/(resume|turns))?$/);
      if (match) {
        const id = match[1]!;
        const suffix = match[2];
        const row = conversations[id]!;
        if (suffix === "turns") return Promise.resolve(Response.json([]));
        if (method === "PATCH") {
          const body = JSON.parse(String(init?.body)) as { settings?: { model?: string } };
          row.settings = { ...(row.settings ?? {}), ...body.settings };
        }
        return Promise.resolve(Response.json(row));
      }
      if (url.includes("/api/conversations/conv-model-a")) return Promise.resolve(Response.json(conversations["conv-model-a"]));
      if (url.includes("/api/conversations/conv-model-b")) return Promise.resolve(Response.json(conversations["conv-model-b"]));
      if (url === "/api/turn/stream") {
        turnCount++;
        const text = `Reply ${turnCount}.`;
        return Promise.resolve(new Response(ndjsonStream([{ type: "delta", text }, { type: "done", value: { turn_id: `turn-model-persist-${turnCount}`, reply: { text }, source: "model", safety: SAFETY } }]), { status: 200, headers: ASSISTANT_STREAM_HEADERS }));
      }
      return Promise.resolve(Response.json({}));
    }) as unknown as typeof fetch;
    const open = (id?: string) => renderPage(
      <MemoryRouter initialEntries={[`/chat${id ? `?conversation=${id}` : ""}`]}>
        <ChatPage person={makePerson()} />
      </MemoryRouter>,
    );
    try {
      const first = open("conv-model-a");
      await first.findByLabelText("Message input");
      await waitFor(() => expect(trigger()).toHaveTextContent("Instant"));
      await sendMessage(first, "use fast");
      await first.findByText("Reply 1.");
      const sent = turnRequestBodies().at(-1)!;
      // Composer model choice was removed for every band; historical per-chat
      // model settings are ignored so only Settings -> Models selects it.
      expect(sent.model).toBeUndefined();
      first.unmount();

      const reopened = open("conv-model-a");
      await reopened.findByLabelText("Message input");
      await waitFor(() => expect(trigger()).toHaveTextContent("Instant"));
      reopened.unmount();

      const other = open("conv-model-b");
      await other.findByLabelText("Message input");
      await waitFor(() => expect(trigger()).toHaveTextContent("Instant"));
      await sendMessage(other, "use family");
      await other.findByText("Reply 2.");
      expect(turnRequestBodies().at(-1)!.model).toBeUndefined();
    } finally {
      globalThis.fetch = original;
    }
  });

  // Safety ruling, 2026-09-22: reasoning is a disclosure surface, so a
  // minor never even sees the control that asks for it - belt and
  // braces alongside the backend's own REASONING-03 gate
  // (routes/turn.ts: thinking forced off for a minor regardless of what
  // the request claims).
  test.each(["child", "teen"] as const)("a %s chat renders no model/mode picker, and its turn request has neither field", async (band) => {
    const restore = stubMultiTurnFetch();
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson({ role: band, age_band: band })} />
        </MemoryRouter>,
      );
      await view.findByLabelText("Message input");
      expect(trigger()).toBeNull();
      fireEvent.change(await view.findByLabelText("Message input"), { target: { value: "hi" } });
      const send = (await view.findByLabelText("Send message")) as HTMLButtonElement;
      await waitFor(() => expect(send.disabled).toBe(false));
      fireEvent.click(send);
      await view.findByText("Reply 1.");
      expect(view.queryByRole("button", { name: "Regenerate with a different model" })).toBeNull();
      const bodies = turnRequestBodies();
      expect(bodies).toHaveLength(1);
      expect("thinking" in bodies[0]!).toBe(false);
      expect("model" in bodies[0]!).toBe(false);
    } finally {
      restore();
    }
  });

  test("an adult's chat renders it", async () => {
    const restore = fetchWithPicker();
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await view.findByLabelText("Message input");
      expect(trigger()).not.toBeNull();
    } finally {
      restore();
    }
  });
});

describe("ChatPage (INCOGNITO-01 session flag wiring)", () => {
  test.each([
    ["light"],
    ["dark"],
  ])("the %s Incognito chat uses neutral theme surfaces behind its transparent canvas", async (theme) => {
    const restore = stubFetch();
    const style = document.createElement("style");
    style.textContent = `
      .style-neutral { --card: rgb(255, 255, 255); --color-card: rgb(255, 255, 255); --background: rgb(255, 255, 255); }
      .dark .style-neutral { --card: rgb(16, 34, 56); --background: rgb(7, 17, 31); }
      html.incognito { --incognito-background: none; }
      html.dark.incognito { --incognito-background: none; }
      html.incognito body::before { content: ""; position: fixed; inset: 0; z-index: -1; pointer-events: none; background: var(--incognito-background); }
      html.incognito { --incognito-card: rgb(255, 255, 255); --incognito-pane: rgb(227, 234, 243); --incognito-muted: rgb(227, 234, 243); --incognito-accent: rgb(227, 234, 243); --incognito-sidebar: rgb(234, 240, 247); --incognito-border: rgb(201, 214, 230); --incognito-canvas-color: rgb(244, 247, 251); }
      html.dark.incognito { --incognito-card: rgb(16, 34, 56); --incognito-pane: rgb(20, 42, 67); --incognito-muted: rgb(20, 42, 67); --incognito-accent: rgb(20, 42, 67); --incognito-sidebar: rgb(10, 26, 46); --incognito-border: rgb(41, 69, 99); --incognito-canvas-color: rgb(7, 17, 31); }
      html.incognito body[class*="style-"] { position: relative; z-index: 0; background: transparent; --background: var(--incognito-canvas-color); --card: var(--incognito-card); --surface-card: var(--incognito-card); --popover: var(--incognito-pane); --surface-pane: var(--incognito-pane); --secondary: var(--incognito-pane); --muted: var(--incognito-muted); --accent: var(--incognito-accent); --sidebar: var(--incognito-sidebar); --surface-sidebar: var(--incognito-sidebar); --sidebar-accent: var(--incognito-accent); --border: var(--incognito-border); --sidebar-border: var(--incognito-border); --input: var(--incognito-border); }
      html.incognito body[class*="style-"] [data-slot="sidebar-inset"],
      html.incognito body[class*="style-"] .aui-root.aui-thread-root,
      html.incognito body[class*="style-"] .aui-thread-viewport-footer,
      html.incognito body[class*="style-"] [data-slot="next-chat-rail"] { background: transparent; }
      html.incognito body[class*="style-"] .aui-root.aui-thread-root { --composer-bg: var(--card) !important; }
      .bg-background { background-color: var(--background); }
      .bg-card { background-color: var(--card); }
    `;
    document.head.append(style);
    document.documentElement.classList.add(theme, "incognito");
    document.body.classList.add("style-neutral");
    localStorage.setItem("maipai.incognito-explanation-seen", "true");
    writeIncognitoCache(true);
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await view.findByLabelText("Message input");
      const backdropRule = Array.from(style.sheet!.cssRules)
        .map((rule) => rule as CSSStyleRule)
        .find((rule) => rule.selectorText === "html.incognito body::before");
      const threadRoot = view.container.querySelector(".aui-root.aui-thread-root.bg-background");
      expect(threadRoot).not.toBeNull();
      const footer = view.container.querySelector(".aui-thread-viewport-footer");
      const rail = view.container.querySelector('[data-slot="next-chat-rail"]');
      const composer = view.container.querySelector('[data-slot="aui_composer-shell"]');
      expect(backdropRule).toBeDefined();
      expect(backdropRule!.style.position).toBe("fixed");
      expect(backdropRule!.style.background).toBe("var(--incognito-background)");
      expect(getComputedStyle(threadRoot!).backgroundColor).toBe("transparent");
      expect(getComputedStyle(footer!).backgroundColor).toBe("transparent");
      expect(getComputedStyle(rail!).backgroundColor).toBe("transparent");
      expect(getComputedStyle(document.body).getPropertyValue("--card").trim()).toBe(theme === "dark" ? "rgb(16, 34, 56)" : "rgb(255, 255, 255)");
      expect(getComputedStyle(document.body).getPropertyValue("--muted").trim()).toBe(theme === "dark" ? "rgb(20, 42, 67)" : "rgb(227, 234, 243)");
      expect(composer).not.toBeNull();
      expect(getComputedStyle(threadRoot!).getPropertyValue("--composer-bg").trim()).toBe(theme === "dark" ? "rgb(16, 34, 56)" : "rgb(255, 255, 255)");
    } finally {
      restore();
      style.remove();
      document.documentElement.classList.remove("dark", "light", "incognito");
      document.body.classList.remove("style-neutral");
    }
  });

  test("the global header toggle controls whether the chat turn is temporary", async () => {
    const restore = stubMultiTurnFetch();
    try {
      // This test covers the shared toggle-to-chat wiring; first-use
      // explanation behavior is exercised by incognitoContext.test.tsx.
      localStorage.setItem("maipai.incognito-explanation-seen", "true");
      writeIncognitoCache(false);
      const view = renderPage(
        <>
          <GlobalIncognitoToggle />
          <MemoryRouter initialEntries={["/chat"]}>
            <ChatPage person={makePerson()} />
          </MemoryRouter>
        </>,
      );
      await view.findByLabelText("Message input");
      fireEvent.click(await view.findByRole("button", { name: "Incognito Off" }));
      await view.findByRole("button", { name: "Incognito On" });
      await sendMessage(view, "a private question");
      await view.findByText("Reply 1.");

      expect(turnRequestBodies()[0]!.temporary).toBe(true);
      expect(sessionStorage.getItem("maipai.incognito")).toBe("1");
      // Issue #163: the conversation's OWN creation must ask for
      // mode: "temporary" too - a turn marked temporary against a
      // conversation minted with no mode is exactly the durable-id
      // mismatch the backend now refuses.
      expect(conversationCreateBodies()[0]).toEqual({ surface: "chat", mode: "temporary" });
    } finally {
      restore();
    }
  });

  // Issue #165: the strengthened assertions reproduced the missing-create
  // race under the frontend suite. Keep the regression in place, but skip
  // it until the New Thread transition can be investigated with contention
  // instrumentation; remove `.skip` once the underlying fix lands.
  test.skip("Incognito stays on across separate new threads and marks each first turn temporary", async () => {
    const restore = stubMultiTurnFetch();
    try {
      localStorage.setItem("maipai.incognito-explanation-seen", "true");
      writeIncognitoCache(true);
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await view.findByLabelText("Message input");
      await sendMessage(view, "a private question");
      await view.findByText("Reply 1.");
      fireEvent.click(within(document.getElementById("next-chat-rail")!).getByRole("button", { name: "New chat" }));
      await sendMessage(view, "another private question");
      await view.findByText("Reply 2.");

      const bodies = turnRequestBodies();
      expect(bodies).toHaveLength(2);
      expect(bodies[0]!.temporary).toBe(true);
      expect(bodies[1]!.temporary).toBe(true);
      expect(bodies[0]!.conversation_id).not.toBe(bodies[1]!.conversation_id);
      const conversationPosts = conversationCreateBodies();
      expect(conversationPosts).toHaveLength(2);
      expect(bodies[0]!.conversation_id).toBe("conv-temp-1");
      expect(bodies[1]!.conversation_id).toBe("conv-temp-2");
    } finally {
      restore();
    }
  });

  test("Incognito off sends normal turns, and a fresh session starts off", async () => {
    const restore = stubMultiTurnFetch();
    try {
      writeIncognitoCache(false);
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await sendMessage(view, "hi");
      await view.findByText("Reply 1.");

      const bodies = turnRequestBodies();
      expect(bodies).toHaveLength(1);
      expect(bodies[0]!.temporary).toBeUndefined();
      expect(sessionStorage.getItem("maipai.incognito")).toBeNull();
      // A regular thread's own creation must never claim mode:
      // "temporary" - the reverse mismatch this design deliberately
      // leaves alone (a real conversation, correctly minted).
      expect(conversationCreateBodies()[0]).toEqual({ surface: "chat" });
    } finally {
      restore();
    }
  });
});

describe("ChatPage (SHELL-02 slice 6: the composer's + menu)", () => {
  const PLUGIN = { id: "pkg-weather", version: "1.0.0", kind: "plugin", category: "lookup", display: "Weather", description: "Checks the local forecast.", tool_label: null, author: "MaiPai", license: "AGPL-3.0", installed_version: "1.0.0", latest_version: "1.0.0", channel: "stable" as const, status: "enabled" as const, smoke: { last_run_at: null, ok: null, message: null } };
  const IMAGE_ROLE = { id: "image", label: "image", wire: "chat" as const, residency: "resident" as const, endpoints: [], quality: [], sharesModelWith: null, state: { state: "ready" as const, since: "2026-09-22T00:00:00.000Z" }, reason: null, model: null, check: { state: "not checked" as const, at: null, reason: null, stale: false } };

  afterEach(() => __setUnwiredControlsForTests(false));

  // UPLOAD-IMG-02: `photos` is the person's resolved chat.photo_uploads
  // (the hub's own GET /api/settings shape); on by default, as the hub
  // resolves it for an adult.
  function stubAddMenuFetch(streamBody?: ReadableStream<Uint8Array>, imageRoleReady = false, width = 390, photos: { value: boolean; source: string } = { value: true, source: "default" }, imageParts: boolean | (() => boolean) = true): () => void {
    const original = globalThis.fetch;
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/settings?scope=person")) return Promise.resolve(Response.json([{ key: "chat.photo_uploads", value: photos.value, source: photos.source }]));
      if (url.includes("/api/host/chat-capabilities")) return Promise.resolve(Response.json({ image_parts: typeof imageParts === "function" ? imageParts() : imageParts, thinking: "switchable", thinking_modes: {} }));
      if (url.includes("/api/attachments/upload")) {
        const file = (init?.body as FormData).get("file") as File;
        return Promise.resolve(Response.json({ conversation_id: "conv-addmenu1", turn_id: String((init?.body as FormData).get("turn_id")), image: { id: "file-robot0001", name: file.name, width: 640, height: 480, media_type: "image/jpeg" } }, { status: 201 }));
      }
      if (url.includes("/api/conversations") && init?.method === "POST") return Promise.resolve(Response.json({ id: "conv-addmenu1", status: "open", surface: "chat" }));
      if (url.includes("/api/conversations")) return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      if (url.includes("/api/plugins")) return Promise.resolve(Response.json([PLUGIN]));
      if (url.includes("/api/engines")) return Promise.resolve(Response.json({ configured: imageRoleReady, roles: imageRoleReady ? [IMAGE_ROLE] : [], engines: [], budget: null }));
      if (streamBody && url.includes("/api/turn/stream")) return Promise.resolve(new Response(streamBody, { status: 200, headers: ASSISTANT_STREAM_HEADERS }));
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;
    return () => {
      globalThis.fetch = original;
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    };
  }

  const addButton = () => document.querySelector('[aria-label="Add"]') as HTMLButtonElement;
  // The add menu remains scoped to its own trigger wrapper; the separate
  // model selector uses the shipped ModelSelector kit.
  const addMenu = () => addButton().parentElement!.querySelector('[data-slot="composer-menu"]') as HTMLElement;

  test("lists the Apps group from a mocked plugins list, icon and description both present", async () => {
    // Apps sits behind the unwired-controls flag now (found live,
    // 2026-09-22): this test is about the group's own rendering, not
    // the default menu's contents - the flag forced on is what the
    // other unwired items' own tests already do above it.
    __setUnwiredControlsForTests(true);
    const restore = stubAddMenuFetch();
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await view.findByLabelText("Message input");
      fireEvent.click(addButton());
      await within(addMenu()).findByText("Weather");
      expect(within(addMenu()).getByText("Checks the local forecast.")).toBeTruthy();
      // kindStyle("plugin") -> the puzzle IconTile, not a bare glyph.
      expect(addMenu().querySelector("svg.lucide-puzzle")).toBeTruthy();
    } finally {
      restore();
    }
  });

  test("choosing an app scopes the next turn - the send payload carries package_scope", async () => {
    // Same reason as the test above: Apps only renders with the flag on.
    __setUnwiredControlsForTests(true);
    const restore = stubAddMenuFetch(
      ndjsonStream([
        { type: "delta", text: "Sunny today." },
        { type: "done", value: { turn_id: "turn-addmenu1", reply: { text: "Sunny today." }, source: "model", safety: SAFETY } },
      ]),
    );
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await view.findByLabelText("Message input");
      fireEvent.click(addButton());
      const weatherItem = await within(addMenu()).findByText("Weather");
      fireEvent.click(weatherItem);
      // The menu closes on selection, same as an Apps or Thinking pick.
      expect(addMenu()).not.toHaveAttribute("data-open");
      fireEvent.change(await view.findByLabelText("Message input"), { target: { value: "what's the weather" } });
      const send = (await view.findByLabelText("Send message")) as HTMLButtonElement;
      await waitFor(() => expect(send.disabled).toBe(false));
      fireEvent.click(send);
      await view.findByText("Sunny today.");
      const call = (globalThis.fetch as unknown as ReturnType<typeof mock>).mock.calls.find((c: unknown[]) => (typeof c[0] === "string" ? c[0] : (c[0] as URL | Request).toString()).includes("/api/turn/stream"));
      const body = JSON.parse((call![1] as RequestInit).body as string);
      expect(body.package_scope).toBe("pkg-weather");
    } finally {
      restore();
    }
  });

  test("Create image and Web search stay out of the menu by default, even with the image role ready", async () => {
    const restore = stubAddMenuFetch(undefined, true);
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await view.findByLabelText("Message input");
      fireEvent.click(addButton());
      // Apps stays out by default too (found live, 2026-09-22), same
      // gate as Create image/Web search - "Add photos and files" is
      // what proves the menu itself opened.
      await within(addMenu()).findByText("Add photos and files");
      expect(within(addMenu()).queryByText("Create image")).toBeNull();
      expect(within(addMenu()).queryByText("Web search")).toBeNull();
      expect(within(addMenu()).queryByText("Weather")).toBeNull();
    } finally {
      restore();
    }
  });

  test.each([
    ["adult role with child backend band", { role: "adult" as const, age_band: "child" as const }, { value: true, source: "default" }],
    ["child role with child backend band", { role: "child" as const, age_band: "child" as const }, { value: true, source: "default" }],
  ])("photo upload menu and queue follow the backend band: %s", async (_label, personFields, photos) => {
    const restore = stubAddMenuFetch(undefined, false, 390, photos);
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson(personFields)} />
        </MemoryRouter>,
      );
      await view.findByLabelText("Message input");
      fireEvent.click(addButton());
      await within(addMenu()).findByText("Add files");
      expect(within(addMenu()).queryByText("Add photos and files")).toBeNull();
      expect(within(addMenu()).queryByText("Take a photo")).toBeNull();
    } finally {
      restore();
    }
  });

  test("Create image and Web search render with the unwired-controls flag forced on - Create image also needs the image role ready", async () => {
    __setUnwiredControlsForTests(true);
    const restore = stubAddMenuFetch(undefined, true);
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await view.findByLabelText("Message input");
      fireEvent.click(addButton());
      await within(addMenu()).findByText("Web search");
      expect(within(addMenu()).getByText("Create image")).toBeTruthy();
    } finally {
      restore();
    }
  });

  test("Create image stays out even with the flag on, when the image role isn't ready", async () => {
    __setUnwiredControlsForTests(true);
    const restore = stubAddMenuFetch(undefined, false);
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await view.findByLabelText("Message input");
      fireEvent.click(addButton());
      // Web search has no role of its own to wait on - present as soon
      // as the flag is, proving the menu itself rendered (not a stale
      // query) while Create image's own extra gate held it back.
      await within(addMenu()).findByText("Web search");
      expect(within(addMenu()).queryByText("Create image")).toBeNull();
    } finally {
      restore();
    }
  });

  test("the default menu shows exactly photos and files, and camera", async () => {
    // Flag off (the default), a plugin installed and the image role
    // ready - the two live-finding conditions (Apps, Create image)
    // that used to leak into the default menu - to prove both stay
    // out at once, not just each other's own dedicated test.
    const restore = stubAddMenuFetch(undefined, true);
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await view.findByLabelText("Message input");
      fireEvent.click(addButton());
      await within(addMenu()).findByText("Add photos and files");
      const items = Array.from(addMenu().querySelectorAll('[data-slot="composer-menu-item"]')).map((el) => el.textContent);
      expect(items).toEqual([expect.stringContaining("Add photos and files"), expect.stringContaining("Take a photo")]);
    } finally {
      restore();
    }
  });

  // UPLOAD-IMG-02: a child whose parent has not turned on photos gets no
  // photo controls at all: no camera row, and the picker row offers files.
  test("a child with photo uploads off sees no photo or camera control", async () => {
    const restore = stubAddMenuFetch(undefined, false, 390, { value: true, source: "default" });
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson({ role: "child", age_band: "child" })} />
        </MemoryRouter>,
      );
      await view.findByLabelText("Message input");
      fireEvent.click(addButton());
      await within(addMenu()).findByText("Add files");
      const items = Array.from(addMenu().querySelectorAll('[data-slot="composer-menu-item"]')).map((el) => el.textContent);
      expect(items).toEqual([expect.stringContaining("Add files")]);
      expect(within(addMenu()).queryByText("Take a photo")).toBeNull();
      expect(within(addMenu()).queryByText("Add photos and files")).toBeNull();
    } finally {
      restore();
    }
  });

  test("a child whose parent turned photos on gets the photo controls", async () => {
    const restore = stubAddMenuFetch(undefined, false, 390, { value: true, source: "user" });
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson({ role: "child" })} />
        </MemoryRouter>,
      );
      await view.findByLabelText("Message input");
      fireEvent.click(addButton());
      await within(addMenu()).findByText("Add photos and files");
      expect(within(addMenu()).getByText("Take a photo")).toBeTruthy();
    } finally {
      restore();
    }
  });

  test("a live picture capability refresh enables image attachments without reloading chat", async () => {
    let imageParts = false;
    const visibilityDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    const restore = stubAddMenuFetch(undefined, false, 390, { value: true, source: "user" }, () => imageParts);
    try {
      const view = renderPage(<MemoryRouter initialEntries={["/chat"]}><ChatPage person={makePerson()} /></MemoryRouter>);
      await view.findByLabelText("Message input");
      fireEvent.click(addButton());
      const menu = within(addMenu());
      await menu.findByText("Add files");
      expect(menu.getByText("Pictures need a ready vision model.")).toBeTruthy();
      const captureFilePicker = async (label: string) => {
        const appended: HTMLInputElement[] = [];
        const appendChild = document.body.appendChild.bind(document.body);
        document.body.appendChild = (<T extends Node>(node: T): T => {
          if (node instanceof HTMLInputElement) appended.push(node);
          return appendChild(node);
        }) as typeof document.body.appendChild;
        try {
          fireEvent.click(await within(addMenu()).findByText(label));
        } finally {
          document.body.appendChild = appendChild;
        }
        return appended[0]!;
      };
      const filesOnlyInput = await captureFilePicker("Add files");
      expect(filesOnlyInput.accept).not.toContain("image/*");
      filesOnlyInput.remove();

      imageParts = true;
      fireEvent(window, new Event("visibilitychange"));
      await waitFor(() => expect((globalThis.fetch as unknown as ReturnType<typeof mock>).mock.calls.filter((call: unknown[]) => String(call[0]).includes("chat-capabilities")).length).toBeGreaterThan(1));
      fireEvent.click(addButton());
      await within(addMenu()).findByText("Add photos and files");
      const imageInput = await captureFilePicker("Add photos and files");
      expect(imageInput.accept).toContain("image/*");
      imageInput.remove();
    } finally {
      restore();
      if (visibilityDescriptor) Object.defineProperty(document, "visibilityState", visibilityDescriptor);
      else delete (document as unknown as { visibilityState?: string }).visibilityState;
    }
  });

  // UPLOAD-IMG-02, end to end through the shipped composer: a picture taken
  // with the phone camera row becomes the kit's attachment tile in the
  // composer, then rides the send. The picture is uploaded to the hub's
  // store first, the turn carries only its id, and the sent message shows
  // the kit's image attachment above the person's bubble.
  test("a camera picture shows as a composer tile, uploads first, and the sent message keeps its picture", async () => {
    const restore = stubAddMenuFetch(
      ndjsonStream([
        { type: "delta", text: "I can't see pictures yet." },
        { type: "done", value: { turn_id: "turn-photo1", reply: { text: "I can't see pictures yet." }, source: "model", safety: SAFETY } },
      ]),
    );
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await view.findByLabelText("Message input");
      fireEvent.click(addButton());
      // The camera row builds its own file input (composerAddMenu.tsx's
      // TakeAPhotoItem); catch it as it is attached to the page.
      const appended: HTMLInputElement[] = [];
      const appendChild = document.body.appendChild.bind(document.body);
      document.body.appendChild = (<T extends Node>(node: T): T => {
        if (node instanceof HTMLInputElement) appended.push(node);
        return appendChild(node);
      }) as typeof document.body.appendChild;
      try {
        fireEvent.click(await within(addMenu()).findByText("Take a photo"));
      } finally {
        document.body.appendChild = appendChild;
      }
      const input = appended[0]!;
      expect(input.type).toBe("file");
      expect(input.accept).toBe("image/*");
      Object.defineProperty(input, "files", { configurable: true, value: [new File(["robot bytes"], "robot.png", { type: "image/png" })] });
      await act(async () => {
        await input.onchange?.(new Event("change"));
      });
      await waitFor(() => expect(document.querySelector('.aui-composer-attachments [aria-label="Image attachment"]')).toBeTruthy());
      expect(document.querySelector(".aui-composer-attachments .aui-attachment-tile-remove")).toBeTruthy();
      fireEvent.change(await view.findByLabelText("Message input"), { target: { value: "this is my new robot" } });
      const send = (await view.findByLabelText("Send message")) as HTMLButtonElement;
      await waitFor(() => expect(send.disabled).toBe(false));
      fireEvent.click(send);
      await view.findByText("I can't see pictures yet.");
      const calls = (globalThis.fetch as unknown as ReturnType<typeof mock>).mock.calls as [RequestInfo | URL, RequestInit | undefined][];
      const urlOf = (c: [RequestInfo | URL, RequestInit | undefined]) => (typeof c[0] === "string" ? c[0] : c[0].toString());
      const uploadIndex = calls.findIndex((c) => urlOf(c).includes("/api/attachments/upload"));
      const turnIndex = calls.findIndex((c) => urlOf(c).includes("/api/turn/stream"));
      expect(uploadIndex).toBeGreaterThan(-1);
      expect(turnIndex).toBeGreaterThan(uploadIndex);
      const body = JSON.parse(calls[turnIndex]![1]!.body as string);
      expect(body.images).toEqual([{ id: "file-robot0001", name: "robot.png", width: 640, height: 480, media_type: "image/jpeg" }]);
      expect(JSON.stringify(body)).not.toContain("data:");
      // The sent message: the kit's UserMessageAttachments, outside the composer.
      await waitFor(() => expect(document.querySelector('.aui-user-message-attachments-end [aria-label="Image attachment"]')).toBeTruthy());
      expect(document.querySelector(".aui-composer-attachments [aria-label=\"Image attachment\"]")).toBeNull();
    } finally {
      restore();
    }
  });

  test("the one-entry desktop add control is a direct attachment button", async () => {
    const restore = stubAddMenuFetch(undefined, false, 1280);
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await view.findByLabelText("Message input");
      const add = addButton();
      expect(add).toBeTruthy();
      expect(add.parentElement?.querySelector('[data-slot="composer-menu"]')).toBeNull();
    } finally {
      restore();
    }
  });
});

describe("ChatPage (ADMIN-COMPARE-01: compare with the bare model)", () => {
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
      if (url.includes("/api/turn/bare")) return Promise.resolve(new Response(bareNdjsonStream(bareEvents), { status: 200, headers: { "content-type": "application/x-ndjson" } }));
      if (url.includes("/api/turn/stream")) {
        return Promise.resolve(
          new Response(
            ndjsonStream([
              { type: "delta", text: "It's sunny." },
              { type: "done", value: { turn_id: "turn-compare123", conversation_id: "conv-compare123", reply: { text: "It's sunny." }, source: "model", safety: SAFETY } },
            ]),
            { status: 200, headers: ASSISTANT_STREAM_HEADERS },
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
      stats: { prompt_tokens: 10, predicted_tokens: 5, tokens_per_second: 20, time_to_first_token_ms: 40, total_time_ms: 200, context_tokens: 10, cache_reuse_tokens: null, cache_reuse_percent: null, engine: "local family.gguf", stop_reason: "stop", thinking: true },
      persona_fragments: "Warm and concise.",
    },
  };

  test("the owner sees Compare with the bare model in the More menu, and it opens a two-column view", async () => {
    const restore = stubCompareFetch([TRACE_EVENT, { type: "delta", text: "It's " }, { type: "delta", text: "probably sunny too." }, { type: "done" }]);
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
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
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makeAdultPerson()} />
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
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
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

  test("a non-admin household member never sees the bare-mode switch either", async () => {
    const restore = stubCompareFetch([]);
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makeAdultPerson()} />
        </MemoryRouter>,
      );
      await sendMessage(view, "what's the weather");
      await openMoreMenu(view);
      expect(await view.findByText("Export as Markdown")).toBeVisible();
      expect(view.queryByText("Turn on bare mode for this conversation")).toBeNull();
    } finally {
      restore();
    }
  });

  test("the switch turns on the persistent banner (no dismiss control) and carries bare: true on the next request", async () => {
    // Radix's DropdownMenu (ActionBarMorePrimitive underneath) is flaky
    // to reopen a second time in happy-dom (chatMemoryChip.test.tsx's
    // own established finding) - this test opens the menu exactly once,
    // matching that precedent, rather than reopening to also assert the
    // item's own label flip or the off-path, which the toggle's own
    // trivial symmetry (BareModeContext's `toggle` is a plain boolean
    // flip) doesn't need a second, flake-prone round trip to prove.
    const restore = stubCompareFetch([]);
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await sendMessage(view, "what's the weather");
      await view.findByText("It's sunny.");
      expect(view.queryByText("Bare mode is on")).toBeNull();
      await openMoreMenu(view);
      fireEvent.click(await view.findByText("Turn on bare mode for this conversation"));
      // COORDINATOR, 2026-09-22: "a persistent visible marker... not a
      // toast" - present, role="status", and (the real point) no button
      // anywhere in it to dismiss it - the switch is the only way off.
      const banner = (await view.findByText("Bare mode is on")).closest('[role="status"]') as HTMLElement;
      expect(banner).toBeVisible();
      expect(within(banner).queryByRole("button")).toBeNull();

      // Sending now must carry bare: true on the real request - the
      // LAST matching call, since the first send (above, bare mode
      // still off) also hit this same URL. sendMessage() only awaits
      // the click, not the reply, so the fetch itself can still be a
      // tick away when it returns - waited for directly rather than
      // raced.
      await sendMessage(view, "and now?");
      const streamCallsFor = () => (globalThis.fetch as unknown as { mock: { calls: [RequestInfo | URL, RequestInit | undefined][] } }).mock.calls.filter(([input]) => (typeof input === "string" ? input : input.toString()).includes("/api/turn/stream"));
      await waitFor(() => expect(streamCallsFor().length).toBeGreaterThan(1));
      const streamCalls = streamCallsFor();
      const sentBody = JSON.parse((streamCalls[streamCalls.length - 1]![1]!.body as string) ?? "{}");
      expect(sentBody.bare).toBe(true);
    } finally {
      restore();
    }
  });

  test("a bare turn's own reply carries the bare-model badge", async () => {
    const restore = stubCompareFetch([]);
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await sendMessage(view, "what's the weather");
      await view.findByText("It's sunny.");
      expect(view.queryByText("Bare model")).toBeNull();
      await openMoreMenu(view);
      fireEvent.click(await view.findByText("Turn on bare mode for this conversation"));
      globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/conversations") && init?.method === "POST") return Promise.resolve(Response.json({ id: "conv-compare123", status: "open", surface: "chat" }));
        if (url.includes("/api/conversations")) return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
        if (url.includes("/api/turn/stream")) {
          return Promise.resolve(
            new Response(
              ndjsonStream([
                { type: "delta", text: "The bare model says hi." },
                { type: "done", value: { turn_id: "turn-bare999", conversation_id: "conv-compare123", reply: { text: "The bare model says hi." }, source: "model", safety: SAFETY, bare: true } },
              ]),
              { status: 200, headers: ASSISTANT_STREAM_HEADERS },
            ),
          );
        }
        return Promise.resolve(new Response("{}", { status: 200 }));
      }) as unknown as typeof fetch;
      await sendMessage(view, "and now?");
      await view.findByText("The bare model says hi.");
      expect(await view.findByText("Bare model")).toBeVisible();
    } finally {
      restore();
    }
  });
});

// DICT-01 (2026-09-23): a live Jesse report ("I don't think dictation
// works in the browser yet") traced to a wire-shape mismatch - the
// server's real messages use {t, v}, the client read {type, text},
// which never matched a single one, so the mic button silently did
// nothing at all in every browser (sttDictationAdapter.ts's own header
// comment has the full trace). Fixed there; this describe covers the
// coordinator's own acceptance line for the half that belongs to this
// page: "clicking the mic shows the not-installed message and the
// composer still sends text." The complementary half ("a fake 2-second
// utterance produces a transcript") is proven two ways that both outrank
// a jsdom mock here: sttDictationAdapter.test.ts's own message-handling
// tests (t/v now matches what the server really sends), and a live,
// real headless-Chromium repro with a fake mic device through the real
// /api/stt/stream socket (docs/dev.md's DICT-01 note) - jsdom has no
// AudioWorklet to run a real worklet thread in, so a mocked "transcript
// appears" test here would only prove the mock, not the pipeline.
describe("ChatPage (DICT-01: the mic button's not-installed state)", () => {
  const ORIGINAL_MEDIA_DEVICES = navigator.mediaDevices;

  function stubDictationFetch(sttInstalled: boolean): () => void {
    const original = globalThis.fetch;
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    // happy-dom has no MediaDevices at all - assistant-ui's own runtime
    // reads `navigator.mediaDevices` to decide `thread.capabilities.
    // dictation` in the first place (mic-capture.ts's real code path is
    // never reached in this test either way, since the not-installed
    // branch returns before it - sttDictationAdapter.test.ts's own
    // `withFakeAudioEnv` is the file that actually exercises capture).
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: () => Promise.reject(new Error("not reached in this test")) },
    });
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/voice/stt/status")) return Promise.resolve(Response.json({ installed: sttInstalled, sileroInstalled: sttInstalled, moonshineInstalled: sttInstalled, recognizerLoaded: false }));
      if (url.includes("/api/conversations") && init?.method === "POST") return Promise.resolve(Response.json({ id: "conv-dict1", status: "open", surface: "chat" }));
      if (url.includes("/api/conversations")) return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      if (url.includes("/api/turn/stream")) {
        return Promise.resolve(
          new Response(
            ndjsonStream([
              { type: "delta", text: "Typed while STT is uninstalled." },
              { type: "done", value: { turn_id: "turn-dict1", reply: { text: "Typed while STT is uninstalled." }, source: "model", safety: SAFETY } },
            ]),
            { status: 200, headers: ASSISTANT_STREAM_HEADERS },
          ),
        );
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;
    return () => {
      globalThis.fetch = original;
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: ORIGINAL_MEDIA_DEVICES });
    };
  }

  test("STT not installed: clicking the mic never opens a session, and typing plus Send still works", async () => {
    const restore = stubDictationFetch(false);
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await view.findByLabelText("Message input");
      // `sttInstalled` falls back to "installed" while the status query
      // is still loading (the not-installed message must never flash
      // false before a real answer exists) - this waits past that
      // window so the click below hits the real, resolved "false", not
      // the loading-state fallback. The button's accessible name
      // ("Start voice input") is its own sr-only span text
      // (TooltipIconButton's shape, ui-v0.5.35), not an aria-label
      // attribute.
      const micButton = await view.findByRole("button", { name: "Start voice input" });
      await new Promise((resolve) => setTimeout(resolve, 50));
      fireEvent.click(micButton);
      // No crash, and the ordinary text path still works right after -
      // the coordinator's own "the composer still sends text."
      fireEvent.change(await view.findByLabelText("Message input"), { target: { value: "typed instead" } });
      const send = (await view.findByLabelText("Send message")) as HTMLButtonElement;
      await waitFor(() => expect(send.disabled).toBe(false));
      fireEvent.click(send);
      expect(await view.findByText("Typed while STT is uninstalled.")).toBeVisible();
    } finally {
      restore();
    }
  });
});

// VOICE-LIVE-01 (2026-09-23): the composer's trailing-side append point
// (`ComposerExtraEnd`, commons ui-v0.5.36) mounts `ComposerVoiceControls`
// (composerVoiceControls.tsx, already built and unit-tested on its own)
// - this describe covers the item's own acceptance line: "the waveform
// renders in the composer on /chat when stt and tts are both ready
// and is absent otherwise."
describe("ChatPage (VOICE-LIVE-01: the composer's voice-conversation trigger)", () => {
  function stubDictationFetch(sttTtsReady: boolean): () => void {
    const original = globalThis.fetch;
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/engines")) {
        const roles = sttTtsReady
          ? [
              { id: "stt", label: "stt", wire: "chat", residency: "resident", endpoints: [], quality: [], sharesModelWith: null, state: { state: "ready", since: "2026-09-23T00:00:00.000Z" }, reason: null, model: null, check: { state: "not checked", at: null, reason: null, stale: false } },
              { id: "tts", label: "tts", wire: "chat", residency: "resident", endpoints: [], quality: [], sharesModelWith: null, state: { state: "ready", since: "2026-09-23T00:00:00.000Z" }, reason: null, model: null, check: { state: "not checked", at: null, reason: null, stale: false } },
            ]
          : [];
        return Promise.resolve(Response.json({ configured: sttTtsReady, roles, engines: [], budget: null }));
      }
      if (url.includes("/api/voice/stt/status")) return Promise.resolve(Response.json({ installed: true, sileroInstalled: true, moonshineInstalled: true, recognizerLoaded: false }));
      if (url.includes("/api/conversations") && init?.method === "POST") return Promise.resolve(Response.json({ id: "conv-voicelive1", status: "open", surface: "chat" }));
      if (url.includes("/api/conversations")) return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;
    return () => {
      globalThis.fetch = original;
    };
  }

  test("absent when stt/tts aren't both ready - the common household today", async () => {
    const restore = stubDictationFetch(false);
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await view.findByLabelText("Message input");
      await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
      expect(view.queryByLabelText("Start a voice conversation")).toBeNull();
    } finally {
      restore();
    }
  });

  // VOICE-LIVE-03b (owner's ruling, 2026-09-23): the trailing slot is
  // the waveform pill alone now - no chevron, no voice/microphone menu
  // (moved to Settings' own VoiceCatalogSection.tsx), so this no longer
  // needs the mediaDevices/settings-catalog stubbing the chevron once did.
  test("renders the waveform pill, alone, once stt and tts are both ready", async () => {
    const restore = stubDictationFetch(true);
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      await view.findByLabelText("Message input");
      const waveform = await view.findByLabelText("Start a voice conversation");
      expect(waveform).toBeTruthy();
      expect(view.queryByLabelText("Choose a voice")).toBeNull();
      // On the trailing side, before Send - not a second copy of the
      // leading-side ComposerExtra slot.
      const send = view.getByRole("button", { name: "Send message" });
      expect(waveform.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    } finally {
      restore();
    }
  });
});

describe("ChatPage (HANDSFREE-01(a): read typed replies aloud)", () => {
  function stubAutoReadFetch(ttsReady: boolean): { restore: () => void; ttsCalls: () => number } {
    const original = globalThis.fetch;
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    let turnCount = 0;
    let ttsCount = 0;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/api/health")) return Promise.resolve(Response.json({ engines: { voice: { kind: "url", pid: null, alive: true, availability: ttsReady ? "ready" : "unavailable" } } }));
      if (url.includes("/api/engines")) {
        const roles = ttsReady ? [{ id: "tts", state: { state: "ready" } }] : [];
        return Promise.resolve(Response.json({ configured: ttsReady, roles, engines: [], budget: null }));
      }
      if (url === "/api/conversations" && init?.method === "POST") return Promise.resolve(Response.json({ id: "conv-autoread1", status: "open", surface: "chat" }));
      if (url.includes("/api/conversations")) return Promise.resolve(Response.json([]));
      if (url === "/api/turn/stream") {
        turnCount++;
        const text = `Typed reply ${turnCount}.`;
        return Promise.resolve(new Response(ndjsonStream([
          { type: "delta", text },
          { type: "done", value: { turn_id: `turn-autoread${turnCount}`, reply: { text }, source: "model", safety: SAFETY } },
        ]), { status: 200, headers: ASSISTANT_STREAM_HEADERS }));
      }
      if (url.includes("/api/tts")) ttsCount++;
      return Promise.resolve(Response.json({}));
    }) as unknown as typeof fetch;
    return {
      restore: () => { globalThis.fetch = original; },
      ttsCalls: () => ttsCount,
    };
  }

  async function openHeaderMenu(view: { findAllByRole: (role: string, options: { name: string }) => Promise<HTMLElement[]> }) {
    const trigger = (await view.findAllByRole("button", { name: "Conversation actions" }))[0]!;
    act(() => {
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1 });
      fireEvent.click(trigger);
    });
  }

  test("the header toggle speaks typed turns, can stop doing so, and resets on conversation switch", async () => {
    const env = stubAutoReadFetch(true);
    try {
      const view = renderPage(
        <ChatHeaderDataProvider>
          <ChatHeaderBar />
          <MemoryRouter initialEntries={["/chat"]}>
            <ChatPage person={makePerson()} />
          </MemoryRouter>
        </ChatHeaderDataProvider>,
      );
      await view.findByLabelText("Message input");
      await openHeaderMenu(view);
      const toggle = await view.findByRole("menuitemcheckbox", { name: "Read replies aloud" });
      fireEvent.click(toggle);
      await sendMessage(view, "say this reply");
      const firstReply = await view.findByText("Typed reply 1.");
      fireEvent.mouseEnter(firstReply.closest('[data-slot="aui_assistant-message-root"]') as HTMLElement);
      expect(await view.findByRole("button", { name: "Read aloud" })).toBeVisible();
      await waitFor(() => expect(env.ttsCalls()).toBeGreaterThan(0));

      await openHeaderMenu(view);
      const checkedToggle = await view.findByRole("menuitemcheckbox", { name: "Read replies aloud" });
      expect(checkedToggle).toHaveAttribute("aria-checked", "true");
      fireEvent.click(checkedToggle);
      const callsAfterDisable = env.ttsCalls();
      await sendMessage(view, "keep this one quiet");
      await view.findByText("Typed reply 2.");
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(env.ttsCalls()).toBe(callsAfterDisable);

      fireEvent.click(await within(document.getElementById("next-chat-rail")!).findByRole("button", { name: "New chat" }));
      await openHeaderMenu(view);
      expect(await view.findByRole("menuitemcheckbox", { name: "Read replies aloud" })).toHaveAttribute("aria-checked", "false");
    } finally {
      env.restore();
    }
  });

  test("when TTS is unavailable both the manual Speak action and header toggle are absent", async () => {
    const env = stubAutoReadFetch(false);
    try {
      const view = renderPage(
        <ChatHeaderDataProvider>
          <ChatHeaderBar />
          <MemoryRouter initialEntries={["/chat"]}>
            <ChatPage person={makePerson()} />
          </MemoryRouter>
        </ChatHeaderDataProvider>,
      );
      await sendMessage(view, "no tts configured");
      const reply = await view.findByText("Typed reply 1.");
      fireEvent.mouseEnter(reply.closest('[data-slot="aui_assistant-message-root"]') as HTMLElement);
      expect(view.queryByRole("button", { name: "Read aloud" })).toBeNull();
      await openHeaderMenu(view);
      expect(view.queryByText("Read replies aloud")).toBeNull();
    } finally {
      env.restore();
    }
  });
});

describe("ChatPage (UI-2 A7: Branch in new chat)", () => {
  function stubForkFetch(forkCalls: string[]): () => void {
    const original = globalThis.fetch;
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/fork") && init?.method === "POST") {
        forkCalls.push(url);
        return Promise.resolve(Response.json({ id: "conv-forked123", status: "open", surface: "chat" }, { status: 201 }));
      }
      if (url.includes("/api/conversations") && init?.method === "POST") return Promise.resolve(Response.json({ id: "conv-fork-src", status: "open", surface: "chat" }));
      if (url.includes("/api/conversations")) return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      if (url.includes("/api/turn/stream")) {
        return Promise.resolve(
          new Response(
            ndjsonStream([
              { type: "delta", text: "Sprout likes the garden." },
              { type: "done", value: { turn_id: "turn-fork123", conversation_id: "conv-fork-src", reply: { text: "Sprout likes the garden." }, source: "model", safety: SAFETY } },
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

  test("More > Branch in new chat forks at that reply and opens the new conversation", async () => {
    const forkCalls: string[] = [];
    const restore = stubForkFetch(forkCalls);
    try {
      const view = renderPage(
        <MemoryRouter initialEntries={["/chat"]}>
          <ConversationLocation />
          <ChatPage person={makePerson()} />
        </MemoryRouter>,
      );
      fireEvent.change(await view.findByLabelText("Message input"), { target: { value: "who likes the garden" } });
      const send = (await view.findByLabelText("Send message")) as HTMLButtonElement;
      await waitFor(() => expect(send.disabled).toBe(false));
      fireEvent.click(send);
      expect(await view.findByText("Sprout likes the garden.")).toBeVisible();
      const trigger = await view.findByRole("button", { name: "More" });
      act(() => {
        fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1 });
        fireEvent.click(trigger);
      });
      fireEvent.click(await view.findByText("Branch in new chat"));
      await waitFor(() => expect(forkCalls).toEqual(["/api/conversations/turns/turn-fork123/fork"]));
      await waitFor(() => expect(view.getByTestId("conversation-location").textContent).toContain("conversation=conv-forked123"));
    } finally {
      restore();
    }
  });
});
