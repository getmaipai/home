import { describe, expect, test, mock, afterEach } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { PeoplePage } from "@/apps/people/PeoplePage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { PersonRosterEntry, Roster } from "@/lib/api";

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
    enabled: true,
    guest_expires_at: null,
    memorialized_at: null,
    hlc: "1788000000000:0:test",
  };
}

function signedInPerson(overrides: Partial<Roster> = {}): Roster {
  return { ...member("person-owner", "Sage", "owner"), hasSecret: true, ...overrides };
}

const ROSTER: PersonRosterEntry[] = [
  member("person-owner", "Sage", "owner"),
  member("person-bramble", "Bramble", "child"),
];

function stubApi(extra: Record<string, unknown> = {}) {
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/people")) {
      return Promise.resolve(new Response(JSON.stringify(ROSTER), { status: 200 }));
    }
    for (const [path, value] of Object.entries(extra)) {
      if (url.includes(path)) return Promise.resolve(new Response(JSON.stringify(value), { status: 200 }));
    }
    return Promise.reject(new Error(`unstubbed fetch: ${url}`));
  }) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function renderPeoplePage(path = "/people", person: Roster = signedInPerson()) {
  return renderWithQueryClient(
    <MemoryRouter initialEntries={[path]}>
      <PeoplePage person={person} />
    </MemoryRouter>,
  );
}

// Roster management (add/edit/remove) moved to Settings -> Household ->
// Users (Jesse, 2026-09-06: "the edit part is for USERS, not people") -
// the Household tab is what's left: a plain, read-only directory anyone
// signed in can browse, with no management controls at all. Each row is
// a real link to the person's own profile (owner ruling, "Navigation,
// corrected," 2026-09-20 - Memories moved off the rail and onto a
// person, reached from here).
describe("PeoplePage", () => {
  test("lists everyone in the household, with no edit/remove/add controls", async () => {
    const restore = stubApi();
    try {
      const { findByText, queryByRole, queryByText } = renderPeoplePage();
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

  test("each row is a real link to that person's own profile", async () => {
    const restore = stubApi();
    try {
      const { findByRole } = renderPeoplePage();
      expect(await findByRole("link", { name: /Bramble/ })).toHaveAttribute("href", "/people/person-bramble");
      expect(await findByRole("link", { name: /Sage/ })).toHaveAttribute("href", "/people/person-owner");
    } finally {
      restore();
    }
  });

  // docs/UI.md: "the active tab lives in the URL" - carried over from the
  // retired household-wide MemoryPage.tsx, whose own "People and things"
  // tab moved here (it is household-wide data - a pet, a place - not a
  // specific person's own, so it never belonged on a person's profile).
  describe("the People and things tab lives in the URL", () => {
    function Location() {
      return <div data-testid="location">{useLocation().pathname + useLocation().search}</div>;
    }

    function renderWithLocation(path: string) {
      return renderWithQueryClient(
        <MemoryRouter initialEntries={[path]}>
          <Location />
          <PeoplePage person={signedInPerson()} />
        </MemoryRouter>,
      );
    }

    test("?section=people-and-things opens directly on that tab", async () => {
      const restore = stubApi({ "/api/entities": [], "/api/relationships": [] });
      try {
        const { findByRole } = renderWithLocation("/people?section=people-and-things");
        expect(await findByRole("tab", { name: "People and things", selected: true })).toBeInTheDocument();
      } finally {
        restore();
      }
    });

    test("a stray or unknown ?section= value falls back to Household, not a blank tab", async () => {
      const restore = stubApi();
      try {
        const { findByRole } = renderWithLocation("/people?section=nonsense");
        expect(await findByRole("tab", { name: "Household", selected: true })).toBeInTheDocument();
      } finally {
        restore();
      }
    });

    test("switching tabs updates the URL", async () => {
      const restore = stubApi({ "/api/entities": [], "/api/relationships": [] });
      try {
        const { findByRole, getByTestId } = renderWithLocation("/people");
        // Radix's own TabsTrigger selects on mousedown, not click
        // (@radix-ui/react-tabs).
        fireEvent.mouseDown(await findByRole("tab", { name: "People and things" }), { button: 0 });
        await waitFor(() => expect(getByTestId("location").textContent).toBe("/people?section=people-and-things"));
        fireEvent.mouseDown(await findByRole("tab", { name: "Household" }), { button: 0 });
        await waitFor(() => expect(getByTestId("location").textContent).toBe("/people"));
      } finally {
        restore();
      }
    });
  });
});
