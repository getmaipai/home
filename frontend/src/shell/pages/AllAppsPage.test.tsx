// PRO-LOOK-APPS-01: the launcher presents and edits the existing pin setting.
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

beforeEach(() => { rows = fakeApps(60); });
afterEach(() => {
  for (const view of views) view.unmount();
  views = [];
  cleanup();
  globalThis.fetch = baseFetch;
  home.restore();
});

describe("PRO-LOOK-APPS-01 All apps launcher", () => {
  test("shows the search, category strip, favorites shelf, alphabetical tile grid, and app title", async () => {
    start();
    const view = open();
    expect(await view.findByRole("searchbox", { name: "Search apps" })).toBeTruthy();
    expect(view.getByRole("navigation", { name: "App categories" })).toBeTruthy();
    expect(view.getByRole("heading", { name: "Favorites" })).toBeTruthy();
    expect(view.getAllByRole("heading", { name: "All apps" }).length).toBe(2);
    await waitFor(() => expect(view.container.querySelectorAll('[data-layout="grid"]').length).toBe(2));
    expect(view.getAllByRole("button", { name: "Remove App 00 from favorites" }).length).toBeGreaterThan(0);
  });

  test("search and category chips filter the A to Z grid", async () => {
    start();
    const view = open();
    const search = await view.findByRole("searchbox", { name: "Search apps" });
    fireEvent.change(search, { target: { value: "forecast" } });
    await waitFor(() => expect(view.getByText("App 07")).toBeTruthy());
    expect(view.queryByText("App 06")).toBeNull();
    fireEvent.change(search, { target: { value: "" } });
    fireEvent.click(within(view.getByRole("navigation", { name: "App categories" })).getByRole("button", { name: "Games" }));
    await waitFor(() => expect(view.getByText("App 03")).toBeTruthy());
    expect(view.queryByText("App 01")).toBeNull();
  });

  test("star actions update the same pin list without opening the app", async () => {
    start();
    const view = open();
    const add = await view.findByRole("button", { name: "Add App 05 to favorites" });
    await act(async () => { fireEvent.click(add); });
    await waitFor(() => expect(home.puts.at(-1)).toMatchObject({ key: "ui.pinned_apps", value: JSON.stringify(["/reminders", "/clock", "/activity", "/apps/app0", "/apps/app5"]) }));
    expect(view.queryByRole("heading", { name: "App 05" })).toBeNull();
  });

  test("Edit moves a favorite in the existing ordered setting", async () => {
    start(["/apps/app0", "/apps/app1"]);
    const view = open();
    fireEvent.click(await view.findByRole("button", { name: "Edit" }));
    const moveUp = within(view.getByRole("list", { name: "Favorite apps" })).getByRole("button", { name: "Move App 01 up" });
    await act(async () => { fireEvent.click(moveUp); });
    await waitFor(() => expect(home.puts.at(-1)).toMatchObject({ key: "ui.pinned_apps", value: JSON.stringify(["/apps/app1", "/apps/app0"]) }));
  });

  test("the launcher lets a seventh app be pinned and does not add a Recents section", async () => {
    start(["/apps/app0", "/apps/app1", "/apps/app2", "/apps/app3", "/apps/app4", "/apps/app5"]);
    const view = open();
    const star = await view.findByRole("button", { name: "Add App 06 to favorites" });
    expect((star as HTMLButtonElement).disabled).toBe(false);
    await act(async () => { fireEvent.click(star); });
    await waitFor(() => expect(home.puts.at(-1)).toMatchObject({ value: JSON.stringify(["/apps/app0", "/apps/app1", "/apps/app2", "/apps/app3", "/apps/app4", "/apps/app5", "/apps/app6"]) }));
    expect(view.queryByRole("heading", { name: "Recents" })).toBeNull();
  });
});
