import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FamilyPage } from "@/shell/pages/FamilyPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { PersonRosterEntry, Roster } from "@/lib/api";
import { Tour } from "@maipai/spec/gen/ts/tour.js";
import defaultManifest from "../../../../backend/packages/default/manifest.json";

afterEach(cleanup);

function makePerson(overrides: Partial<Roster> = {}): Roster {
  return { id: "p1", display_name: "Sage", nickname: null, role: "owner", avatar_seed: "p1", bio: null, accent: null, source: "hub", local_only: false, created_at: "2026-09-04T00:00:00.000Z", updated_at: "2026-09-04T00:00:00.000Z", deleted_at: null, enabled: true, guest_expires_at: null, memorialized_at: null, hlc: "1788000000000:0:test", hasSecret: true, ...overrides } as Roster;
}

function entry(overrides: Partial<PersonRosterEntry> = {}): PersonRosterEntry {
  return { ...makePerson(), sessionLockRequired: false, sessionLockTimeoutMinutes: 0, age_band: "adult", ...overrides } as PersonRosterEntry;
}

function mockFamilyFetch(people: PersonRosterEntry[], pets: unknown[] = [], robots: unknown[] = [], companions: unknown[] = [], detail: unknown = null) {
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/people")) return Promise.resolve(Response.json(people));
    if (url.includes("/api/entities?kind=pet")) return Promise.resolve(Response.json(pets));
    if (url.includes("/api/devices/robots")) return Promise.resolve(Response.json(robots));
    if (url.endsWith("/api/companions")) return Promise.resolve(Response.json({ allowed: true, can_create: false, can_discover: false, default_id: "", companions, discover: [], robots: [] }));
    if (url.endsWith("/api/companions/c1")) return Promise.resolve(Response.json(detail));
    return Promise.resolve(Response.json([]));
  }) as unknown as typeof fetch;
  return () => { globalThis.fetch = original; };
}

function render(person: Roster, path = "/people") {
  return renderWithQueryClient(<MemoryRouter initialEntries={[path]}><FamilyPage person={person} /></MemoryRouter>);
}

test("the People tour validates and opens on the family directory", async () => {
  const tour = defaultManifest.contributes.tours[2]!;
  expect(Tour.safeParse(tour).success).toBe(true);
  const restore = mockFamilyFetch([entry()]);
  try {
    const view = render(makePerson());
    await waitFor(() => expect(view.getByRole("heading", { name: "Family" })).toBeTruthy());
    expect(view.getByTestId("family-person-p1")).toBeTruthy();
  } finally { restore(); }
});

test("the family page shows each person and their assigned companion chip", async () => {
  const companion = { id: "c1", name: "Clover", type: "adult", type_label: "Adult", tagline: "A friend", who_can_use: "Everyone", dials: [], voice: "", is_default: true, is_household: true, portrait: null, status: "ready", chats: 0, can_edit: false, can_copy: false };
  const detail = { ...companion, about: "", pronouns: null, interests: [], examples: [], voice_value: "", voice_is_own: false, voice_setting: null, used_by: { people: [{ id: "p1", name: "Sage" }], robots: [] } };
  const restore = mockFamilyFetch([entry(), entry({ id: "p2", display_name: "Marlow", role: "teen", age_band: "teen" })], [], [], [companion], detail);
  try {
    const view = render(makePerson());
    await waitFor(() => expect(view.getByText("Clover")).toBeTruthy());
    expect(view.getByTestId("family-person-p1").textContent).toContain("Companion");
    expect(view.getByTestId("family-person-p2").textContent).toContain("Marlow");
    expect(view.queryByRole("link", { name: /companions/i })).toBeNull();
  } finally { restore(); }
});

test("owners cannot open a teen profile, while the teen can open their own", async () => {
  const roster = [entry(), entry({ id: "p2", display_name: "Marlow", role: "teen", age_band: "teen" }), entry({ id: "p3", display_name: "Nova", role: "child", age_band: "child" })];
  const restore = mockFamilyFetch(roster);
  try {
    render(makePerson());
    await waitFor(() => expect(document.querySelector('[data-testid="family-person-p2"]')).toBeTruthy());
    expect(document.querySelector('a[href="/people/p3"]')).not.toBeNull();
    expect(document.querySelector('a[href="/people/p2"]')).toBeNull();
  } finally { restore(); cleanup(); }
  const restoreTeen = mockFamilyFetch(roster);
  try {
    render(makePerson({ id: "p2", display_name: "Marlow", role: "teen" }));
    await waitFor(() => expect(document.querySelector('a[href="/people/p2"]')).toBeTruthy());
  } finally { restoreTeen(); }
});

test("pets and robots appear as family members only when the household has them", async () => {
  const restore = mockFamilyFetch([entry()], [
    { id: "pet1", kind: "pet", name: "Miso", description: "Orange cat", source: "hub", confirmed_by_person_id: "p1" },
  ], [{ id: "robot1", kind: "robot", name: "Rover", area: "Living room", online: true, capabilities: [] }]);
  try {
    const view = render(makePerson());
    await waitFor(() => expect(view.getByTestId("family-pet-pet1")).toBeTruthy());
    expect(view.getByTestId("family-robot-robot1").textContent).toContain("Online");
    expect(view.getByText("Pets and robots")).toBeTruthy();
  } finally { restore(); }
  cleanup();
  const restoreEmpty = mockFamilyFetch([entry()]);
  try {
    const view = render(makePerson());
    await waitFor(() => expect(view.getByTestId("family-person-p1")).toBeTruthy());
    await waitFor(() => expect(view.queryByText("Loading family members")).toBeNull());
    expect(view.queryByText("Pets and robots")).toBeNull();
  } finally { restoreEmpty(); }
});

test("a failed household fetch offers retry", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify({ error: "Something broke" }), { status: 500 }))) as unknown as typeof fetch;
  try {
    render(makePerson());
    await waitFor(() => expect(document.body.textContent).toContain("Try again"));
  } finally { globalThis.fetch = original; }
});
