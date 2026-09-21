import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { NextRoutes } from "@/next/NextRoutes";
import { renderWithQueryClient } from "../../tests/renderWithQueryClient";
import type { Roster } from "@/lib/api";

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark", "light");
});

mock.module("@/next/useShellNext", () => ({ useShellNext: () => "on" }));

function makePerson(): Roster {
  return {
    id: "person-abc123",
    display_name: "Nova",
    nickname: null,
    role: "owner",
    avatar_seed: "person-abc123",
    source: "hub",
    local_only: false,
    created_at: "2026-09-04T00:00:00.000Z",
    updated_at: "2026-09-04T00:00:00.000Z",
    deleted_at: null,
    enabled: true,
    guest_expires_at: null,
    memorialized_at: null,
    hlc: "1788000000000:0:test",
    hasSecret: true,
  };
}

// HOME-UI-04d's own acceptance: the class on <html> follows
// ui.appearance, never the OS media query, once the vendored
// ThemeProvider (mounted in NextRoutes) and useNextAppearance have
// had a chance to run - stubs matchMedia to the OPPOSITE of the
// setting each time, so a test that passed by coincidentally matching
// the OS default would fail here. Still renders at "/sign-in": SHELL-08
// made an authenticated visit there redirect to "/next" (the
// dashboard), which this isolated MemoryRouter has no matching route
// for either, so it renders nothing - exactly what this test wants,
// since useNextAppearance/useNextLook run in NextRoutesInner before
// its own <Routes> switch, regardless of which sub-route (if any)
// ends up matching. Rendering the real dashboard here would need
// GET /api/dashboard mocked too, which is not what this test is about.
describe("NextRoutes appearance", () => {
  test.each([
    ["light", true, "light", "dark"],
    ["dark", false, "dark", "light"],
  ] as const)("ui.appearance=%s wins over an OS that prefers the opposite", async (setting, osPrefersDark, expectedClass, otherClass) => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = mock(() => ({ matches: osPrefersDark, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/settings")) {
        return Promise.resolve(
          Response.json([
            { scope: "person:person-abc123", key: "ui.appearance", value: setting },
            { scope: "person:person-abc123", key: "ui.look", value: "neutral" },
          ]),
        );
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;

    try {
      renderWithQueryClient(
        <MemoryRouter initialEntries={["/sign-in"]}>
          <NextRoutes person={makePerson()} onSignedIn={() => {}} />
        </MemoryRouter>,
      );
      await waitFor(() => expect(document.documentElement.classList.contains(expectedClass)).toBe(true));
      expect(document.documentElement.classList.contains(otherClass)).toBe(false);
    } finally {
      window.matchMedia = originalMatchMedia;
      globalThis.fetch = originalFetch;
    }
  });

  // A regression for a real bug a review caught before it shipped:
  // the vendored ThemeProvider seeds its own `theme` state from a
  // bare, person-unscoped `localStorage` key on mount - a stale
  // "dark" left over from a different person's session on the same
  // shared household browser, say - before the real `ui.appearance`
  // fetch has resolved. The write-back half of useNextAppearance must
  // not treat that pre-fetch mismatch as a real toggle and PUT the
  // stale value over this person's actual setting.
  test("a stale localStorage theme never overwrites the setting before the fetch resolves", async () => {
    localStorage.setItem("vite-ui-theme", "dark");
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = mock(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
    const originalFetch = globalThis.fetch;
    const puts: unknown[] = [];
    let resolveSettings!: () => void;
    const settingsGate = new Promise<void>((resolve) => {
      resolveSettings = resolve;
    });
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/settings") && init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        puts.push(body);
        return Response.json({ scope: body.scope, key: body.key, value: body.value, hlc: "test" });
      }
      if (url.includes("/api/settings")) {
        await settingsGate;
        return Response.json([
          { scope: "person:person-abc123", key: "ui.appearance", value: "light" },
          { scope: "person:person-abc123", key: "ui.look", value: "neutral" },
        ]);
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    try {
      renderWithQueryClient(
        <MemoryRouter initialEntries={["/sign-in"]}>
          <NextRoutes person={makePerson()} onSignedIn={() => {}} />
        </MemoryRouter>,
      );
      // The fetch is still pending here - nothing should have written
      // ui.appearance back yet, even though the provider's own theme
      // (seeded from the stale localStorage value above) disagrees
      // with the eventual "light".
      expect(puts).toEqual([]);
      resolveSettings();
      await waitFor(() => expect(document.documentElement.classList.contains("light")).toBe(true));
      expect(puts).toEqual([]);
    } finally {
      localStorage.removeItem("vite-ui-theme");
      window.matchMedia = originalMatchMedia;
      globalThis.fetch = originalFetch;
    }
  });
});

// The old "next Manage routes" shared stub check (a bare MemoryRouter
// render, no QueryClientProvider, asserting the vendored demo's own
// "Tables" breadcrumb text) is gone: /next/engines, /next/updates,
// /next/repairs and /next/backups all have real data and their own
// QueryClient-dependent dedicated test files now (NextEnginesPage.test.tsx,
// NextUpdatesPage.test.tsx, NextRepairsPage.test.tsx, NextBackupsPage.test.tsx).

// SHELL-FLAG-01's third redirect: signing in at /next/sign-in lands on
// /next. Already-working behavior (NextRoutesInner's own `path="sign-in"`
// route, above, redirects an authenticated visit there), proven here
// with a real destination registered to land on - the file's own
// earlier appearance tests exercise the identical redirect as a side
// effect of their own setup but have nothing for it to land on
// ("renders nothing", their own comment), which proves the Navigate
// fires but not where it actually goes.
describe("NextRoutes sign-in redirect (SHELL-FLAG-01)", () => {
  test("an authenticated visit to /next/sign-in lands on the real /next dashboard, not the sign-in form", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/settings")) {
        return Promise.resolve(
          Response.json([
            { scope: "person:person-abc123", key: "ui.appearance", value: "dark" },
            { scope: "person:person-abc123", key: "ui.look", value: "neutral" },
          ]),
        );
      }
      // NextDashboardPage.test.tsx's own minimal shape - the index
      // route this redirect lands on renders the real dashboard, not a
      // stub page, so it needs a real Dashboard body to avoid erroring
      // on RecentActivityTable's own undefined-shaped fallback.
      if (url.includes("/api/dashboard")) {
        return Promise.resolve(
          Response.json({
            people_count: 1,
            updates_available: false,
            recent_activity: [],
            turns_per_day: Array.from({ length: 30 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, count: 0 })),
          }),
        );
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;
    try {
      const view = renderWithQueryClient(
        <MemoryRouter initialEntries={["/next/sign-in"]}>
          <Routes>
            <Route path="/next/*" element={<NextRoutes person={makePerson()} onSignedIn={() => {}} />} />
          </Routes>
        </MemoryRouter>,
      );
      // The FullLayout's own header chrome (Search....) proves the
      // dashboard shell mounted; the sign-in form's own field proves
      // it's NOT still showing the sign-in screen.
      expect(await view.findByPlaceholderText("Search....")).toBeVisible();
      expect(view.queryByPlaceholderText("PIN or password")).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
