import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
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
// made an authenticated visit there redirect to "/" (the
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
        <MemoryRouter initialEntries={["/appearance-test"]}>
          <NextRoutes person={makePerson()} onSignedIn={() => {}} />
        </MemoryRouter>,
      );
      await waitFor(() => {
        expect(document.documentElement.classList.contains(expectedClass)).toBe(true);
        expect(document.documentElement.classList.contains(otherClass)).toBe(false);
      });
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
        <MemoryRouter initialEntries={["/appearance-test"]}>
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
describe("NextRoutes sign-in redirect", () => {
  test("an authenticated visit to /sign-in lands on the root dashboard, not the sign-in form", async () => {
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
        <MemoryRouter initialEntries={["/sign-in"]}>
          <Routes>
            <Route path="/*" element={<NextRoutes person={makePerson()} onSignedIn={() => {}} />} />
          </Routes>
        </MemoryRouter>,
      );
      // The dashboard's own heading proves the redirect reached the
      // root route; the sign-in form's field proves it left the PIN
      // screen. The sidebar also has a navigation landmark, so this
      // assertion targets the destination page directly.
      expect(await view.findByRole("heading", { name: "Home" })).toBeTruthy();
      expect(view.queryByPlaceholderText("PIN or password")).toBeNull();
      fireEvent.click(await view.findByRole("button", { name: "Open account menu for Nova" }));
      expect(await view.findByRole("heading", { name: "Nova" })).toBeTruthy();
      expect(view.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/next/settings");
      expect(view.getByRole("link", { name: "Help" }).getAttribute("href")).toContain("docs/user/README.md");
      expect(view.queryByText(/Cameron|shadcndashboard\.com|Invoice|Subscription/)).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("NextRoutes tools path", () => {
  function renderNextRoute(path: string) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/settings")) {
        return Promise.resolve(Response.json([
          { scope: "person:person-abc123", key: "ui.appearance", value: "dark" },
          { scope: "person:person-abc123", key: "ui.look", value: "neutral" },
        ]));
      }
      if (url.includes("/api/plugins")) return Promise.resolve(Response.json([]));
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;
    const view = renderWithQueryClient(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/*" element={<NextRoutes person={makePerson()} onSignedIn={() => {}} />} />
        </Routes>
      </MemoryRouter>,
    );
    return { view, restore: () => { globalThis.fetch = originalFetch; } };
  }

  test("/tools mounts the tools page and the sidebar points to it", async () => {
    const { view, restore } = renderNextRoute("/tools");
    try {
      await waitFor(() => expect(document.title).toBe("Tools · MaiPai Home"));
      expect(view.container.querySelector('[data-slot="card-title"]')?.textContent).toContain("Tools");
      expect(view.getByRole("link", { name: "Tools" }).getAttribute("href")).toBe("/next/tools");
    } finally {
      restore();
    }
  });

  test("/apps no longer mounts the tools page", async () => {
    const { view, restore } = renderNextRoute("/apps");
    try {
      expect(view.container.querySelector('[data-slot="card-title"]')).toBeNull();
      expect(view.queryByRole("table")).toBeNull();
    } finally {
      restore();
    }
  });
});

describe("next Manage routes", () => {
  // /next/engines moved off this shared "still a stub" check once
  // SHELL-06 gave it real data and its own dedicated test file
  // (NextEnginesPage.test.tsx). These three are real data pages now
  // (SHELL-07): each renders Home's shared table fed by its own
  // useQuery, so they need a QueryClientProvider and a mocked API
  // response to reach the loaded state.
  const routeToApi: Record<string, string> = {
    "/updates": "/api/updates",
    "/repairs": "/api/repairs",
    "/backups": "/api/backups",
  };
  const routeToBody: Record<string, unknown> = {
    "/updates": { installed: "1.0.0", latest: "1.0.1", summary: null, url: null, checkedAt: "2026-09-01T00:00:00Z", error: null, stack: null, stackError: null, reference: null, referenceError: null },
    "/repairs": [{
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
    "/backups": [{ filename: "backup-2026-09-01.db", createdAt: "2026-09-01T00:00:00.000Z", bytes: 1048576 }],
  };

  test.each([
    ["/updates", NextUpdatesPage],
    ["/repairs", NextRepairsPage],
    ["/backups", NextBackupsPage],
  ])("%s renders the shared tables view", async (route, Page) => {
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
