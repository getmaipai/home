import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import FullLayout from "@maipai/ui/src/dashboard/layouts/full/FullLayout";
import RailProfileMenu from "@maipai/ui/src/dashboard/layouts/full/vertical/rail/RailProfileMenu";
import { TooltipProvider } from "@maipai/ui/src/ui/tooltip";
import { readFileSync } from "node:fs";

const tokens = readFileSync(new URL("../shell/tokens.css", import.meta.url), "utf8");
const originalMatchMedia = window.matchMedia;
const originalWidth = window.innerWidth;

afterEach(() => {
  cleanup();
  window.matchMedia = originalMatchMedia;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
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
          <Route element={<FullLayout rail railProfile={<RailProfileMenu displayName="Sage" subtitle="Owner" settingsHref="/settings" helpHref="https://example.com/help" onLogout={() => {}} />} />}>
            <Route path="/chat" element={<div data-slot="next-chat-shell"><h1>Chat</h1></div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

const railLabels = ["MaiPai Home", "Home", "Chat", "Library", "Family"];

// Design rule S3 (docs/design/RULES.md): the main navigation renders on an
// app page at desktop and mobile widths, as the permanent icon rail with
// accessible labels (S1, owner-approved 2026-10-06). Settings and Help
// moved from the rail's foot into the profile menu at its bottom.
describe("chat shell layout", () => {
  test("the shipped Thread Element uses the approved 832px message-column token", () => {
    expect(tokens).toMatch(/\.aui-root\.aui-thread-root\s*\{\s*--thread-max-width:\s*52rem\s*!important;/);
  });

  for (const width of [1440, 390]) {
    test(`the app rail renders at ${width}px with every destination's accessible name`, async () => {
      const view = renderChat(width);
      const rail = view.getByRole("navigation", { name: "Primary navigation" });
      expect(rail.className).toContain("w-14");
      expect(rail.className).toContain("max-w-14");
      for (const label of railLabels) {
        await waitFor(() => expect(view.getByRole("link", { name: label })).toBeTruthy());
      }
      expect(view.getByRole("link", { name: "Chat" }).getAttribute("aria-current")).toBe("page");
      expect(view.getByRole("button", { name: "Search" })).toBeTruthy();
      expect(view.getByRole("button", { name: /Open profile menu for Sage/ })).toBeTruthy();
    });
  }

  test("the rail never expands: it has no sidebar trigger", () => {
    const view = renderChat(1440);
    expect(view.queryByRole("button", { name: /toggle (app menu|sidebar)/i })).toBeNull();
  });

  test("Settings, Help and Log out are reachable from the profile menu at the rail's foot", async () => {
    const view = renderChat(1440);
    fireEvent.click(view.getByRole("button", { name: /Open profile menu for Sage/ }));
    await waitFor(() => expect(view.getByRole("menuitem", { name: /Settings/ })).toBeTruthy());
    expect(view.getByRole("menuitem", { name: /Help/ })).toBeTruthy();
    expect(view.getByRole("menuitem", { name: /Log out/ })).toBeTruthy();
  });

  test("a page that places no header content gets no global header", () => {
    const view = renderChat(1440);
    expect(view.container.querySelector("header")).toBeNull();
  });
});
