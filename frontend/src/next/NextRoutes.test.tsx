import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NextEnginesPage } from "@/next/pages/NextEnginesPage";
import { NextUpdatesPage } from "@/next/pages/NextUpdatesPage";
import { NextRepairsPage } from "@/next/pages/NextRepairsPage";
import { NextBackupsPage } from "@/next/pages/NextBackupsPage";
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
// the OS default would fail here.
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
            { scope: "person:person-abc123", key: "ui.look", value: "studio" },
          ]),
        );
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;

    try {
      renderWithQueryClient(
        <MemoryRouter initialEntries={["/sign-in"]}>
          <NextRoutes person={makePerson()} />
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
          { scope: "person:person-abc123", key: "ui.look", value: "studio" },
        ]);
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    try {
      renderWithQueryClient(
        <MemoryRouter initialEntries={["/sign-in"]}>
          <NextRoutes person={makePerson()} />
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

describe("next Manage routes", () => {
  test.each([
    ["/next/engines", NextEnginesPage],
    ["/next/updates", NextUpdatesPage],
    ["/next/repairs", NextRepairsPage],
    ["/next/backups", NextBackupsPage],
  ])("%s renders the template tables view", (_route, Page) => {
    render(
      <MemoryRouter initialEntries={[_route]}>
        <Page />
      </MemoryRouter>,
    );
    expect(document.body.textContent).toContain("Tables");
  });
});
