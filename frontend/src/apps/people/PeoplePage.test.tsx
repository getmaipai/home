import { describe, expect, test, mock, afterEach } from "bun:test";
import { cleanup } from "@testing-library/react";
import { PeoplePage } from "@/apps/people/PeoplePage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { PersonRosterEntry } from "@/lib/api";

afterEach(cleanup);

function member(id: string, name: string, role: PersonRosterEntry["role"]): PersonRosterEntry {
  return {
    id,
    display_name: name,
    nickname: null,
    role,
    avatar_seed: id,
    source: "hub",
    local_only: false,
    created_at: "2026-09-05T00:00:00.000Z",
    updated_at: "2026-09-05T00:00:00.000Z",
    deleted_at: null,
    hlc: "1788000000000:0:test",
  };
}

const ROSTER: PersonRosterEntry[] = [
  member("person-owner", "Sage", "owner"),
  member("person-bramble", "Bramble", "child"),
];

function stubApi() {
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/people")) {
      return Promise.resolve(new Response(JSON.stringify(ROSTER), { status: 200 }));
    }
    return Promise.reject(new Error(`unstubbed fetch: ${url}`));
  }) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

// Roster management (add/edit/remove) moved to Settings -> Household ->
// Users (Jesse, 2026-09-06: "the edit part is for USERS, not people") -
// this is what PeoplePage.tsx is left with: a plain, read-only directory
// anyone signed in can browse, with no management controls at all.
describe("PeoplePage", () => {
  test("lists everyone in the household, with no edit/remove/add controls", async () => {
    const restore = stubApi();
    try {
      const { findByText, queryByRole, queryByText } = renderWithQueryClient(<PeoplePage />);
      expect(await findByText("Sage")).toBeTruthy();
      expect(await findByText("Bramble")).toBeTruthy();
      expect(queryByRole("button", { name: /^Edit / })).toBeNull();
      expect(queryByRole("button", { name: /^Remove / })).toBeNull();
      expect(queryByRole("button", { name: "Select people" })).toBeNull();
      expect(queryByText("Add someone")).toBeNull();
    } finally {
      restore();
    }
  });
});
