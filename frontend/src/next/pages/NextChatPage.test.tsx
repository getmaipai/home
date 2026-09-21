import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NextChatPage } from "@/next/pages/NextChatPage";
import type { Roster } from "@/lib/api";

afterEach(() => {
  cleanup();
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
      const { findByLabelText } = render(
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
      const { findByText } = render(
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
      const { findByText } = render(
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
      const view = render(
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
