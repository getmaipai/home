// NEWS-SIDEBAR-01: an app that declares a sidebar gets the kit's section column from wide screens up: its entries, its rows from the
// package's own data route, its search, and no section tabs beside it. A phone keeps the tabs and the shell's drawer.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ToastProvider } from "@maipai/ui/src/primitives/Toast";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes as RouterRoutes } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@maipai/ui/src/ui/tooltip";
import { createQueryClient } from "@maipai/ui/src/queryClient";
import { Routes } from "@/shell/Routes";
import { mockHome, makePerson, type HomeFixture } from "@/shell/pages/settings/settingsTestKit";
import type { AppRow } from "@/lib/api";

const originalMatchMedia = window.matchMedia;
const originalWidth = window.innerWidth;

const sidebar = {
  search: { type: "search", state: "q", label: "Search Demo", placeholder: "Search Demo", recents: { source: "package", path: "recents" }, submit: { navigate: { to: "/apps/demo/search", state: { q: "{q}" } } } },
  groups: [
    { id: "library", pages: [{ page: "index", label: "Today", icon: "newspaper" }, { page: "saved", label: "Saved", icon: "bookmark" }] },
    { id: "topics", title: "Topics", rows: { bind: { source: "package", path: "topics" }, item_key_field: "key", item_label_field: "label", item_media_field: "icon", open: { navigate: { to: "/apps/demo/channel", state: { kind: "topic", key: "{key}" } } } } },
    { id: "following", title: "Following", rows: { bind: { source: "package", path: "sources" }, item_media_field: "icon", only_followed: true, open: { navigate: { to: "/apps/demo/channel", state: { kind: "source", key: "{key}" } } }, manage: { label: "Manage", open: { navigate: { to: "/apps/demo/following" } } } } },
  ],
};
const row: AppRow = { package: "demo", page: "index", label: "Demo news", icon: "newspaper", description: "A fixture app.", category: "Info", keywords: [], sections: [{ page: "saved", label: "Saved", icon: null }], sidebar, to: "/apps/demo", incognito: "unaffected" } as AppRow;
const empty = (id: string, text: string) => ({ type: "page", id, title: id, body: [{ type: "empty_state", icon: "newspaper", text }] });
const pages: Record<string, unknown> = {
  index: empty("index", "Today's stories"),
  saved: empty("saved", "Saved stories"),
  channel: empty("channel", "A channel"),
  following: empty("following", "Manage following"),
  search: empty("search", "Search results"),
};

let home: HomeFixture;
let rows: AppRow[];
let baseFetch: typeof fetch;

beforeEach(() => {
  rows = [row];
  home = mockHome();
  baseFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.startsWith("/api/apps")) return Promise.resolve(Response.json(rows));
    const page = /^\/api\/plugins\/demo\/pages\/([a-z-]+)/.exec(url)?.[1];
    if (page) return Promise.resolve(pages[page] ? Response.json(pages[page]) : Response.json({ error: "no such page" }, { status: 404 }));
    if (url.startsWith("/api/plugins/demo/data/topics")) return Promise.resolve(Response.json([{ key: "world", label: "World", icon: "globe", followed: true }, { key: "science", label: "Science", icon: "flask-conical", followed: false }]));
    if (url.startsWith("/api/plugins/demo/data/sources")) return Promise.resolve(Response.json([{ key: "feed-bbc", label: "BBC", icon: "newspaper", followed: true }, { key: "feed-npr", label: "NPR", icon: "newspaper", followed: false }]));
    if (url.startsWith("/api/plugins/demo/data/recents")) return Promise.resolve(Response.json([{ key: "r1", label: "oil prices" }]));
    return baseFetch(input, init);
  }) as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = baseFetch;
  home.restore();
  window.matchMedia = originalMatchMedia;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
});

