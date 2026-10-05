import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import FullLayout from "@maipai/ui/src/dashboard/layouts/full/FullLayout";
import { TooltipProvider } from "@maipai/ui/src/ui/tooltip";
import { readFileSync } from "node:fs";

const tokens = readFileSync(new URL("../shell/tokens.css", import.meta.url), "utf8");
const originalMatchMedia = window.matchMedia;
const originalWidth = window.innerWidth;

afterEach(() => {
  cleanup();
  window.matchMedia = originalMatchMedia;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
  document.cookie = "sidebar_state=; path=/; max-age=0";
});

function renderChat(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  window.matchMedia = ((query: string) => ({
    matches: query.includes("max-width") && width <= 768,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;

  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={["/chat"]}>
        <Routes>
          <Route element={<FullLayout defaultSidebarOpen={false} showSidebarTriggerInMenu showHeaderSidebarTrigger={false} />}>
            <Route path="/chat" element={<div data-slot="next-chat-shell"><h1>Chat</h1></div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

const mainNavLabels = ["Home", "Chat", "Library", "Family", "Settings", "Help"];

describe("chat shell layout", () => {
  test("the shipped Thread Element uses the approved 850px message-column token", () => {
    expect(tokens).toMatch(/\.aui-root\.aui-thread-root\s*\{\s*--thread-max-width:\s*53rem\s*!important;/);
  });

  test("the collapsed desktop app rail keeps every main navigation label accessible", async () => {
    const view = renderChat(1440);
    const rail = view.container.querySelector('[data-slot="sidebar"][data-state="collapsed"]');
    expect(rail).not.toBeNull();
    for (const label of mainNavLabels) {
      await waitFor(() => expect(view.getByRole("link", { name: label })).toBeTruthy());
    }
  });

  test("the mobile app navigation remains reachable with all labels", async () => {
    const view = renderChat(390);
    fireEvent.click(view.getByRole("button", { name: /toggle sidebar/i }));
    for (const label of mainNavLabels) {
      await waitFor(() => expect(view.getByRole("link", { name: label })).toBeTruthy());
    }
  });
});
