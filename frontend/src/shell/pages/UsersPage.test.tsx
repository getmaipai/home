import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, waitFor } from "@testing-library/react";
import { UsersPage } from "@/shell/pages/UsersPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { Roster } from "@/lib/api";

afterEach(cleanup);

function makePerson(role: Roster["role"]): Roster {
  return {
    id: "person-abc123",
    display_name: "Nova",
    nickname: null,
    role,
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
  } as Roster;
}

describe("UsersPage", () => {
  test("a non-admin sees the denial and does not fetch the roster", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = mock(() => Promise.resolve(Response.json([])));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const view = renderWithQueryClient(<UsersPage person={makePerson("adult")} />);
      await waitFor(() => expect(view.getByText("Only an owner or admin can manage users.")).toBeTruthy());
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("an owner sees the real UsersSection", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/people")) return Promise.resolve(Response.json([]));
      return Promise.resolve(Response.json({}));
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const view = renderWithQueryClient(<UsersPage person={makePerson("owner")} />);
      await waitFor(() => expect(view.getByText("Add someone")).toBeTruthy());
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/people"), expect.anything());
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