function open(path: string, width = 1440) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  window.matchMedia = ((query: string) => ({
    matches: query.includes("639.98") ? width < 640 : query.includes("max-width") && width <= 768,
    media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  const client = createQueryClient();
  const view = render(
    <QueryClientProvider client={client}>
      <ToastProvider><TooltipProvider>
        <MemoryRouter initialEntries={[path]}>
          <RouterRoutes><Route path="/*" element={<Routes person={makePerson("owner")} onSignedIn={() => {}} />} /></RouterRoutes>
        </MemoryRouter>
      </TooltipProvider></ToastProvider>
    </QueryClientProvider>,
  );
  return view;
}
const COLUMN = '[data-slot="section-sidebar"]';
/** The column, once the app and its page have loaded. */
async function column(view: ReturnType<typeof open>) {
  await waitFor(() => expect(view.container.querySelector(COLUMN)).not.toBeNull());
  return within(view.container.querySelector(COLUMN) as HTMLElement);
}

describe("an app that declares a sidebar", () => {
  test("draws its entries, every topic row from the data route, only the followed sources, and Manage", async () => {
    const view = open("/apps/demo");
    await view.findByText("Today's stories");
    const side = await column(view);
    expect(side.getByRole("link", { name: "Today" }).getAttribute("aria-current")).toBe("page");
    expect(side.getByRole("link", { name: "Saved" }).getAttribute("href")).toBe("/apps/demo/saved");
    await waitFor(() => expect(side.queryByRole("link", { name: "World" })).not.toBeNull());
    expect(side.getByRole("link", { name: "Science" })).toBeTruthy();
    expect(side.getByRole("link", { name: "BBC" })).toBeTruthy();
    expect(side.queryByRole("link", { name: "NPR" })).toBeNull();
    expect(side.getByRole("link", { name: "Manage" })).toBeTruthy();
    expect(side.getByText("Topics")).toBeTruthy();
    expect(side.getByText("Following")).toBeTruthy();
  });

  test("NEWS-INSTANT-01: rows the app list carries draw the column with no wait on the data route", async () => {
    const withInitial = { ...sidebar, groups: sidebar.groups.map((group) => group.id === "topics" ? { ...group, rows: { ...group.rows, initial: [{ key: "world", label: "World", icon: "globe" }, { key: "science", label: "Science", icon: "flask-conical" }] } } : group) };
    rows = [{ ...row, sidebar: withInitial } as AppRow];
    const slow = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => (String(input).startsWith("/api/plugins/demo/data/topics") ? new Promise<Response>(() => {}) : slow(input, init))) as typeof fetch;
    const view = open("/apps/demo");
    const side = await column(view);
    await waitFor(() => expect(side.queryByRole("link", { name: "World" })).not.toBeNull());
    expect(side.getByRole("link", { name: "Science" })).toBeTruthy();
  });

  test("COLUMN-UNIFY-01 (2026-10-29): the app's name and settings sit in the header row, not in the column, and the page keeps none from wide screens up", async () => {
    rows = [{ ...row, settings_area: { id: "demo", title: "Demo news", app: "/apps/demo" } } as AppRow];
    const view = open("/apps/demo");
    await view.findByText("Today's stories");
    const side = await column(view);
    // No title in the column: the header row names the app (owner, 2026-10-29).
    expect(side.queryByRole("heading", { level: 2, name: "Demo news" })).toBeNull();
    // Settings sit in the header row beside the companion, never a second time in the column (owner, 2026-10-29).
    expect(side.queryByRole("link", { name: "Demo news settings" })).toBeNull();
    expect(side.queryByRole("button", { name: /favorites/ })).toBeNull();
    const headerRow = document.querySelector('[data-slot="rail-page-header"]');
    // The header row says the app (icon and name), never the page inside it (owner, 2026-10-29).
    expect(headerRow?.querySelector('h1')?.textContent).toBe("Demo news");
    expect(headerRow?.querySelector("h1")?.parentElement?.querySelector("svg")).not.toBeNull();
    expect(view.getByRole("button", { name: "Demo news settings" }).closest('[data-slot="rail-page-header"]')).toBe(headerRow);
  });

  test("choosing a topic opens its page with the row's key as state and marks it current", async () => {
    const view = open("/apps/demo");
    const world = await (await column(view)).findByRole("link", { name: "World" });
    await act(async () => { fireEvent.click(world); });
    await view.findByText("A channel");
    const side = await column(view);
    await waitFor(() => expect(side.getByRole("link", { name: "World" }).getAttribute("aria-current")).toBe("page"));
    expect(side.getByRole("link", { name: "Science" }).getAttribute("aria-current")).toBeNull();
  });

  test("Manage opens the management page", async () => {
    const view = open("/apps/demo");
    const manage = await (await column(view)).findByRole("link", { name: "Manage" });
    await act(async () => { fireEvent.click(manage); });
    await view.findByText("Manage following");
  });

  test("typing in the search and pressing Enter opens the search page", async () => {
    const view = open("/apps/demo");
    await view.findByText("Today's stories");
    fireEvent.click((await column(view)).getByRole("button", { name: "Search Demo" }));
    const box = (await column(view)).getByRole("searchbox", { name: "Search Demo" });
    fireEvent.change(box, { target: { value: "eclipse" } });
    await act(async () => { fireEvent.keyDown(box, { key: "Enter" }); });
    await view.findByText("Search results");
  });

  test("on the page the search opens, the column's own search box gives way to the page's", async () => {
    const view = open("/apps/demo/search");
    await view.findByText("Search results");
    const side = await column(view);
    await waitFor(() => expect(side.queryByRole("link", { name: "Today" })).not.toBeNull());
    expect(side.queryByRole("searchbox")).toBeNull();
  });

  test("the section tabs give way to the column from wide screens up, and a phone shows them in the bottom bar", async () => {
    const view = open("/apps/demo");
    await view.findByText("Today's stories");
    const tabs = view.container.querySelector('[data-slot="app-section-tabs"]') as HTMLElement;
    expect(tabs.className).toContain("lg:hidden");
    const provider = view.container.querySelector('[data-slot="section-sidebar"]') as HTMLElement;
    expect(provider.className).toContain("hidden");
    expect(provider.className).toMatch(/lg:(flex|block)/); // the kit column is a block that holds its own sticky flex box
    cleanup();
    const phone = open("/apps/demo", 402);
    await phone.findByText("Today's stories");
    // A phone shows the sections in the floating bottom bar, not as a row of pills (phone-minimal-2026-10-25 P2).
    expect(phone.container.querySelector('nav[aria-label$="sections"]')).not.toBeNull();
    expect(phone.container.querySelector('[data-slot="app-section-tabs"]')).toBeNull();
  });

  test("an app with no sidebar draws no column and keeps its tabs as they were", async () => {
    rows = [{ ...row, sidebar: undefined } as AppRow];
    const view = open("/apps/demo");
    await view.findByText("Today's stories");
    expect(view.container.querySelector('[data-slot="section-sidebar"]')).toBeNull();
    expect(view.container.querySelector('[data-testid="package-app-frame"]')).toBeNull();
    expect(view.getByRole("tab", { name: "Saved" })).toBeTruthy();
  });
});
