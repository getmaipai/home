import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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
    bio: null,
    accent: null,
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

function renderPeoplePage(person: Roster) {
  return renderWithQueryClient(
    <MemoryRouter>
      <NextPeoplePage person={person} />
    </MemoryRouter>,
  );
}

describe("NextPeoplePage", () => {
  test("the directory is a card grid: every household member gets a card with their real name and role", async () => {
    const restore = mockPeopleFetch([
      makeRosterEntry({ id: "p1", display_name: "Nova", role: "owner" }),
      makeRosterEntry({ id: "p2", display_name: "Marlow", role: "teen" }),
      makeRosterEntry({ id: "p3", display_name: "Sage", role: "child" }),
    ]);
    try {
      renderPeoplePage(makePerson({ id: "p1", display_name: "Nova", role: "owner" }));
      await waitFor(() => expect(document.body.textContent).toContain("Sage"));
      expect(document.body.textContent).toContain("Nova");
      expect(document.body.textContent).toContain("Marlow");
      expect(document.body.textContent).toContain("Owner");
      expect(document.body.textContent).toContain("Teen");
      expect(document.body.textContent).toContain("Child");
      const cards = document.querySelectorAll('[data-slot="card"]');
      expect(cards.length).toBe(3);
    } finally {
      restore();
    }
  });

  test("the signed-in person's own card leads the grid, not a separate profile block", async () => {
    const restore = mockPeopleFetch([
      makeRosterEntry({ id: "p1", display_name: "Nova", role: "owner" }),
      makeRosterEntry({ id: "p2", display_name: "Marlow", role: "teen" }),
    ]);
    try {
      renderPeoplePage(makePerson({ id: "p2", display_name: "Marlow", role: "teen" }));
      await waitFor(() => expect(document.body.textContent).toContain("Nova"));
      const cards = document.querySelectorAll('[data-slot="card"]');
      expect(cards.length).toBe(2);
      expect(cards[0]?.textContent).toContain("Marlow");
      expect(cards[1]?.textContent).toContain("Nova");
      // Marlow's own name now shows exactly once (the old stacked layout
      // duplicated it: once in the profile block, once as a table row).
      expect(document.body.textContent?.match(/Marlow/g)?.length).toBe(1);
    } finally {
      restore();
    }
  });

  test("a card shows the bio line only when the person set one", async () => {
    const restore = mockPeopleFetch([
      makeRosterEntry({ id: "p1", display_name: "Nova", role: "owner", bio: "Runs this house." }),
      makeRosterEntry({ id: "p2", display_name: "Marlow", role: "teen", bio: null }),
    ]);
    try {
      renderPeoplePage(makePerson({ id: "p1", display_name: "Nova", role: "owner" }));
      await waitFor(() => expect(document.body.textContent).toContain("Runs this house."));
      const cards = Array.from(document.querySelectorAll('[data-slot="card"]'));
      const marlowCard = cards.find((card) => card.textContent?.includes("Marlow"));
      expect(marlowCard?.textContent).not.toContain("Runs this house.");
    } finally {
      restore();
    }
  });

  test("a card links to that person's profile page", async () => {
    const restore = mockPeopleFetch([makeRosterEntry({ id: "p1", display_name: "Nova", role: "owner" })]);
    try {
      renderPeoplePage(makePerson({ id: "p1", display_name: "Nova", role: "owner" }));
      await waitFor(() => expect(document.body.textContent).toContain("Nova"));
      const link = document.querySelector('a[href="/people/p1"]');
      expect(link).not.toBeNull();
    } finally {
      restore();
    }
  });

  test("a failed household fetch shows an error and a retry button, never a stuck loading state", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify({ error: "Something broke" }), { status: 500 }))) as unknown as typeof fetch;
    try {
      renderPeoplePage(makePerson());
      await waitFor(() => expect(document.body.textContent).toContain("Something broke"));
      expect(document.body.textContent).toContain("Try again");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("no data table anywhere on the page, and no vendored demo data", async () => {
    const restore = mockPeopleFetch([makeRosterEntry()]);
    try {
      renderPeoplePage(makePerson());
      await waitFor(() => expect(document.body.textContent).toContain("Nova"));
      const titles = Array.from(document.querySelectorAll('[data-slot="card-title"]')).map((el) => el.textContent);
      expect(titles.some((t) => t?.includes("People"))).toBe(true);
      expect(document.body.textContent).not.toContain("Employee Data Table");
      expect(document.querySelector('[data-slot="table"]')).toBeNull();
      expect(document.body.textContent).not.toContain("Address Details");
      expect(document.body.textContent).not.toContain("Personal Information");
      expect(document.body.textContent).not.toContain("mathew.anderson@gmail.com");
    } finally {
      restore();
    }
  });
});
