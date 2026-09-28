import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { fetchFamilyBots, NextFamilyPage } from "@/next/pages/NextFamilyPage";
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

function mockFamilyFetch(people: PersonRosterEntry[], pets: unknown[] = [], devices: unknown[] = [], robots: unknown[] = []) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/people")) return Promise.resolve(Response.json(people));
    if (url.includes("/api/entities?kind=pet")) return Promise.resolve(Response.json(pets));
    if (url.includes("/api/devices/robots")) return Promise.resolve(Response.json(robots));
    if (url.includes("/api/devices")) return Promise.resolve(Response.json(devices));
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

function renderFamilyPage(person: Roster, path = "/people") {
  return renderWithQueryClient(
    <MemoryRouter initialEntries={[path]}>
      <NextFamilyPage person={person} />
    </MemoryRouter>,
  );
}

describe("NextFamilyPage", () => {
  test("the directory is a card grid: every household member gets a card with their real name and role", async () => {
    const restore = mockFamilyFetch([
      makeRosterEntry({ id: "p1", display_name: "Nova", role: "owner" }),
      makeRosterEntry({ id: "p2", display_name: "Marlow", role: "teen" }),
      makeRosterEntry({ id: "p3", display_name: "Sage", role: "child" }),
    ]);
    try {
      renderFamilyPage(makePerson({ id: "p1", display_name: "Nova", role: "owner" }));
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
    const restore = mockFamilyFetch([
      makeRosterEntry({ id: "p1", display_name: "Nova", role: "owner" }),
      makeRosterEntry({ id: "p2", display_name: "Marlow", role: "teen" }),
    ]);
    try {
      renderFamilyPage(makePerson({ id: "p2", display_name: "Marlow", role: "teen" }));
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
    const restore = mockFamilyFetch([
      makeRosterEntry({ id: "p1", display_name: "Nova", role: "owner", bio: "Runs this house." }),
      makeRosterEntry({ id: "p2", display_name: "Marlow", role: "teen", bio: null }),
    ]);
    try {
      renderFamilyPage(makePerson({ id: "p1", display_name: "Nova", role: "owner" }));
      await waitFor(() => expect(document.body.textContent).toContain("Runs this house."));
      const cards = Array.from(document.querySelectorAll('[data-slot="card"]'));
      const marlowCard = cards.find((card) => card.textContent?.includes("Marlow"));
      expect(marlowCard?.textContent).not.toContain("Runs this house.");
    } finally {
      restore();
    }
  });

  test("a card links to that person's profile page", async () => {
    const restore = mockFamilyFetch([makeRosterEntry({ id: "p1", display_name: "Nova", role: "owner" })]);
    try {
      renderFamilyPage(makePerson({ id: "p1", display_name: "Nova", role: "owner" }));
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
      renderFamilyPage(makePerson());
      await waitFor(() => expect(document.body.textContent).toContain("Something broke"));
      expect(document.body.textContent).toContain("Try again");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("no data table anywhere on the page, and no vendored demo data", async () => {
    const restore = mockFamilyFetch([makeRosterEntry()]);
    try {
      renderFamilyPage(makePerson());
      await waitFor(() => expect(document.body.textContent).toContain("Nova"));
      const titles = Array.from(document.querySelectorAll('[data-slot="card-title"]')).map((el) => el.textContent);
      expect(titles.some((t) => t?.includes("Family"))).toBe(true);
      expect(document.body.textContent).not.toContain("Employee Data Table");
      expect(document.querySelector('[data-slot="table"]')).toBeNull();
      expect(document.body.textContent).not.toContain("Address Details");
      expect(document.body.textContent).not.toContain("Personal Information");
      expect(document.body.textContent).not.toContain("mathew.anderson@gmail.com");
    } finally {
      restore();
    }
  });

  test("Pets shows confirmed and inferred pets, labeling only the unconfirmed one", async () => {
    const restore = mockFamilyFetch([], [
      { id: "ent-cat001", kind: "pet", name: "Miso", description: "Orange cat", source: "hub", confirmed_by_person_id: "person-abc123" },
      { id: "ent-dog001", kind: "pet", name: "Maybe Dog", description: null, source: "inferred", confirmed_by_person_id: null },
    ]);
    try {
      renderFamilyPage(makePerson(), "/people?tab=pets");
      await waitFor(() => expect(document.body.textContent).toContain("Maybe Dog"));
      expect(document.body.textContent).toContain("Miso");
      const cards = Array.from(document.querySelectorAll('[data-slot="card"]'));
      expect(cards.find((card) => card.textContent?.includes("Miso"))?.textContent).not.toContain("Unconfirmed");
      expect(cards.find((card) => card.textContent?.includes("Maybe Dog"))?.textContent).toContain("Unconfirmed");
      expect(document.body.textContent).toContain("Orange cat");
    } finally { restore(); }
  });

  test("Pets shows the shared empty state when no pets exist", async () => {
    const restore = mockFamilyFetch([], []);
    try {
      renderFamilyPage(makePerson(), "/people?tab=pets");
      await waitFor(() => expect(document.body.textContent).toContain("Nothing here yet."));
    } finally { restore(); }
  });

  test("Bots uses the household robot endpoint for an admin", async () => {
    const restore = mockFamilyFetch([], [], [], [{ id: "robot-1", kind: "robot", name: "Bramble", area: "Kitchen", capabilities: [] }]);
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;
    try {
      renderFamilyPage(makePerson({ role: "admin" }), "/people?tab=bots");
      await waitFor(() => expect(document.body.textContent).toContain("Bramble"));
      expect(document.body.textContent).toContain("Kitchen");
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/devices/robots"), expect.anything());
      expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/api/devices\""), expect.anything());
    } finally { restore(); }
  });

  test("Bots shows the shared empty state when no robots exist", async () => {
    const restore = mockFamilyFetch([], [], [], []);
    try {
      renderFamilyPage(makePerson(), "/people?tab=bots");
      await waitFor(() => expect(document.body.textContent).toContain("Nothing here yet."));
    } finally { restore(); }
  });

  test("Bots filters the caller's devices for a non-admin and hides the trigger", async () => {
    const restore = mockFamilyFetch([], [], [
      { id: "robot-1", kind: "robot", name: "Bramble", area: null, capabilities: [] },
      { id: "phone-1", kind: "phone", name: "Phone", area: null, capabilities: [] },
    ]);
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;
    try {
      const person = makePerson({ role: "child" });
      const view = renderFamilyPage(person, "/people?tab=bots");
      expect(view.queryByRole("tab", { name: "Bots" })).toBeNull();
      expect(view.getByRole("tab", { name: "People" })).toHaveAttribute("aria-selected", "true");
      expect(view.queryByText("Bramble")).toBeNull();
      expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/api/devices"), expect.anything());
      const filtered = await fetchFamilyBots(person);
      expect(filtered.map((device) => device.name)).toEqual(["Bramble"]);
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/devices"), expect.anything());
      expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/api/devices/robots"), expect.anything());
    } finally { restore(); }
  });
});
