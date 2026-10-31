// APPS-DIRECTORY-01: the All apps page is the one place that lists every app. These hold what it promises with dozens of
// apps: a focused search that filters as you type, Favorites first, a star that saves the same list the rail draws,
// the rail's limit, and the built-in apps that open but never get a star.
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

const categories = ["Everyday", "Media", "Utilities", "Games"];
const fakeApps = (n: number): AppRow[] => Array.from({ length: n }, (_, i) => ({
  package: `app${i}`, page: "index", label: `App ${String(i).padStart(2, "0")}`, icon: "layout-grid", description: `Does thing ${i}.`, category: categories[i % 4]!,
  keywords: i === 7 ? ["forecast"] : [], sections: [], to: `/apps/app${i}`, incognito: "unaffected", ...(i === 0 ? { pinned_by_default: true, pin_order: 10 } : {}),
}));

let home: HomeFixture;
let rows: AppRow[];
let baseFetch: typeof fetch;
let views: Array<ReturnType<typeof render>> = [];

function start(pinnedApps?: string[]) {
  baseFetch = globalThis.fetch;
  home = mockHome({ pinnedApps });
  const fixtureFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.startsWith("/api/apps")) return Promise.resolve(Response.json(rows));
    if (url.startsWith("/api/memory")) return Promise.resolve(Response.json([]));
    if (url.startsWith("/api/settings")) return fixtureFetch(input, init);
    if (url.startsWith("/api/")) return Promise.resolve(Response.json({}));
    return fixtureFetch(input, init);
  }) as typeof fetch;
}

function open(path = "/all-apps") {
  const view = render(
    <QueryClientProvider client={createQueryClient()}>
      <ToastProvider><TooltipProvider>
        <MemoryRouter initialEntries={[path]}>
          <RouterRoutes><Route path="/*" element={<Routes person={makePerson("owner")} onSignedIn={() => {}} />} /></RouterRoutes>
        </MemoryRouter>
      </TooltipProvider></ToastProvider>
    </QueryClientProvider>,
  );
  views.push(view);
  return view;
}
const page = (view: ReturnType<typeof open>) => within(view.container.querySelector('[data-slot="app-directory"]') as HTMLElement);

beforeEach(() => { rows = fakeApps(60); });
afterEach(() => {
  for (const view of views) view.unmount();
  views = [];
  cleanup();
  globalThis.fetch = baseFetch;
  home.restore();
});

describe("the All apps page with 60 apps", () => {
  test("the page's one visible title is the header's icon and name; the directory's own heading is for screen readers only", async () => {
    start();
    const view = open("/all-apps");
    await view.findByRole("searchbox", { name: "Search apps" });
    const header = view.container.querySelector('[data-slot="rail-page-header"]') as HTMLElement;
    expect(within(header).getByText("All apps")).toBeTruthy();
    expect(header.querySelector("svg")).not.toBeNull();
    const heading = page(view).getByRole("heading", { level: 1, name: "All apps" });
    expect(heading.className).toContain("sr-only");
  });

  test("the rail's grid button opens it, and it lists every app with the search box focused", async () => {
    start();
    const view = open("/");
    fireEvent.click(await view.findByRole("link", { name: "All apps" }));
    const search = await view.findByRole("searchbox", { name: "Search apps" });
    expect(document.activeElement).toBe(search);
    await waitFor(() => expect(view.container.querySelectorAll("[data-app-tile]").length).toBe(69));
    expect(view.getByRole("heading", { name: "All apps" })).toBeTruthy();
  });

  test("Favorites come first (Weather-style default pin), then categories, then the built-in apps", async () => {
    start();
    const view = open();
    await view.findByRole("heading", { name: /^Favorites/ });
    const headings = [...view.container.querySelectorAll('[data-slot="app-directory"] h2')].map((h) => h.textContent?.replace(/\s+/g, " ").trim());
    expect(headings[0]).toBe("Favorites 3 of 6 in the left rail");
    expect(headings.slice(1)).toEqual(["Everyday", "Games", "Media", "Utilities", "Built in"]);
    expect(page(view).getByRole("button", { name: "Remove App 00 from favorites" })).toBeTruthy();
  });

  test("typing filters as you type and an empty result says so", async () => {
    start();
    const view = open();
    const search = await view.findByRole("searchbox", { name: "Search apps" });
    await waitFor(() => expect(view.container.querySelectorAll("[data-app-tile]").length).toBe(69));
    fireEvent.change(search, { target: { value: "app 07" } });
    expect(view.container.querySelectorAll("[data-app-tile]").length).toBe(1);
    fireEvent.change(search, { target: { value: "forecast" } });
    expect(page(view).getByRole("link", { name: /App 07/ })).toBeTruthy();
    fireEvent.change(search, { target: { value: "no such app" } });
    expect(view.getByText(/No apps match "no such app"/)).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Clear search" }));
    await waitFor(() => expect(view.container.querySelectorAll("[data-app-tile]").length).toBe(69));
  });

  test("a star saves the same list the rail draws, in order, and removing one saves it without that app", async () => {
    start();
    const view = open();
    await act(async () => { fireEvent.click(await view.findByRole("button", { name: "Add App 05 to favorites" })); });
    await waitFor(() => expect(home.puts.at(-1)).toMatchObject({ key: "ui.pinned_apps", value: JSON.stringify(["/reminders", "/clock", "/apps/app0", "/apps/app5"]) }));
    await act(async () => { fireEvent.click(await view.findByRole("button", { name: "Remove App 00 from favorites" })); });
    await waitFor(() => expect(home.puts.at(-1)).toMatchObject({ value: JSON.stringify(["/reminders", "/clock", "/apps/app5"]) }));
  });

  test("with six favorites the rest hold their star with the reason, and removing one frees it", async () => {
    start(["/apps/app0", "/apps/app1", "/apps/app2", "/apps/app3", "/apps/app4", "/apps/app5"]);
    const view = open();
    const held = (await view.findByRole("button", { name: /Add App 06 to favorites \(the rail is full, remove one first\)/ })) as HTMLButtonElement;
    expect(held.disabled).toBe(true);
    await act(async () => { fireEvent.click(view.getByRole("button", { name: "Remove App 01 from favorites" })); });
    await waitFor(() => expect((view.getByRole("button", { name: "Add App 06 to favorites" }) as HTMLButtonElement).disabled).toBe(false));
  });

  test("the built-in apps open from the page and carry no star", async () => {
    start();
    const view = open();
    await view.findByRole("searchbox", { name: "Search apps" });
    const chat = await page(view).findByRole("link", { name: /^Chat/ });
    expect(chat.getAttribute("href")).toBe("/chat");
    expect(view.queryByRole("button", { name: /Chat.*favorites/ })).toBeNull();
  });
});
