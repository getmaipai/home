import { describe, expect, test, mock, afterEach } from "bun:test";
import { cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { BackupsPage } from "@/apps/settings/BackupsPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { Roster } from "@/lib/api";

afterEach(cleanup);

function makePerson(role: Roster["role"]): Roster {
  return {
    id: "person-owner",
    display_name: "Sage",
    nickname: null,
    role,
    avatar_seed: "person-owner",
    source: "hub",
    local_only: false,
    created_at: "2026-09-05T00:00:00.000Z",
    updated_at: "2026-09-05T00:00:00.000Z",
    deleted_at: null,
    hasSecret: true,
  };
}

function renderBackupsPage(person: Roster) {
  return renderWithQueryClient(
    <MemoryRouter>
      <BackupsPage person={person} />
    </MemoryRouter>,
  );
}

// Session B step 7 (see ModelsPage.test.tsx's identical reasoning):
// BackupsSection's own dedicated route has to gate itself now that
// nothing else stands between a direct navigation and the page.
describe("BackupsPage - access gate", () => {
  test("a non-admin sees an access message, not the backups UI, and no network call is attempted", () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => {
      throw new Error("BackupsSection must not mount for a non-admin");
    }) as unknown as typeof fetch;
    try {
      const { getByText, queryByText } = renderBackupsPage(makePerson("child"));
      expect(getByText("Only an owner or admin can manage backups.")).toBeTruthy();
      expect(queryByText("Back to Settings")).toBeTruthy();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("an admin sees the real Backups section, not the access message", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/restore/pending")) {
        return Promise.resolve(new Response(JSON.stringify({ pending: null }), { status: 200 }));
      }
      if (url.includes("/backups")) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      return Promise.reject(new Error(`unstubbed fetch: ${url}`));
    }) as unknown as typeof fetch;

    try {
      const { findByText, queryByText } = renderBackupsPage(makePerson("owner"));
      await findByText("No backups yet.");
      expect(queryByText("Only an owner or admin can manage backups.")).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
