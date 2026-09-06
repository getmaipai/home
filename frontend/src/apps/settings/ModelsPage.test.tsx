import { describe, expect, test, mock, afterEach } from "bun:test";
import { cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ModelsPage } from "@/apps/settings/ModelsPage";
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
    hlc: "1788000000000:0:test",
    hasSecret: true,
  };
}

function renderModelsPage(person: Roster) {
  return renderWithQueryClient(
    <MemoryRouter>
      <ModelsPage person={person} />
    </MemoryRouter>,
  );
}

// Session B step 7: ModelsSection moved off the single long Settings
// scroll onto its own route (docs/dev.md's step 7 entry) - the caller
// used to remember to gate it (`canManageBackups ? <ModelsSection /> :
// null` in SettingsPage.tsx); a route reachable by URL has to gate
// itself instead, since nothing else stands between a direct navigation
// and the page.
describe("ModelsPage - access gate", () => {
  test("a non-admin sees an access message, not the models UI, and no network call is attempted", () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => {
      throw new Error("ModelsSection must not mount for a non-admin");
    }) as unknown as typeof fetch;
    try {
      const { getByText, queryByText } = renderModelsPage(makePerson("child"));
      expect(getByText("Only an owner or admin can manage AI models.")).toBeTruthy();
      expect(queryByText("Back to Settings")).toBeTruthy();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("an admin sees the real Models section, not the access message", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/models/selection")) {
        return Promise.resolve(new Response(JSON.stringify({ modelId: null }), { status: 200 }));
      }
      if (url.includes("/engine/status")) {
        return Promise.resolve(
          new Response(JSON.stringify({ kind: "none", modelId: null, pid: null, startedAt: null }), { status: 200 }),
        );
      }
      if (url.includes("/hardware")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              platform: "darwin",
              totalRamGb: 24,
              cpuCount: 14,
              isAppleSilicon: true,
              unifiedMemoryGb: 24,
              cudaDevices: [],
            }),
            { status: 200 },
          ),
        );
      }
      if (url.includes("/models?role=")) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      return Promise.reject(new Error(`unstubbed fetch: ${url}`));
    }) as unknown as typeof fetch;

    try {
      const { findByText, queryByText } = renderModelsPage(makePerson("owner"));
      await findByText("This computer: Apple Silicon, 24 GB memory.");
      expect(queryByText("Only an owner or admin can manage AI models.")).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
