import { describe, expect, test, mock, afterEach } from "bun:test";
import { cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { VoicesPage } from "@/apps/settings/VoicesPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { Roster } from "@/lib/api";

afterEach(cleanup);

function makePerson(): Roster {
  return {
    id: "person-owner",
    display_name: "Sage",
    nickname: null,
    role: "owner",
    avatar_seed: "person-owner",
    source: "hub",
    local_only: false,
    created_at: "2026-09-05T00:00:00.000Z",
    updated_at: "2026-09-05T00:00:00.000Z",
    deleted_at: null,
    enabled: true,
    guest_expires_at: null,
    memorialized_at: null,
    hlc: "1788000000000:0:test",
    hasSecret: true,
  };
}

// A code review (2026-09-06) found VoicesPage had no heading actually
// saying "Voices" once its own `<Page title="Voices">` wrapper was
// dropped for the nested-route fix (SettingsPage.tsx's <Outlet/>) - its
// two sections are titled "More voices" and "Cloned voices", neither of
// which identifies the page itself, unlike Models/Backups/Commands whose
// single section already carries the exact page name.
describe("VoicesPage", () => {
  test("has its own \"Voices\" heading, not just the two section headings", async () => {
    const person = makePerson();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/voice/catalog")) {
        return Promise.resolve(new Response(JSON.stringify({ entries: [] }), { status: 200 }));
      }
      if (url.includes("/api/voice/cloned")) {
        return Promise.resolve(new Response(JSON.stringify({ voices: [] }), { status: 200 }));
      }
      if (url.includes("/api/settings?scope=")) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      return Promise.reject(new Error(`unstubbed fetch: ${url}`));
    }) as unknown as typeof fetch;

    try {
      const { findByRole } = renderWithQueryClient(
        <MemoryRouter>
          <VoicesPage person={person} />
        </MemoryRouter>,
      );
      expect(await findByRole("heading", { name: "Voices" })).toBeTruthy();
      expect(await findByRole("heading", { name: "More voices" })).toBeTruthy();
      expect(await findByRole("heading", { name: "Cloned voices" })).toBeTruthy();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
