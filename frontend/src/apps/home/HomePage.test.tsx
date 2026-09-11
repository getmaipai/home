import { describe, test, expect, mock, afterEach } from "bun:test";
import { cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
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
// (household.home_place, backend/src/settings/coreKeys.ts) drives the
// weather-turn assertion below; every other route returns an empty,
// well-formed shape since these tests are about the weather/memories
// cards, not the roster strip or the widget grid.
function stubFetch(options: { homePlace?: string; turnBodies: unknown[] }): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/people")) return Promise.resolve(Response.json([]));
    if (url.includes("/api/memory")) return Promise.resolve(Response.json([]));
    if (url.includes("/api/widgets")) return Promise.resolve(Response.json([]));
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
        ]),
      );
    }
    if (url.includes("/api/settings?scope=person%3A")) return Promise.resolve(Response.json([]));
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

function renderHome() {
  return renderWithQueryClient(
    <I18nProvider i18n={testI18n}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<HomePage person={makePerson()} />} />
          <Route path="/memory" element={<div>The real memories page</div>} />
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
      expect(turnBodies).toEqual([{ surface: "chat", text: "What's the weather like today?" }]);
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
      expect(turnBodies).toEqual([{ surface: "chat", text: "What's the weather like in Portland, OR today?" }]);
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
