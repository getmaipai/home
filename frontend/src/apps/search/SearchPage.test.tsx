import { describe, test, mock, afterEach } from "bun:test";
import { cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { SearchPage } from "@/apps/search/SearchPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { Roster } from "@/lib/api";

afterEach(cleanup);

function makePerson(): Roster {
  return {
    id: "person-jesse123",
    display_name: "jesse",
    nickname: null,
    role: "owner",
    avatar_seed: "person-jesse123",
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

function stubFetch(): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = mock(() => Promise.resolve(Response.json([]))) as unknown as typeof fetch;
  return () => (globalThis.fetch = original);
}

function ChatStub() {
  const state = useLocation().state as { initialText?: string } | null;
  return <div>Asked MaiPai: {state?.initialText ?? ""}</div>;
}

function renderSearchPage() {
  return renderWithQueryClient(
    <MemoryRouter initialEntries={["/search"]}>
      <Routes>
        <Route path="/search" element={<SearchPage person={makePerson()} />} />
        <Route path="/memory" element={<div>The real memories page</div>} />
        <Route path="/chat" element={<ChatStub />} />
      </Routes>
    </MemoryRouter>,
  );
}

// `far`'s own destination for "Search" and Cmd/Ctrl+K - the same shared
// search (`useSearchCommand`) `CommandPalette.tsx` uses, as a real page.
describe("SearchPage", () => {
  test("typing lists a matching app", async () => {
    const restore = stubFetch();
    try {
      const { findByRole, findByText } = renderSearchPage();
      const input = await findByRole("textbox", { name: "Search" });
      fireEvent.change(input, { target: { value: "memory" } });
      await findByText("Memory");
    } finally {
      restore();
    }
  });

  test("selecting a match navigates to it", async () => {
    const restore = stubFetch();
    try {
      const { findByRole, findByText } = renderSearchPage();
      const input = await findByRole("textbox", { name: "Search" });
      fireEvent.change(input, { target: { value: "memory" } });
      const match = await findByRole("button", { name: /Memory/ });
      fireEvent.click(match);
      await findByText("The real memories page");
    } finally {
      restore();
    }
  });

  test("the Ask MaiPai row sends the typed text to chat", async () => {
    const restore = stubFetch();
    try {
      const { findByRole, findByText } = renderSearchPage();
      const input = await findByRole("textbox", { name: "Search" });
      fireEvent.change(input, { target: { value: "help me plan dinner" } });
      const ask = await findByRole("button", { name: /Ask MaiPai: help me plan dinner/ });
      fireEvent.click(ask);
      await findByText("Asked MaiPai: help me plan dinner");
    } finally {
      restore();
    }
  });
});
