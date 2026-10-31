// LEFTNAV-APPS-01: package apps in the left rail. The hub's list (role, age band, surface and Incognito already
// applied) feeds a pinned section and an "All apps" page; Weather's manifest pins it by default; a person's own
// saved pins always win.
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

const base: AppRow = { package: "weather", page: "index", label: "Weather", icon: "cloud-sun", description: "Forecasts.", category: "Utilities", keywords: [], sections: [], to: "/apps/weather", incognito: "unaffected", pinned_by_default: true, pin_order: 10 };
const notes: AppRow = { ...base, package: "notes", label: "Notes", icon: "calendar", to: "/apps/notes", pinned_by_default: undefined, pin_order: undefined };

const originalMatchMedia = window.matchMedia;
const originalWidth = window.innerWidth;
let home: HomeFixture;
let rows: AppRow[];
let baseFetch: typeof fetch;

function start(pinnedApps?: string[]) {
  home = mockHome({ pinnedApps });
  baseFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.startsWith("/api/apps")) return Promise.resolve(Response.json(rows));
    if (url.endsWith("/api/lists")) return Promise.resolve(Response.json([]));
    if (url.endsWith("/api/coming-up")) return Promise.resolve(Response.json([]));
    if (url.endsWith("/api/alarms")) return Promise.resolve(Response.json([]));
    return baseFetch(input, init);
  }) as typeof fetch;
}

function open(path = "/", width = 1440) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  window.matchMedia = ((query: string) => ({ matches: query.includes("639.98") ? width < 640 : query.includes("max-width") && width <= 768, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as typeof window.matchMedia;
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <ToastProvider><TooltipProvider>
        <MemoryRouter initialEntries={[path]}>
          <RouterRoutes><Route path="/*" element={<Routes person={makePerson("owner")} onSignedIn={() => {}} />} /></RouterRoutes>
        </MemoryRouter>
      </TooltipProvider></ToastProvider>
    </QueryClientProvider>,
  );
}
const rail = (view: ReturnType<typeof open>) => within(view.container.querySelector('nav[aria-label="Primary navigation"]') as HTMLElement);

beforeEach(() => { rows = [base, notes]; });
afterEach(() => {
  cleanup();
  globalThis.fetch = baseFetch;
  home.restore();
  window.matchMedia = originalMatchMedia;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
});

describe("the rail's apps", () => {
  test("Weather is in the rail on first load with no pins saved, and Notes is only on the All apps page", async () => {
    start();
    const view = open();
    const link = await rail(view).findByRole("link", { name: "Weather" });
    expect(link.getAttribute("href")).toBe("/apps/weather");
    expect(rail(view).queryByRole("link", { name: "Notes" })).toBeNull();
    fireEvent.click(rail(view).getByRole("link", { name: "All apps" }));
    expect(await view.findByRole("link", { name: /^Notes/ })).toBeTruthy();
    expect(view.getByRole("button", { name: "Remove Weather from favorites" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Add Notes to favorites" })).toBeTruthy();
    expect(home.puts.some((put) => put.key === "ui.pinned_apps")).toBe(false);
  });

  test("the open app is marked", async () => {
    start();
    const view = open("/apps/weather");
    const link = await rail(view).findByRole("link", { name: "Weather" });
    expect(link.getAttribute("aria-current")).toBe("page");
  });

  test("a person's own saved pins win: Weather stays out when they pinned only Notes, and an empty list pins nothing", async () => {
    start(["/apps/notes"]);
    const view = open();
    await rail(view).findByRole("link", { name: "Notes" });
    expect(rail(view).queryByRole("link", { name: "Weather" })).toBeNull();
    cleanup(); globalThis.fetch = baseFetch; home.restore();
    start([]);
    const empty = open();
    await rail(empty).findByRole("link", { name: "All apps" });
    expect(rail(empty).queryByRole("link", { name: "Weather" })).toBeNull();
  });

  test("a star on the All apps page saves the whole list after the defaults; unpinning saves it without that app", async () => {
    start();
    const view = open();
    await rail(view).findByRole("link", { name: "Weather" });
    fireEvent.click(rail(view).getByRole("link", { name: "All apps" }));
    await act(async () => { fireEvent.click(await view.findByRole("button", { name: "Add Notes to favorites" })); });
    await waitFor(() => expect(home.puts.at(-1)).toMatchObject({ key: "ui.pinned_apps", value: JSON.stringify(["/reminders", "/clock", "/apps/weather", "/apps/notes"]) }));
    await rail(view).findByRole("link", { name: "Notes" });
    await act(async () => { fireEvent.click(await view.findByRole("button", { name: "Remove Weather from favorites" })); });
    await waitFor(() => expect(home.puts.at(-1)).toMatchObject({ value: JSON.stringify(["/reminders", "/clock", "/apps/notes"]) }));
    await waitFor(() => expect(rail(view).queryByRole("link", { name: "Weather" })).toBeNull());
  });

  test("an app the hub does not list (role, age band or Incognito) is nowhere in the rail or on the All apps page", async () => {
    rows = [notes];
    start();
    const view = open();
    await rail(view).findByRole("link", { name: "All apps" });
    expect(rail(view).queryByRole("link", { name: "Weather" })).toBeNull();
    fireEvent.click(rail(view).getByRole("link", { name: "All apps" }));
    await view.findByRole("link", { name: /^Notes/ });
    expect(view.queryByRole("link", { name: /^Weather/ })).toBeNull();
  });

  test("with no package apps the rail still has Reminders and Clock starred, an All apps entry, and Wikipedia left for the person to star", async () => {
    rows = [];
    start();
    const view = open();
    await waitFor(() => expect(rail(view).getByRole("link", { name: "Chat" })).toBeTruthy());
    expect(rail(view).getByRole("link", { name: "All apps" })).toBeTruthy();
    expect(rail(view).getByRole("link", { name: "Reminders" })).toBeTruthy();
    expect(rail(view).getByRole("link", { name: "Clock" })).toBeTruthy();
    expect(rail(view).queryByRole("link", { name: "Wikipedia" })).toBeNull();
  });

  test("at 744 the rail still shows the pinned app and the All apps link", async () => {
    start();
    const view = open("/", 744);
    await rail(view).findByRole("link", { name: "Weather" });
    expect(rail(view).getByRole("link", { name: "All apps" })).toBeTruthy();
  });

  test("at 390 there is no rail: the menu button opens a drawer listing the installed app", async () => {
    start();
    const view = open("/", 390);
    expect(view.queryByRole("navigation", { name: "Primary navigation" })).toBeNull();
    await act(async () => { fireEvent.click(await view.findByRole("button", { name: "Open menu" })); });
    const drawer = await view.findByRole("dialog");
    await within(drawer).findByRole("link", { name: "Weather" });
  });

  test.each(["/clock", "/reminders"]) ("core navigation is present at every S3 width on %s", async (path) => {
    start();
    for (const width of [360, 402, 874, 744, 1440]) {
      const view = open(path, width);
      if (width >= 640) {
        expect(await rail(view).findByRole("link", { name: "Reminders" })).toBeTruthy();
        expect(rail(view).getByRole("link", { name: "Clock" })).toBeTruthy();
      } else {
        expect(view.queryByRole("navigation", { name: "Primary navigation" })).toBeNull();
        await act(async () => { fireEvent.click(await view.findByRole("button", { name: "Open menu" })); });
        const drawer = await view.findByRole("dialog");
        expect(within(drawer).getByRole("link", { name: "Reminders" })).toBeTruthy();
        expect(within(drawer).getByRole("link", { name: "Clock" })).toBeTruthy();
      }
      cleanup();
    }
  });
});
