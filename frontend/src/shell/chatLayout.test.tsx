import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
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
    matches: query.includes("639.98") ? width < 640 : query.includes("max-width") && width <= 768,
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
          <Route element={<FullLayout rail railCoreDestinations={[{ name: "Media", url: "/media", icon: "film" }]} railProfile={<RailProfileMenu displayName="Sage" subtitle="Owner" settingsHref="/settings" helpHref="https://example.com/help" onLogout={() => {}} />} />}>
            <Route path="/chat" element={<div data-slot="chat-shell"><h1>Chat</h1></div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

// The brand mark is the Home destination (owner, 2026-10-06), so "Home"
// is one link at the top of the rail, not a logo plus a second Home icon.
const railLabels = ["Home", "Chat", "Media", "Library", "Family"];

// Design rule S3 (docs/design/RULES.md): the main navigation renders on an
// app page at desktop and mobile widths, as the permanent icon rail with
// accessible labels (S1, owner-approved 2026-10-06). Settings and Help
// moved from the rail's foot into the profile menu at its bottom.
describe("chat shell layout", () => {
  test("the shipped Thread Element uses the approved 832px message-column token", () => {
    expect(tokens).toMatch(/\.aui-root\.aui-thread-root\s*\{\s*--thread-max-width:\s*52rem\s*!important;/);
  });

  test("the app rail renders at 1440px with every destination's accessible name", async () => {
    const view = renderChat(1440);
    const rail = view.getByRole("navigation", { name: "Primary navigation" });
    // The rail is 56px at Standard targets and widens through --rail-width at Large (ui-v0.5.200).
    expect(rail.className).toContain("w-[var(--rail-width,56px)]");
    expect(rail.className).toContain("max-w-[var(--rail-width,56px)]");
    for (const label of railLabels) {
      await waitFor(() => expect(view.getByRole("link", { name: label })).toBeTruthy());
    }
    expect(view.getByRole("link", { name: "Chat" }).getAttribute("aria-current")).toBe("page");
    expect(view.getAllByRole("link", { name: "Home" })).toHaveLength(1);
    expect(view.getByRole("button", { name: "Search" })).toBeTruthy();
    expect(view.getByRole("button", { name: /Open profile menu for Sage/ })).toBeTruthy();
  });

  test("at 390px there is no rail: the menu button opens a drawer with every destination (design rule S1)", async () => {
    const view = renderChat(390);
    expect(view.queryByRole("navigation", { name: "Primary navigation" })).toBeNull();
    fireEvent.click(await view.findByRole("button", { name: "Open menu" }));
    const drawer = await view.findByRole("dialog");
    for (const label of railLabels) {
      await waitFor(() => expect(within(drawer).getByRole("link", { name: label })).toBeTruthy());
    }
    expect(within(drawer).getByRole("button", { name: /Open profile menu for Sage/ })).toBeTruthy();
  });

  test("the rail never expands: it has no sidebar trigger", () => {
    const view = renderChat(1440);
    expect(view.queryByRole("button", { name: /toggle (app menu|sidebar)/i })).toBeNull();
  });

  test("Media is a fixed core destination immediately after Chat", async () => {
    const view = renderChat(1440);
    const rail = view.getByRole("navigation", { name: "Primary navigation" });
    await waitFor(() => expect(view.getByRole("link", { name: "Media" }).getAttribute("href")).toBe("/media"));
    const labels = [...rail.querySelectorAll("a")].map((link) => link.getAttribute("aria-label"));
    expect(labels.indexOf("Media")).toBe(labels.indexOf("Chat") + 1);
    expect(view.getByRole("link", { name: "Media" }).getAttribute("data-slot")).toBe("app-rail-core-destination");
  });

  test("Media is a fixed core destination in the phone drawer immediately after Chat", async () => {
    const view = renderChat(390);
    fireEvent.click(await view.findByRole("button", { name: "Open menu" }));
    const drawer = await view.findByRole("dialog");
    const media = await within(drawer).findByRole("link", { name: "Media" });
    expect(media.getAttribute("href")).toBe("/media");
    expect(media.getAttribute("data-slot")).toBe("app-rail-core-destination");
    const labels = [...drawer.querySelectorAll("a")].map((link) => link.getAttribute("aria-label"));
    expect(labels.indexOf("Media")).toBe(labels.indexOf("Chat") + 1);
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
