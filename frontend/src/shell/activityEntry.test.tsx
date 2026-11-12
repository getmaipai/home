// ACTIVITY-PAGE-01 (PRO-LOOK-01 section 25): the Activity entry in the rail and its quiet dot; a guest has neither the entry nor the page.
import { afterEach, describe, expect, test } from "bun:test";
import { ToastProvider } from "@maipai/ui/src/primitives/Toast";
import { cleanup, render, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes as RouterRoutes } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@maipai/ui/src/ui/tooltip";
import { createQueryClient } from "@maipai/ui/src/queryClient";
import { Routes } from "@/shell/Routes";
import { mockHome, makePerson, type HomeFixture } from "@/shell/pages/settings/settingsTestKit";
import type { ActivityDotState } from "@/lib/api";

const originalMatchMedia = window.matchMedia;
let home: HomeFixture;
let baseFetch: typeof fetch;

function start(dot: ActivityDotState) {
  home = mockHome({ pinnedApps: ["/activity"] });
  baseFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/settings?scope=")) {
      return baseFetch(input, init).then(async (response) => {
        const settings = await response.json() as Array<Record<string, unknown>>;
        return Response.json(settings.map((entry) => entry.key === "ui.rail_expanded" ? { ...entry, value: true, source: "user" } : entry));
      });
    }
    if (url.startsWith("/api/apps")) return Promise.resolve(Response.json([]));
    if (url.endsWith("/api/jobs")) return Promise.resolve(Response.json([]));
    if (url.endsWith("/api/activity")) return Promise.resolve(Response.json({ items: [], seenAt: null, dot }));
    if (url.endsWith("/api/activity/seen")) return Promise.resolve(Response.json({ seenAt: new Date().toISOString() }));
    if (url.endsWith("/api/lists") || url.endsWith("/api/coming-up") || url.endsWith("/api/alarms")) return Promise.resolve(Response.json([]));
    return baseFetch(input, init);
  }) as typeof fetch;
}

function open(role: "owner" | "child" | "guest", path = "/") {
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as typeof window.matchMedia;
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <ToastProvider><TooltipProvider>
        <MemoryRouter initialEntries={[path]}>
          <RouterRoutes><Route path="/*" element={<Routes person={makePerson(role)} onSignedIn={() => {}} />} /></RouterRoutes>
        </MemoryRouter>
      </TooltipProvider></ToastProvider>
    </QueryClientProvider>,
  );
}
const rail = (view: ReturnType<typeof open>) => within(view.container.querySelector('nav[aria-label="Primary navigation"]') as HTMLElement);

afterEach(() => {
  cleanup();
  globalThis.fetch = baseFetch;
  home.restore();
  window.matchMedia = originalMatchMedia;
});

describe("the Activity entry", () => {
  test("is in the rail, with no mark when nothing is going on", async () => {
    start("none");
    const view = open("owner");
    const link = await rail(view).findByRole("link", { name: "Activity" });
    expect(link.getAttribute("href")).toBe("/activity");
    expect(link.querySelector("[data-slot=rail-status-mark]")).toBeNull();
  });

  test.each([["attention", "degraded"], ["finished", "online"], ["running", "maintenance"]] as const)("a %s dot is the %s mark and carries no number", async (dot, level) => {
    start(dot);
    const view = open("owner");
    const link = rail(view).getByRole("link", { name: /^Activity/ });
    // The desktop rail is collapsed by default under S1; its icon and
    // accessible name are unchanged, while the quiet dot stays attached.
    await waitFor(() => expect(link.querySelector("[data-slot=rail-status-mark]")).toBeTruthy());
    expect(link.querySelector("[data-slot=rail-status-mark]")?.getAttribute("data-status-level")).toBe(level);
    expect(link.querySelector("[data-slot=rail-status-mark]")?.textContent).toBe("");
  });

  test("the All apps launcher shows the same dot on the Activity tile", async () => {
    start("finished");
    const view = open("owner", "/all-apps");
    await waitFor(() => expect(view.container.querySelector("[data-slot=app-status-mark]")).toBeTruthy());
    const tile = view.container.querySelector("[data-slot=app-status-mark]")!;
    expect(tile.getAttribute("data-status-level")).toBe("online");
    expect(tile.closest("li")?.querySelector("button[data-launch]")?.getAttribute("aria-label")).toBe("Activity: something finished");
  });

  test("a child has the entry and the page", async () => {
    start("none");
    const view = open("child", "/activity");
    await rail(view).findByRole("link", { name: "Activity" });
    await waitFor(() => expect(view.container.querySelector("[data-testid=activity-page]")).toBeTruthy());
  });

  test("a guest has no entry, and the page sends them home", async () => {
    start("finished");
    const view = open("guest", "/activity");
    await waitFor(() => expect(view.container.querySelector('nav[aria-label="Primary navigation"]')).toBeTruthy());
    expect(rail(view).queryByRole("link", { name: /^Activity/ })).toBeNull();
    expect(view.container.querySelector("[data-testid=activity-page]")).toBeNull();
  });
});
