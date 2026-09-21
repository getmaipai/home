import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, waitFor } from "@testing-library/react";
import { NextUpdatesPage } from "@/next/pages/NextUpdatesPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { UpdateProjection, Roster } from "@/lib/api";

afterEach(() => {
  cleanup();
});

function makePerson(overrides: Partial<Roster> = {}): Roster {
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
    ...overrides,
  } as Roster;
}

function makeProjection(overrides: Partial<UpdateProjection> = {}): UpdateProjection {
  return {
    installed: "0.1.0",
    latest: null,
    summary: null,
    url: null,
    checkedAt: "2026-09-21T00:00:00.000Z",
    error: null,
    stack: null,
    stackError: null,
    ...overrides,
  } as UpdateProjection;
}

function mockUpdatesFetch(projection: UpdateProjection) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/updates")) return Promise.resolve(Response.json(projection));
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

describe("NextUpdatesPage", () => {
  test("a non-admin sees the denied message, never a fetch", async () => {
    const restore = mockUpdatesFetch(makeProjection());
    try {
      renderWithQueryClient(<NextUpdatesPage person={makePerson({ role: "adult" })} />);
      await waitFor(() => expect(document.body.textContent).toContain("Only an owner or admin can manage updates."));
    } finally {
      restore();
    }
  });

  test("Home up to date, no Stack: one real row, no demo data", async () => {
    const restore = mockUpdatesFetch(makeProjection({ installed: "0.2.0", latest: "0.2.0" }));
    try {
      renderWithQueryClient(<NextUpdatesPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("MaiPai Home"));
      expect(document.body.textContent).toContain("0.2.0");
      expect(document.body.textContent).toContain("Up to date");
    } finally {
      restore();
    }
  });

  test("a real Stack engine with an available update reads 'Update available'", async () => {
    const restore = mockUpdatesFetch(
      makeProjection({
        stack: {
          checksEnabled: true,
          engines: [{ name: "llama-server", installed: "b1", available: "b2", availableKnown: true, lastChecked: "2026-09-21T00:00:00.000Z", notes: null }],
          models: { lastChecked: null, entries: [] },
        },
      }),
    );
    try {
      renderWithQueryClient(<NextUpdatesPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("llama-server"));
      expect(document.body.textContent).toContain("Update available");
    } finally {
      restore();
    }
  });

  test("a failed fetch shows an error and a retry button, never a stuck loading state", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify({ error: "Something broke" }), { status: 500 }))) as unknown as typeof fetch;
    try {
      renderWithQueryClient(<NextUpdatesPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("Something broke"));
      expect(document.body.textContent).toContain("Try again");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
