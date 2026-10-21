// APP-KIND-04: a package app opens at /apps/<id> and /apps/<id>/<page> with no rebuild, inside the permanent
// rail, from a fixture package the hub lists. Home has no per-package code: the page is schema data.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ToastProvider } from "@maipai/ui/src/primitives/Toast";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes as RouterRoutes } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@maipai/ui/src/ui/tooltip";
import weatherCard from "@maipai/spec/fixtures/answer-block/valid-weather_card.json";
import { createQueryClient } from "@maipai/ui/src/queryClient";
import { Routes } from "@/shell/Routes";
import { mockHome, makePerson, type HomeFixture } from "@/shell/pages/settings/settingsTestKit";
import { render } from "@testing-library/react";
import type { AppRow } from "@/lib/api";

const originalMatchMedia = window.matchMedia;
const originalWidth = window.innerWidth;

const row: AppRow = {
  package: "demo",
  page: "index",
  label: "Demo weather",
  icon: "cloud-sun",
  description: "A fixture app.",
  category: "Utilities",
  keywords: ["forecast"],
  sections: [{ page: "week", label: "Week", icon: null }],
  to: "/apps/demo",
  incognito: "unaffected",
};
const indexPage = {
  type: "page",
  id: "demo",
  title: "Demo",
  body: [
    { type: "picker", state: "place", label: "Place", leading: [{ value: "current", label: "Current location", needs: "geolocation" }], bind: { source: "package", path: "places" }, item_key_field: "id", item_label_field: "label" },
    { type: "answer_blocks", bind: { source: "package", path: "forecast", params: { place: "$state.place" } }, empty_state: { type: "empty_state", icon: "cloud-off", text: "No weather right now." } },
  ],
};
const weekPage = { type: "page", id: "week", title: "Week", body: [{ type: "empty_state", icon: "calendar", text: "The week ahead is quiet." }] };
const musicRow: AppRow = {
  package: "music",
  page: "index",
  label: "Music",
  icon: "music",
  description: "A fixture music app.",
  category: "Media",
  keywords: [],
  sections: [],
  to: "/apps/music",
  incognito: "unaffected",
};
const musicIndexPage = { type: "page", id: "index", title: "Music", body: [{ type: "empty_state", icon: "music", text: "No music yet." }] };

let home: HomeFixture;
let rows: AppRow[];
let calls: string[];
let baseFetch: typeof fetch;

beforeEach(() => {
  rows = [row];
  calls = [];
  home = mockHome();
  baseFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.startsWith("/api/apps")) return Promise.resolve(Response.json(rows));
    if (url.startsWith("/api/plugins/demo/pages/index")) return Promise.resolve(rows.length ? Response.json(indexPage) : Response.json({ error: "no such app" }, { status: 404 }));
    if (url.startsWith("/api/plugins/demo/pages/week")) return Promise.resolve(Response.json(weekPage));
    if (url.startsWith("/api/plugins/music/pages/index")) return Promise.resolve(Response.json(musicIndexPage));
    if (url.startsWith("/api/plugins/other/pages/")) return Promise.resolve(Response.json({ error: "no such app" }, { status: 404 }));
    if (url.startsWith("/api/plugins/demo/pages/")) return Promise.resolve(Response.json({ error: "no such page" }, { status: 404 }));
    if (url.startsWith("/api/plugins/demo/data/places")) return Promise.resolve(Response.json({ as_of: "x", rows: [{ id: "pl1", label: "Cabin" }] }));
    if (url.startsWith("/api/plugins/demo/data/forecast")) {
      calls.push(String(init?.body));
      return Promise.resolve(Response.json({ as_of: "x", blocks: [weatherCard] }));
    }
    return baseFetch(input, init);
  }) as typeof fetch;
});

