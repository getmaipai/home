import { describe, test, expect, mock, afterEach } from "bun:test";
import { cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { HomePage } from "@/apps/home/HomePage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { ndjsonStream } from "../../../tests/ndjsonStream";
import type { Roster } from "@/lib/api";

// A throwaway `setupI18n()` instance, not `@/i18n`'s own real one: `bun
// test` has no `.po`-file loader (src/i18n.test.tsx's own precedent), so
// importing `@/i18n` here fails before this test ever ran. HomePage's
// only `<Trans>` use is its "Today" section heading.
const testI18n = setupI18n({ locale: "en-US", messages: { "en-US": { Today: "Today" } } });

afterEach(cleanup);

function makePerson(): Roster {
  return {
    id: "person-jesse123",
    display_name: "jesse",
    nickname: null,
    role: "owner",
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

// Stubs every endpoint HomePage's own cards touch on mount. `homePlace`
// (household.home_place) drives the weather-turn assertion below,
// `familyName` (household.family_name) drives the tagline assertion;
// `people`/`memories`/`conversations`/`pinnedApps` feed the search
// prompt box (lane 9 item 1) and the pinned strip - every other route
// returns an empty, well-formed shape by default.
function stubFetch(options: {
  homePlace?: string;
  familyName?: string;
  turnBodies: unknown[];
  people?: unknown[];
  memories?: unknown[];
  conversations?: unknown[];
  pinnedApps?: string[];
}): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/people")) return Promise.resolve(Response.json(options.people ?? []));
    if (url.includes("/api/memory")) return Promise.resolve(Response.json(options.memories ?? []));
    if (url.includes("/api/widgets")) return Promise.resolve(Response.json([]));
    if (url.includes("/api/conversations")) return Promise.resolve(Response.json(options.conversations ?? []));
    if (url.includes("/api/settings/registry")) return Promise.resolve(Response.json([]));
    if (url.includes("/api/commands")) return Promise.resolve(Response.json([]));
    if (url.includes("/api/settings?scope=household")) {
      return Promise.resolve(
        Response.json([
          {
            key: "household.home_place",
            value: options.homePlace ?? "",
            source: options.homePlace ? "user" : "default",
            label: "Household location",
            level: "basic",
            secret: false,
          },
          {
            key: "household.family_name",
            value: options.familyName ?? "",
            source: options.familyName ? "user" : "default",
            label: "Family name",
            level: "basic",
            secret: false,
          },
        ]),
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

// Reads the navigated `initialText` state a query-with-no-match falls
// through to `/chat` with (ChatPage.tsx's own real contract), so the
// Enter-sends-to-chat assertions below can check what was actually sent
// without mounting the real Chat page.
function ChatStub() {
  const state = useLocation().state as { initialText?: string } | null;
  return <div>Asked MaiPai: {state?.initialText ?? ""}</div>;
}

function renderHome() {
  return renderWithQueryClient(
    <I18nProvider i18n={testI18n}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<HomePage person={makePerson()} />} />
          <Route path="/memory" element={<div>The real memories page</div>} />
          <Route path="/chat" element={<ChatStub />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

// Found live 2026-09-11: Home's "Today" weather card asked a place-free
// "what's the weather like today?", leaving the model to guess a `place`
// on its own (it guessed the literal word "here" - and Open-Meteo
// genuinely has a village named that, so the card showed a real, very
// hot, very wrong temperature). household.home_place should now be
// threaded into the question whenever the household has set one.
describe("HomePage - WeatherCard", () => {
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

// Found live 2026-09-11 alongside the weather bug: the header hardcoded
// a generic "Made for your everyday" tagline with no way for a household
// to make the page its own.
describe("HomePage - Tagline", () => {
  test("shows the generic default when no family name is set", async () => {
    const restoreFetch = stubFetch({ turnBodies: [] });
    try {
      const { findByText } = renderHome();
      await findByText("Made for your everyday");
    } finally {
      restoreFetch();
    }
  });

  test("shows '<name> Family' once household.family_name is set", async () => {
    const restoreFetch = stubFetch({ familyName: "Willow", turnBodies: [] });
    try {
      const { findByText, queryByText } = renderHome();
      await findByText("Willow Family");
      expect(queryByText("Made for your everyday")).toBeNull();
    } finally {
      restoreFetch();
    }
  });
});

// Found live 2026-09-11 alongside the weather bug: the memories card had
// no way to reach the real memories page at all, unlike the Favorites
// section right below it on the same dashboard, which already has a
// "Browse apps ->" link.
describe("HomePage - RecentMemoriesCard", () => {
  test("'View all' navigates to the real memories page", async () => {
    const turnBodies: unknown[] = [];
    const restoreFetch = stubFetch({ turnBodies });
    try {
      const { findByRole, findByText } = renderHome();
      const link = await findByRole("button", { name: "View all →" });
      fireEvent.click(link);
      await findByText("The real memories page");
    } finally {
      restoreFetch();
    }
  });
});

// Lane 9 item 1: "one prompt box that is both search and chat" - the
// same shared query (`useSearchCommand`) `CommandPalette.tsx` uses.
describe("HomePage - search prompt box", () => {
  test("typing lists a matching app, memory, and conversation", async () => {
    const restoreFetch = stubFetch({
      turnBodies: [],
      memories: [{ id: "mem-chat1", text: "Prefers chat over phone calls", category: "fact" }],
      conversations: [
        { id: "conv-chat1", surface: "chat", companion_id: null, title: "Chat about weekend plans", turn_count: 2, last_turn_at: null, created_at: "2026-09-13T00:00:00.000Z" },
      ],
    });
    try {
      const { findByPlaceholderText, findByText, findAllByText } = renderHome();
      const input = await findByPlaceholderText("Ask MaiPai anything...");
      fireEvent.change(input, { target: { value: "chat" } });
      await findByText("Chat"); // the app
      // The memory's own text legitimately also shows in the "Recent
      // memories" Today card, unrelated to search - at least one of the
      // two is the search result the query row itself produced.
      await findAllByText("Prefers chat over phone calls");
      await findByText("Chat about weekend plans"); // the conversation
    } finally {
      restoreFetch();
    }
  });

  test("selecting a matched app navigates straight to it", async () => {
    const restoreFetch = stubFetch({ turnBodies: [] });
    try {
      const { findByPlaceholderText, findByText } = renderHome();
      const input = await findByPlaceholderText("Ask MaiPai anything...");
      fireEvent.change(input, { target: { value: "memory" } });
      const match = await findByText("Memory");
      fireEvent.click(match);
      await findByText("The real memories page"); // renderHome()'s own /memory stub route
    } finally {
      restoreFetch();
    }
  });

  // The exact promise the plain box already kept: pressing Enter with
  // nothing deliberately arrowed to sends the raw text to chat, even
  // when real matches exist for it (SearchResultGroups' own "Ask" row
  // renders first, so cmdk's default-highlight-first-item lands there).
  test("Enter with nothing arrowed to sends the typed text to chat, even with real matches showing", async () => {
    const restoreFetch = stubFetch({
      turnBodies: [],
      memories: [{ id: "mem-chat1", text: "Prefers chat over phone calls", category: "fact" }],
    });
    try {
      const { findByPlaceholderText, findByText } = renderHome();
      const input = await findByPlaceholderText("Ask MaiPai anything...");
      fireEvent.change(input, { target: { value: "chat" } });
      await findByText("Ask MaiPai: chat"); // confirms real matches (the memory) are showing too, not just Ask
      fireEvent.keyDown(input, { key: "Enter" });
      await findByText("Asked MaiPai: chat");
    } finally {
      restoreFetch();
    }
  });
});

// Lane 9 item 1: the strip reads the sidebar's own `pinnedIds`
// (`usePinnedApps`) - one definition, not a second favorites list.
describe("HomePage - pinned apps strip", () => {
  test("shows pinned apps in pin order, not catalog order", async () => {
    // Settings and Chat, in that order, is the REVERSE of APP_CATALOG's
    // own declared order (Chat first) - proves the strip follows
    // pinnedIds, not just "whichever pinned apps happen to exist".
    const restoreFetch = stubFetch({ turnBodies: [], pinnedApps: ["/settings", "/chat"] });
    try {
      const { findAllByText } = renderHome();
      const labels = await findAllByText(/^(Settings|Chat)$/);
      expect(labels.map((el) => el.textContent)).toEqual(["Settings", "Chat"]);
    } finally {
      restoreFetch();
    }
  });
});
