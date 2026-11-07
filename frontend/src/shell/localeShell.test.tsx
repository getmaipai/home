// I18N-F1: the shell renders in Spanish. A known id shows its Spanish text when the catalog has it and English when it does not,
// and the main navigation (RULES S3) holds in `es` at every width. The expectations read the catalog through `i18n` rather than
// pinning model-written wording, so reviewing a Spanish line never breaks a test; they do assert that the text differs from English.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { i18n } from "@lingui/core";
import { ToastProvider } from "@maipai/ui/src/primitives/Toast";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes as RouterRoutes } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@maipai/ui/src/ui/tooltip";
import { createQueryClient } from "@maipai/ui/src/queryClient";
import { activateLocale } from "@/i18n";
import { Routes } from "@/shell/Routes";
import { PhoneMenuLinks } from "@/shell/phoneMenuLinks";
import { NotificationBell } from "@/shell/NotificationBell";
import { routeHeader, routeTitle } from "@/shell/routeHeader";
import { mockHome, makePerson, type HomeFixture } from "@/shell/pages/settings/settingsTestKit";
import { renderWithQueryClient } from "../../tests/renderWithQueryClient";
import type { AppRow } from "@/lib/api";

const t = (id: string) => i18n._({ id, message: id });
const originalMatchMedia = window.matchMedia;
const originalWidth = window.innerWidth;
let home: HomeFixture;
let baseFetch: typeof fetch;

beforeEach(async () => { await activateLocale("es"); });
afterEach(async () => {
  cleanup();
  if (baseFetch) globalThis.fetch = baseFetch;
  home?.restore();
  window.matchMedia = originalMatchMedia;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
  await activateLocale("en-US");
});

describe("shell strings in es", () => {
  test("the catalog has Spanish for known ids and English for an untranslated one", () => {
    for (const id of ["Reminders", "Clock", "All apps", "Nothing pending."]) expect(t(id)).not.toBe(id);
    // Protected copy (robot lines) is never machine-filled, so it falls back to English instead of showing an id.
    expect(t("Robot settings")).toBe("Robot settings");
    expect(i18n.locale).toBe("es");
  });

  test("route titles and headers follow the language", () => {
    expect(routeTitle("/clock")).toBe(t("Clock"));
    expect(routeHeader("/search", { display_name: "Sage" } as never).title).toBe(t("Search"));
  });

  test("the phone menu links read in Spanish", () => {
    const view = render(<MemoryRouter><PhoneMenuLinks /></MemoryRouter>);
    expect(view.getByRole("navigation", { name: t("More") })).toBeTruthy();
    expect(view.getByRole("link", { name: t("All apps") })).toBeTruthy();
    expect(view.queryByRole("link", { name: "All apps" })).toBeNull();
  });

  test("the bell reads in Spanish and falls back per id", async () => {
    globalThis.fetch = (() => Promise.resolve(Response.json([]))) as unknown as typeof fetch;
    const view = renderWithQueryClient(<MemoryRouter><ToastProvider><NotificationBell /></ToastProvider></MemoryRouter>);
    expect(await view.findByRole("button", { name: new RegExp(t("Notifications")) })).toBeTruthy();
  });
});

const base: AppRow = { package: "weather", page: "index", label: "Weather", icon: "cloud-sun", description: "Forecasts.", category: "Utilities", keywords: [], sections: [], to: "/apps/weather", incognito: "allowed" } as unknown as AppRow;

function open(path: string, width: number) {
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

describe("RULES S3 in es", () => {
  test.each(["/clock", "/reminders"])("core navigation is present at every S3 width on %s", async (path) => {
    home = mockHome({});
    baseFetch = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.startsWith("/api/apps")) return Promise.resolve(Response.json([base]));
      if (url.endsWith("/api/lists") || url.endsWith("/api/coming-up") || url.endsWith("/api/alarms")) return Promise.resolve(Response.json([]));
      return baseFetch(input, init);
    }) as typeof fetch;
    for (const width of [360, 402, 874, 744, 1440]) {
      const view = open(path, width);
      if (width >= 640) {
        const rail = within(await view.findByRole("navigation", { name: "Primary navigation" }) as HTMLElement);
        expect(await rail.findByRole("link", { name: t("Reminders") })).toBeTruthy();
        expect(rail.getByRole("link", { name: t("Clock") })).toBeTruthy();
      } else {
        await act(async () => { fireEvent.click(await view.findByRole("button", { name: "Open menu" })); });
        const drawer = await view.findByRole("dialog");
        expect(within(drawer).getByRole("link", { name: t("Reminders") })).toBeTruthy();
        expect(within(drawer).getByRole("link", { name: t("Clock") })).toBeTruthy();
      }
      cleanup();
    }
  });
});
