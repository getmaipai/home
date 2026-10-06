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

  const robotRow = (overrides: Record<string, unknown> = {}) => ({
    id: "device-1",
    name: "Riff",
    installed: "0.1.0",
    latest: "v0.2.0",
    daemonVersion: "1.4.2",
    updateAvailable: true,
    blockedBy: "Installing robot updates from Home isn't built yet.",
    lastChecked: "2026-09-29T12:00:00.000Z",
    ...overrides,
  });

  test("a paired robot behind the latest Bot release gets its own row with the honest block and no action", async () => {
    const { restore } = mockUpdatesFetch(makeProjection({ robots: [robotRow()] }));
    try {
      renderWithQueryClient(<NextUpdatesPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("Riff"));
      const row = Array.from(document.querySelectorAll('[data-slot="table-row"]')).find((candidate) => candidate.textContent?.includes("Riff"))! as HTMLElement;
      expect(row.textContent).toContain("0.1.0");
      expect(row.textContent).toContain("v0.2.0");
      expect(row.textContent).toContain("body software 1.4.2");
      expect(row.textContent).toContain("Update available");
      expect(row.textContent).toContain("Installing robot updates from Home isn't built yet.");
      expect(within(row).queryByRole("button", { name: "More actions" })).toBeNull();
    } finally {
      restore();
    }
  });

  test("a robot that never reported its MaiPai version reads unknown, never an update", async () => {
    const { restore } = mockUpdatesFetch(makeProjection({ robots: [robotRow({ installed: null, updateAvailable: false, blockedBy: null })] }));
    try {
      renderWithQueryClient(<NextUpdatesPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("Riff"));
      const row = Array.from(document.querySelectorAll('[data-slot="table-row"]')).find((candidate) => candidate.textContent?.includes("Riff"))! as HTMLElement;
      expect(row.textContent).toContain("Unknown");
      expect(row.textContent).not.toContain("Update available");
    } finally {
      restore();
    }
  });

  test("robot and reference check errors keep their copy without invented retry actions", async () => {
    const { restore } = mockUpdatesFetch(makeProjection({
      robots: [robotRow({ latest: null, updateAvailable: false, blockedBy: null })],
      robotsError: "connection refused",
      referenceError: "library unavailable",
    }));
    try {
      const view = renderWithQueryClient(<NextUpdatesPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("Couldn't check for robot updates: connection refused"));
      expect(document.body.textContent).toContain("Couldn't read installed reference sets for updates: library unavailable");
      expect(view.queryByRole("button", { name: "Retry" })).toBeNull();
    } finally {
      restore();
    }
  });

  test("a failed fetch shows an error and retry refetches updates", async () => {
    const originalFetch = globalThis.fetch;
    let updatesCalls = 0;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
      if (url.endsWith("/api/updates")) {
        updatesCalls += 1;
        return Promise.resolve(updatesCalls === 1
          ? new Response(JSON.stringify({ error: "Something broke" }), { status: 500 })
          : Response.json(makeProjection({ installed: "0.3.0", latest: "0.3.0" })));
      }
      return Promise.resolve(Response.json({}));
    }) as unknown as typeof fetch;
    try {
      const view = renderWithQueryClient(<NextUpdatesPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("Something broke"));
      fireEvent.click(view.getByRole("button", { name: "Try again" }));
      await waitFor(() => expect(document.body.textContent).toContain("MaiPai Home"));
      expect(updatesCalls).toBe(2);
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
