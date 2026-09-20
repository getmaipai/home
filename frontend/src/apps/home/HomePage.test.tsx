import { describe, test, expect, mock, afterEach } from "bun:test";
import { cleanup, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { ToastProvider } from "@maipai/ui/src/primitives/Toast";
import { HomePage } from "@/apps/home/HomePage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { ndjsonStream } from "../../../tests/ndjsonStream";
import type { Roster } from "@/lib/api";

// A throwaway `setupI18n()` instance, not `@/i18n`'s own real one: `bun
// test` has no `.po`-file loader (src/i18n.test.tsx's own precedent), so
// importing `@/i18n` here fails before this test ever ran.
const testI18n = setupI18n({ locale: "en-US", messages: { "en-US": {} } });

afterEach(cleanup);

function makePerson(role: Roster["role"] = "owner"): Roster {
  return {
    id: "person-jesse123",
    display_name: "jesse",
    nickname: null,
    role,
    avatar_seed: "person-jesse123",
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

// Stubs every endpoint the new dashboard's panels touch on mount
// (STACK-94d's own HOME-UI-01 sibling item: the metric row, Today,
// Recent memories, Your apps, People, Activity, Quick actions). `homePlace`
// drives the weather-turn assertion below; `people`/`memories`/
// `conversations`/`pinnedApps`/`repairs`/`updates` feed the household row
// and metric row - every other route returns an empty, well-formed shape
// by default.
function stubFetch(options: {
  homePlace?: string;
  turnBodies: unknown[];
  people?: unknown[];
  memories?: unknown[];
  conversations?: unknown[];
  pinnedApps?: string[];
  repairs?: unknown[];
  widgets?: unknown[];
  requestedUrls?: string[];
}): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    options.requestedUrls?.push(url);
    if (url.includes("/api/people")) return Promise.resolve(Response.json(options.people ?? []));
    if (url.includes("/api/memory")) return Promise.resolve(Response.json(options.memories ?? []));
    if (url.includes("/api/widgets")) return Promise.resolve(Response.json(options.widgets ?? []));
    if (url.includes("/api/conversations")) return Promise.resolve(Response.json(options.conversations ?? []));
    if (url.includes("/api/repairs")) return Promise.resolve(Response.json(options.repairs ?? []));
    if (url.includes("/api/host/hardware")) {
      return Promise.resolve(
        Response.json({ computerName: "Test-Mac", platform: "darwin", arch: "arm64", totalRamGb: 32, cpuCount: 10, isAppleSilicon: true, unifiedMemoryGb: 32, cudaDevices: [], osVersion: "24.6.0" }),
      );
    }
    if (url.includes("/api/health")) {
      const entry = { kind: "stub", pid: null, alive: true };
      return Promise.resolve(Response.json({ brain: "stub", voice: "stub", ok: true, engines: { chat: entry, embed: entry, background: entry, voice: entry }, uptimeSeconds: 100, sidecars: [] }));
    }
    if (url.includes("/api/updates")) {
      return Promise.resolve(Response.json({ installed: "0.1.0", latest: null, summary: null, url: null, assets: [], channel: "stable", progress: null, needs: [], blockedBy: null, checkedAt: null, error: null }));
    }
    if (url.includes("/api/settings/registry")) return Promise.resolve(Response.json([]));
    if (url.includes("/api/commands")) return Promise.resolve(Response.json([]));
    if (url.includes("/api/settings?scope=household")) {
      return Promise.resolve(
        Response.json([{ key: "household.home_place", value: options.homePlace ?? "", source: options.homePlace ? "user" : "default", label: "Household location", level: "basic", secret: false }]),
      );
    }
    if (url.includes("/api/settings?scope=person%3A")) {
      return Promise.resolve(
        Response.json(
          options.pinnedApps
            ? [{ key: "ui.pinned_apps", value: JSON.stringify(options.pinnedApps), source: "user", label: "Pinned apps", level: "basic", secret: false }]
            : [],
        ),
      );
    }
    if (url.includes("/api/turn/stream")) {
      options.turnBodies.push(JSON.parse(String(init?.body ?? "{}")));
      return Promise.resolve(
        new Response(ndjsonStream([{ type: "done", value: { reply: { text: "It's 62 degrees in Portland, OR." }, source: "model" } }]), {
          status: 200,
          headers: { "content-type": "application/x-ndjson" },
        }),
      );
    }
    throw new Error(`unstubbed fetch: ${url}`);
  }) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function renderHome(person: Roster = makePerson()) {
  return renderWithQueryClient(
    <ToastProvider>
      <I18nProvider i18n={testI18n}>
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route path="/" element={<HomePage person={person} />} />
            <Route path="/people/:id" element={<div>The real profile page</div>} />
          </Routes>
        </MemoryRouter>
      </I18nProvider>
    </ToastProvider>,
  );
}

// Found live 2026-09-11: Home's "Today" panel's weather line asked a
// place-free "what's the weather like today?", leaving the model to
// guess a `place` on its own (it guessed the literal word "here" - and
// Open-Meteo genuinely has a village named that, so the line showed a
// real, very hot, very wrong temperature). household.home_place should
// now be threaded into the question whenever the household has set one.
describe("HomePage - Today panel weather line", () => {
  test("asks a place-free question when no household location is set", async () => {
    const turnBodies: unknown[] = [];
    const restoreFetch = stubFetch({ turnBodies });
    try {
      const { findByText } = renderHome();
      await findByText("It's 62 degrees in Portland, OR.");
      expect(turnBodies).toEqual([{ surface: "chat", text: "What's the weather like today?", ephemeral: true }]);
    } finally {
      restoreFetch();
    }
  });

  test("asks about the household's own place once household.home_place is set", async () => {
    const turnBodies: unknown[] = [];
    const restoreFetch = stubFetch({ homePlace: "Portland, OR", turnBodies });
    try {
      const { findByText } = renderHome();
      await findByText("It's 62 degrees in Portland, OR.");
      expect(turnBodies).toEqual([{ surface: "chat", text: "What's the weather like in Portland, OR today?", ephemeral: true }]);
    } finally {
      restoreFetch();
    }
  });
});

// Found live 2026-09-11 alongside the weather bug: the memories panel
// had no way to reach the real memories page at all.
describe("HomePage - Recent memories panel", () => {
  // Opens the signed-in person's own Memories tab (owner ruling,
  // "Navigation, corrected," 2026-09-20) - Memories moved off the rail
  // and onto a person's profile.
  test("'View all' navigates to the signed-in person's own profile", async () => {
    const turnBodies: unknown[] = [];
    const restoreFetch = stubFetch({ turnBodies });
    try {
      const { findByRole, findByText } = renderHome();
      const link = await findByRole("button", { name: "View all memories" });
      fireEvent.click(link);
      await findByText("The real profile page");
    } finally {
      restoreFetch();
    }
  });
});

// Lane 9 item 1: the strip reads the sidebar's own `pinnedIds`
// (`usePinnedApps`) - one definition, not a second favorites list.
describe("HomePage - Your apps panel", () => {
  test("shows pinned apps in pin order, not catalog order", async () => {
    // Settings and Chat, in that order, is the REVERSE of APP_CATALOG's
    // own declared order (Chat first) - proves the strip follows
    // pinnedIds, not just "whichever pinned apps happen to exist".
    const restoreFetch = stubFetch({ turnBodies: [], pinnedApps: ["/settings", "/chat"] });
    try {
      const { findByRole } = renderHome();
      // Scoped to the strip's own list (CardGrid's aria-label="Your
      // apps"), not a page-wide text search: the dashboard's Chat
      // metric card (spec "The dashboard") now also renders the exact
      // text "Chat" elsewhere on the page.
      const list = await findByRole("list", { name: "Your apps" });
      const labels = within(list).getAllByText(/^(Settings|Chat)$/);
      expect(labels.map((el) => el.textContent)).toEqual(["Settings", "Chat"]);
    } finally {
      restoreFetch();
    }
  });

  // COORDINATOR, 2026-09-20: "Your apps" and "Your packages" used to be
  // two stacked sections, each with its own empty state - one strip now,
  // pinned apps and installed packages together as tiles, one empty
  // state, no second heading.
  test("shows an installed package as a tile in the same strip as a pinned app, not a second section", async () => {
    const restoreFetch = stubFetch({
      turnBodies: [],
      pinnedApps: ["/chat"],
      widgets: [{ package: "weather", id: "today", title: "Weather", size: "card", refresh_s: 1800 }],
    });
    try {
      const { findByRole, queryByText } = renderHome();
      const list = await findByRole("list", { name: "Your apps" });
      expect(within(list).getByText("Chat")).toBeTruthy();
      expect(within(list).getByText("Weather")).toBeTruthy();
      expect(queryByText("Your packages")).toBeNull();
    } finally {
      restoreFetch();
    }
  });
});

// The dashboard's metric row (spec "The dashboard"): Repairs reads the
// same real /api/repairs count RepairsSection.tsx does.
describe("HomePage - metric row", () => {
  test("the Repairs card reads the real open-repairs count", async () => {
    const restoreFetch = stubFetch({ turnBodies: [], repairs: [{ id: "issue-1", severity: "warning" }] });
    try {
      const { findByText } = renderHome();
      await findByText("Repairs");
      await findByText("1");
    } finally {
      restoreFetch();
    }
  });

  test("the Repairs card reads zero as All good, not a fabricated state", async () => {
    const restoreFetch = stubFetch({ turnBodies: [], repairs: [] });
    try {
      const { findByText } = renderHome();
      await findByText("All good");
    } finally {
      restoreFetch();
    }
  });

  // A code review (2026-09-20) caught this: GET /api/repairs and
  // GET /api/host/hardware are both owner/admin only
  // (backend/src/routes/repairs.ts, host.ts). A non-admin person used
  // to have useHubStatus() call them anyway, get a 403, and (react-
  // query's own `retry: false`) never resolve them again for the rest
  // of the session - the Repairs card stuck on "..." forever and the
  // rail's hub card falsely claiming "All systems healthy" for a state
  // it never actually read.
  test("a non-admin person never calls the admin-only reads, and sees an honest fallback instead of a stuck or fabricated state", async () => {
    const requestedUrls: string[] = [];
    const restoreFetch = stubFetch({ turnBodies: [], requestedUrls });
    try {
      const { findByText } = renderHome(makePerson("adult"));
      await findByText("Repairs");
      await findByText("Admins only");
      expect(requestedUrls.some((url) => url.includes("/api/repairs"))).toBe(false);
      expect(requestedUrls.some((url) => url.includes("/api/host/hardware"))).toBe(false);
    } finally {
      restoreFetch();
    }
  });
});
