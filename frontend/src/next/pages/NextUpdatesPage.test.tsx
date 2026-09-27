import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
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
    reference: null,
    referenceError: null,
    ...overrides,
  } as UpdateProjection;
}

function mockUpdatesFetch(projection: UpdateProjection) {
  const originalFetch = globalThis.fetch;
  const fetchMock = mock((input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
    if (url.endsWith("/apply")) return Promise.resolve(Response.json({ applied: true, tag: "b2", previous: "b1" }));
    if (url.endsWith("/rollback")) return Promise.resolve(Response.json({ ok: true, tag: "b1" }));
    if (url.endsWith("/api/updates")) return Promise.resolve(Response.json(projection));
    return Promise.resolve(new Response("{}", { status: 200 }));
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return {
    fetchMock,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

function stackUpdateProjection(): UpdateProjection {
  return makeProjection({
    stack: {
      checksEnabled: true,
      engines: [{ name: "llama-server", installed: "b1", available: "b2", availableKnown: true, lastChecked: "2026-09-21T00:00:00.000Z", notes: null }],
      models: { lastChecked: null, entries: [] },
    },
  });
}

describe("NextUpdatesPage", () => {
  test("a non-admin sees the denied message, never a fetch", async () => {
    const { restore } = mockUpdatesFetch(makeProjection());
    try {
      renderWithQueryClient(<NextUpdatesPage person={makePerson({ role: "adult" })} />);
      await waitFor(() => expect(document.body.textContent).toContain("Only an owner or admin can manage updates."));
    } finally {
      restore();
    }
  });

  test("Home up to date, no Stack: one real row, no demo data", async () => {
    const { restore } = mockUpdatesFetch(makeProjection({ installed: "0.2.0", latest: "0.2.0" }));
    try {
      renderWithQueryClient(<NextUpdatesPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("MaiPai Home"));
      expect(document.body.textContent).toContain("0.2.0");
      expect(document.body.textContent).toContain("Up to date");
      const homeRow = Array.from(document.querySelectorAll('[data-slot="table-row"]')).find((row) => row.textContent?.includes("MaiPai Home"))!;
      expect(within(homeRow as HTMLElement).queryByRole("button", { name: "More actions" })).toBeNull();
    } finally {
      restore();
    }
  });

  test("a real Stack engine with an available update reads 'Update available'", async () => {
    const { restore } = mockUpdatesFetch(stackUpdateProjection());
    try {
      renderWithQueryClient(<NextUpdatesPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("llama-server"));
      expect(document.body.textContent).toContain("Update available");
      const engineRow = Array.from(document.querySelectorAll('[data-slot="table-row"]')).find((row) => row.textContent?.includes("llama-server"))!;
      expect(within(engineRow as HTMLElement).getByRole("button", { name: "More actions" })).toBeTruthy();
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

  test("Apply calls the engine update endpoint and invalidates the updates query", async () => {
    const { fetchMock, restore } = mockUpdatesFetch(stackUpdateProjection());
    try {
      const view = renderWithQueryClient(<NextUpdatesPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("llama-server"));
      const engineRow = Array.from(document.querySelectorAll('[data-slot="table-row"]')).find((row) => row.textContent?.includes("llama-server"))!;
      fireEvent.click(within(engineRow as HTMLElement).getByRole("button", { name: "More actions" }));
      fireEvent.click(await within(document.body).findByRole("menuitem", { name: "Apply" }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/updates/stack/engines/llama-server/apply"),
        expect.objectContaining({ method: "POST" }),
      ));
      await waitFor(() => expect(fetchMock.mock.calls.filter(([input]) => {
        const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
        return url.endsWith("/api/updates");
      })).toHaveLength(2));
      expect(view.queryClient.getQueryState(["updates"])?.data).toBeTruthy();
    } finally {
      restore();
    }
  });

  test("Go back rolls an engine to its previous tag after confirmation", async () => {
    const { fetchMock, restore } = mockUpdatesFetch(stackUpdateProjection());
    try {
      renderWithQueryClient(<NextUpdatesPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("llama-server"));
      let engineRow = Array.from(document.querySelectorAll('[data-slot="table-row"]')).find((row) => row.textContent?.includes("llama-server"))!;
      fireEvent.click(within(engineRow as HTMLElement).getByRole("button", { name: "More actions" }));
      fireEvent.click(await within(document.body).findByRole("menuitem", { name: "Apply" }));
      await waitFor(() => expect(document.body.textContent).toContain("Go back"));

      engineRow = Array.from(document.querySelectorAll('[data-slot="table-row"]')).find((row) => row.textContent?.includes("llama-server"))!;
      fireEvent.click(within(engineRow as HTMLElement).getByRole("button", { name: "More actions" }));
      fireEvent.click(await within(document.body).findByRole("menuitem", { name: "Go back" }));
      expect(await within(document.body).findByRole("alertdialog")).toBeTruthy();
      fireEvent.click(within(document.body).getByRole("button", { name: "Confirm" }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/updates/stack/engines/llama-server/rollback"),
        expect.objectContaining({ method: "POST", body: JSON.stringify({ tag: "b1" }) }),
      ));
    } finally {
      restore();
    }
  });
});
