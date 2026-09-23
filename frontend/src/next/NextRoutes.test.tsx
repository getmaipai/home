import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { NextUpdatesPage } from "@/next/pages/NextUpdatesPage";
import { NextRepairsPage } from "@/next/pages/NextRepairsPage";
import { NextBackupsPage } from "@/next/pages/NextBackupsPage";
import { NextRoutes } from "@/next/NextRoutes";
import { renderWithQueryClient } from "../../tests/renderWithQueryClient";
import type { Roster } from "@/lib/api";

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark", "light");
  localStorage.removeItem("vite-ui-theme");
});

let shellNextState: "on" | "off" | "loading" = "on";
mock.module("@/next/useShellNext", () => ({
  useShellNext: () => shellNextState,
}));

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
      // The header's own left slot (CHAT-HEADER-02: icon + "Home" on
      // the dashboard route, replacing the shipped Search field there)
      // proves the FullLayout shell mounted; the sign-in form's own
      // field proves it's NOT still showing the sign-in screen. Scoped
      // to the header's own unnamed <nav> - the sidebar's own "Home"
      // group heading is a second, unrelated match otherwise.
      expect(await view.findByRole("navigation")).toHaveTextContent("Home");
      expect(view.queryByPlaceholderText("PIN or password")).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("NextRoutes loading (HOME-UI-04g)", () => {
  // HOME-UI-04g: `readShellNextCache` (called from `useShellNext`, which
  // `NextRoutes` calls on every render) is the whole loading-decision,
  // so the loading-path test exercises it directly through a cache
  // value rather than through a `useShellNext` module mock - a mock
  // would pin the state independently of the cache and let the test
  // pass even if the component ignored the cache.
  test("loading with cached on paints the template palette and never shows RouteSkeleton", async () => {
    localStorage.setItem(
      "maipai.shell.next",
      JSON.stringify({ on: true, look: "neutral", dark: false }),
    );
    const originalFetch = globalThis.fetch;
    let resolveSettings!: () => void;
    const settingsGate = new Promise<void>((resolve) => {
      resolveSettings = resolve;
    });
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/settings")) {
        await settingsGate;
        return Response.json([
          { scope: "household", key: "ui.shell.next", value: true },
          { scope: "person:person-abc123", key: "ui.appearance", value: "light" },
          { scope: "person:person-abc123", key: "ui.look", value: "neutral" },
        ]);
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;

    try {
      renderWithQueryClient(
        <MemoryRouter initialEntries={["/sign-in"]}>
          <NextRoutes person={makePerson()} onSignedIn={() => {}} />
        </MemoryRouter>,
      );
      // While the fetch is pending the cache decides the palette:
      // the look class is on <body>, the light class on <html>, and
      // the old shell's RouteSkeleton is never mounted.
      expect(document.body.classList.contains("style-neutral")).toBe(true);
      expect(document.documentElement.classList.contains("light")).toBe(true);
      expect(document.querySelector('[data-testid="route-skeleton"]')).toBeNull();
      resolveSettings();
      await waitFor(() => expect(document.querySelector('[data-testid="route-skeleton"]')).toBeNull());
    } finally {
      localStorage.removeItem("maipai.shell.next");
      globalThis.fetch = originalFetch;
    }
  });

  // HOME-UI-04g: the no-cache loading state. The file-level mock reads
  // `shellNextState`, so this test sets it to "loading" before
  // rendering; with no cache, `useShellNext` reports "loading" and
  // `readShellNextCache` returns null: the old shell's RouteSkeleton
  // stands and nothing is painted.
  test("loading with no cache renders RouteSkeleton", async () => {
    shellNextState = "loading";
    localStorage.clear();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/settings")) {
        return Response.json([
          { scope: "household", key: "ui.shell.next", value: true },
          { scope: "person:person-abc123", key: "ui.appearance", value: "light" },
          { scope: "person:person-abc123", key: "ui.look", value: "neutral" },
        ]);
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;

    try {
      renderWithQueryClient(
        <MemoryRouter initialEntries={["/sign-in"]}>
          <NextRoutes person={makePerson()} onSignedIn={() => {}} />
        </MemoryRouter>,
      );
      // No cache, so `useShellNext` reports "loading" and
      // `readShellNextCache` returns null: the old shell's
      // RouteSkeleton stands and nothing is painted.
      const loadingBranch = document.querySelector('[data-testid="next-loading-branch"]');
      expect(loadingBranch).not.toBeNull();
      expect(loadingBranch?.querySelector('[role="status"]')).not.toBeNull();
    } finally {
      shellNextState = "on";
      globalThis.fetch = originalFetch;
    }
  });
});

describe("next Manage routes", () => {
  // /next/engines moved off this shared "still a stub" check once
  // SHELL-06 gave it real data and its own dedicated test file
  // (NextEnginesPage.test.tsx). These three are real data pages now
  // (SHELL-07): each renders a template DataTable fed by its own
  // useQuery, so they need a QueryClientProvider and a mocked API
  // response to reach the loaded state.
  const routeToApi: Record<string, string> = {
    "/next/updates": "/api/updates",
    "/next/repairs": "/api/repairs",
    "/next/backups": "/api/backups",
  };
  const routeToBody: Record<string, unknown> = {
    "/next/updates": { installed: "1.0.0", latest: "1.0.1", summary: null, url: null, checkedAt: "2026-09-01T00:00:00Z", error: null, stack: null, stackError: null },
    "/next/repairs": [{
      id: "issue-abc123",
      source: "backup",
      key: "stale",
      severity: "warning",
      title: "Backup is stale",
      detail: "Last backup was 10 days ago.",
      fix: { label: "Run backup", action: "run-backup" },
      learn_more: null,
      created_at: "2026-09-01T00:00:00.000Z",
      resolved_at: null,
      dismissed_at: null,
      hlc: "1000:0:abcdef12",
    }],
    "/next/backups": [{ filename: "backup-2026-09-01.db", createdAt: "2026-09-01T00:00:00.000Z", bytes: 1048576 }],
  };

  test.each([
    ["/next/updates", NextUpdatesPage],
    ["/next/repairs", NextRepairsPage],
    ["/next/backups", NextBackupsPage],
  ])("%s renders the template tables view", async (route, Page) => {
    const originalFetch = globalThis.fetch;
    const endpoint = routeToApi[route]!;
    const body = routeToBody[route]!;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes(endpoint)) {
        return Promise.resolve(Response.json(body));
      }
      if (url.includes("/api/settings")) {
        return Promise.resolve(
          Response.json([
            { scope: "person:person-abc123", key: "ui.appearance", value: "light" },
            { scope: "person:person-abc123", key: "ui.look", value: "neutral" },
          ]),
        );
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;
    try {
      const view = renderWithQueryClient(
        <MemoryRouter initialEntries={[route]}>
          <Page person={makePerson()} />
        </MemoryRouter>,
      );
      await view.findByRole("table");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
