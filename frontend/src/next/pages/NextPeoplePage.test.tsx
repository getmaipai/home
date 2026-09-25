import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, waitFor } from "@testing-library/react";
import { NextPeoplePage } from "@/next/pages/NextPeoplePage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { PersonRosterEntry, Roster } from "@/lib/api";

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

function makeRosterEntry(overrides: Partial<PersonRosterEntry> = {}): PersonRosterEntry {
  const person = makePerson(overrides);
  const rest: Partial<Roster> = { ...person };
  delete rest.hasSecret;
  return rest as PersonRosterEntry;
}

function mockPeopleFetch(people: PersonRosterEntry[]) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/people")) return Promise.resolve(Response.json(people));
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

describe("NextPeoplePage", () => {
  test("the signed-in person's own profile: name, role, and the real 'own profile' copy", async () => {
    const restore = mockPeopleFetch([makeRosterEntry()]);
    try {
      renderWithQueryClient(<NextPeoplePage person={makePerson({ display_name: "Marlow", role: "teen" })} />);
      await waitFor(() => expect(document.body.textContent).toContain("Marlow"));
      expect(document.body.textContent).toContain("Teen");
      expect(document.body.textContent).toContain("This is your own profile.");
    } finally {
      restore();
    }
  });

  test("a failed household fetch shows an error and a retry button, never a stuck loading state", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify({ error: "Something broke" }), { status: 500 }))) as unknown as typeof fetch;
    try {
      renderWithQueryClient(<NextPeoplePage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("Something broke"));
      expect(document.body.textContent).toContain("Try again");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("real household rows: name and role, not the vendored demo data", async () => {
    const restore = mockPeopleFetch([
      makeRosterEntry({ id: "p1", display_name: "Nova", role: "owner" }),
      makeRosterEntry({ id: "p2", display_name: "Marlow", role: "teen" }),
      makeRosterEntry({ id: "p3", display_name: "Sage", role: "child" }),
    ]);
    try {
      renderWithQueryClient(<NextPeoplePage person={makePerson({ id: "p1", display_name: "Nova", role: "owner" })} />);
      await waitFor(() => expect(document.body.textContent).toContain("Sage"));
      expect(document.body.textContent).toContain("Child");
      expect(document.body.textContent).toContain("Marlow");
      // "Teen" appears twice (own-profile card and table row) when
      // viewing as a teen elsewhere, but here the signed-in person is
      // the owner - "Owner" appears from the profile card, "Teen" only
      // from Marlow's own table row.
      expect(document.body.textContent).toContain("Teen");
      expect(document.body.textContent).toContain("Owner");
    } finally {
      restore();
    }
  });

  test("the roster table has only Name and Role columns, with no demo title or Action column", async () => {
    const restore = mockPeopleFetch([makeRosterEntry()]);
    try {
      renderWithQueryClient(<NextPeoplePage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("Nova"));
      const titles = Array.from(document.querySelectorAll('[data-slot="card-title"]')).map((el) => el.textContent);
      expect(titles.some((t) => t?.includes("People"))).toBe(true);
      expect(document.body.textContent).not.toContain("Employee Data Table");
      const rosterTable = document.querySelector('[data-slot="table"]');
      expect(rosterTable).not.toBeNull();
      const headers = Array.from(rosterTable!.querySelectorAll('[data-slot="table-head"]')).map((el) => el.textContent?.trim());
      expect(headers).toEqual(["Name", "Role"]);
      expect(headers).not.toContain("Action");
    } finally {
      restore();
    }
  });

  test("no vendored social links, position, or address fields - Home has no counterpart for them", async () => {
    const restore = mockPeopleFetch([makeRosterEntry()]);
    try {
      renderWithQueryClient(<NextPeoplePage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("Nova"));
      expect(document.body.textContent).not.toContain("Address Details");
      expect(document.body.textContent).not.toContain("Personal Information");
      expect(document.body.textContent).not.toContain("mathew.anderson@gmail.com");
    } finally {
      restore();
    }
  });
});