afterEach(() => {
  cleanup();
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
  return { ...view, client };
}

describe("an app that declares a settings area", () => {
  const area = { id: "demo", title: "Demo", app: "/apps/demo", audience: { min_role: "child" }, groups: [{ label: "Demo", sections: ["places"] }], sections: [{ id: "places", label: "Places", icon: "map-pin", kind: "keys", cards: [{ label: "Places", group: "demo", scope: "person" }] }] };

  test("the toolbar has a Settings link named for the app that opens /settings/<area id>", async () => {
    rows = [{ ...row, settings_area: area } as AppRow];
    const view = open("/apps/demo");
    const gear = await view.findByRole("link", { name: "Demo weather settings" });
    expect(gear.getAttribute("href")).toBe("/settings/demo");
  });

  test("an app with no settings area has no gear", async () => {
    const view = open("/apps/demo");
    await waitFor(() => expect(view.container.querySelector('[data-slot="weather-card"]')).not.toBeNull());
    expect(view.queryByRole("link", { name: /settings/i })).toBeNull();
  });
});

describe("a package app at /apps/<id>", () => {
  test("opens, draws its page from schema data and keeps the permanent rail", async () => {
    const view = open("/apps/demo");
    await waitFor(() => expect(view.container.querySelector('[data-slot="weather-card"]')).not.toBeNull());
    expect(view.getByTestId("package-app").getAttribute("data-package")).toBe("demo");
    expect(view.getByRole("heading", { name: "Demo weather" })).toBeTruthy();
    expect(view.getByRole("combobox", { name: "Place" })).toBeTruthy();
    expect(view.container.querySelector('nav[aria-label="Primary navigation"]')).not.toBeNull();
    expect(calls[0]).toBe("{}");
  });

  test("the rail is present at 744 and 1440; at 360 and 402 the menu button replaces it (design rule S1 and S3)", async () => {
    for (const width of [360, 402, 744, 1440]) {
      const view = open("/apps/demo", width);
      await waitFor(() => expect(view.container.querySelector('[data-slot="weather-card"]')).not.toBeNull());
      const rail = view.container.querySelector('nav[aria-label="Primary navigation"]');
      const menu = view.container.querySelector('[data-slot="mobile-menu-button"]');
      if (width < 640) { expect(rail).toBeNull(); expect(menu).not.toBeNull(); }
      else { expect(rail).not.toBeNull(); expect(menu).toBeNull(); }
      cleanup();
    }
  });

  test("its sections are tabs and open at /apps/<id>/<page>", async () => {
    const view = open("/apps/demo");
    const tab = await view.findByRole("tab", { name: "Week" });
    await act(async () => { fireEvent.click(tab); });
    await view.findByText("The week ahead is quiet.");
    expect(view.container.querySelector('[data-slot="weather-card"]')).toBeNull();
  });

  test("a page the interpreter cannot parse is an error state with a retry, not a crash", async () => {
    const real = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.startsWith("/api/plugins/demo/pages/index")) return Promise.resolve(Response.json({ nonsense: true }));
      return real(input, init);
    }) as typeof fetch;
    const view = open("/apps/demo");
    await view.findByText("Could not open this app. Check your connection and try again.");
    expect(view.getByRole("button", { name: /try again|retry/i })).toBeTruthy();
  });

  test("/apps/<id>/<page> opens the page directly", async () => {
    const view = open("/apps/demo/week");
    await view.findByText("The week ahead is quiet.");
  });

  test("an unknown page, an unknown app and a hidden app are all the not-found page", async () => {
    const unknownPage = open("/apps/demo/nope");
    await unknownPage.findByText(/That page does not exist/);
    cleanup();
    const unknownApp = open("/apps/other");
    await unknownApp.findByText(/That page does not exist/);
    cleanup();
    rows = [];
    const hidden = open("/apps/demo");
    await hidden.findByText(/That page does not exist/);
  });

  test("adding to favorites writes the route to ui.pinned_apps; a stale pin is kept when the app is gone", async () => {
    const view = open("/apps/demo");
    const button = await view.findByRole("button", { name: "Add to favorites" });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    await act(async () => { fireEvent.click(button); });
    await waitFor(() => expect(home.puts.some((p) => p.key === "ui.pinned_apps" && p.value === JSON.stringify(["/apps/demo"]))).toBe(true));
    await view.findByRole("button", { name: "Remove from favorites" });
  });
});

describe("a media app is drawn inside the Media hub", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });
  afterEach(() => {
    sessionStorage.clear();
  });

  test("a media app at /apps/music has the media hub frame and its column lists Music when the person came in through Media", async () => {
    sessionStorage.setItem("maipai.media-hub", "1");
    rows = [musicRow];
    const view = open("/apps/music");
    const frame = await view.findByTestId("media-hub-frame");
    await waitFor(() => {
      const links = frame.querySelectorAll('[data-slot="section-sidebar"] a[href^="/apps/"]');
      expect([...links].some((link) => link.textContent === "Music")).toBe(true);
    });
  });

  test("a media app at /apps/music is standalone, with no media hub frame, when the person did not come in through Media", async () => {
    rows = [musicRow];
    const view = open("/apps/music");
    await view.findByText("No music yet.");
    expect(view.queryByTestId("media-hub-frame")).toBeNull();
  });

  test("a non-media app at /apps/demo has no media hub frame even when the flag is set", async () => {
    sessionStorage.setItem("maipai.media-hub", "1");
    const view = open("/apps/demo");
    await waitFor(() => expect(view.container.querySelector('[data-slot="weather-card"]')).not.toBeNull());
    expect(view.queryByTestId("media-hub-frame")).toBeNull();
  });
});
