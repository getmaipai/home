import { describe, test, expect, mock, afterEach } from "bun:test";
import { cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { CommandPalette } from "@/shell/search/CommandPalette";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";

afterEach(cleanup);

function stubFetch(routes: Record<string, unknown> = {}): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [path, body] of Object.entries(routes)) {
      if (url.includes(path)) return Promise.resolve(Response.json(body));
    }
    if (url.includes("/api/settings")) return Promise.resolve(Response.json([]));
    return Promise.resolve(Response.json([]));
  }) as unknown as typeof fetch;
  return () => (globalThis.fetch = original);
}

function ChatStub() {
  const state = useLocation().state as { initialText?: string } | null;
  return <div>Asked MaiPai: {state?.initialText ?? ""}</div>;
}

function renderPalette(open = true) {
  return renderWithQueryClient(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route
          path="/"
          element={<CommandPalette personId="person-abc123" open={open} onOpenChange={() => {}} />}
        />
        <Route path="/memory" element={<div>The real memories page</div>} />
        <Route path="/chat" element={<ChatStub />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("CommandPalette", () => {
  test("closed: renders nothing visible", () => {
    const restore = stubFetch();
    try {
      const { queryByPlaceholderText } = renderPalette(false);
      expect(queryByPlaceholderText("Search, or ask MaiPai...")).toBeNull();
    } finally {
      restore();
    }
  });

  test("open with no query: shows the app catalog, keyboard-navigable", async () => {
    const restore = stubFetch();
    try {
      const { findByPlaceholderText, findByText } = renderPalette(true);
      await findByPlaceholderText("Search, or ask MaiPai...");
      await findByText("Chat"); // APP_CATALOG, no query needed
    } finally {
      restore();
    }
  });

  test("typing then selecting a match navigates and closes", async () => {
    const restore = stubFetch();
    try {
      const { findByPlaceholderText, findByText } = renderPalette(true);
      const input = await findByPlaceholderText("Search, or ask MaiPai...");
      fireEvent.change(input, { target: { value: "memory" } });
      const match = await findByText("Memory");
      fireEvent.click(match);
      await findByText("The real memories page");
    } finally {
      restore();
    }
  });

  test("Enter with nothing arrowed to asks MaiPai, even with a real match showing", async () => {
    const restore = stubFetch();
    try {
      const { findByPlaceholderText, findByText } = renderPalette(true);
      const input = await findByPlaceholderText("Search, or ask MaiPai...");
      fireEvent.change(input, { target: { value: "memory" } });
      await findByText("Memory"); // confirms the real match rendered too
      fireEvent.keyDown(input, { key: "Enter" });
      await findByText("Asked MaiPai: memory");
    } finally {
      restore();
    }
  });

  test("clearing the query drops a provider match instead of leaving it stale", async () => {
    // Regression: useSearchCommand's query disables itself on an empty
    // query, but react-query's `placeholderData` still surfaces the last
    // fetched (non-empty-query) data for a disabled query, since it keys
    // off query status, not fetch status - a provider match from a prior
    // keystroke could linger in the dropdown after the box was cleared.
    const restore = stubFetch({ "/api/people": [{ id: "p1", display_name: "Marlow", role: "kid" }] });
    try {
      const { findByPlaceholderText, findByText, queryByText } = renderPalette(true);
      const input = await findByPlaceholderText("Search, or ask MaiPai...");
      fireEvent.change(input, { target: { value: "marlow" } });
      await findByText("Marlow");
      fireEvent.change(input, { target: { value: "" } });
      expect(queryByText("Marlow")).toBeNull();
    } finally {
      restore();
    }
  });
});
