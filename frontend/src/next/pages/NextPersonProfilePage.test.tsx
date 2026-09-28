import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { NextPersonProfilePage } from "@/next/pages/NextPersonProfilePage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { MemoryRecord, PersonRosterEntry, Roster } from "@/lib/api";

afterEach(cleanup);

function viewer(overrides: Partial<Roster> = {}): Roster {
  return {
    id: "person-sage", display_name: "Sage", nickname: null, role: "adult", avatar_seed: "person-sage",
    bio: null, accent: null, source: "hub", local_only: false, created_at: "2026-09-05T00:00:00.000Z",
    updated_at: "2026-09-05T00:00:00.000Z", deleted_at: null, enabled: true, guest_expires_at: null,
    memorialized_at: null, hlc: "1788000000000:0:test", hasSecret: true, ...overrides,
  } as Roster;
}

function rosterEntry(overrides: Partial<Roster> = {}): PersonRosterEntry {
  const result = { ...viewer(), sessionLockRequired: false, sessionLockTimeoutMinutes: 0, ...overrides };
  delete (result as Partial<Roster>).hasSecret;
  return result as PersonRosterEntry;
}

function memory(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: "mem-one", record_kind: "memory", text: "Likes dinosaurs", category: "preference", tier: "durable",
    status: "active", scope: "person", person: "person-sage", companion_id: null, subject_id: null,
    source: "chat", importance: 0.5, pinned: false, sensitive: false, child_disclosure: null,
    child_disclosure_set_by: null, child_disclosure_set_at: null, fact_confidence: 0.95, confidence_evidence: [],
    conflicts_with: [], uses: 0, retrieval_feedback: { corrections: 0, last_corrected_at: null },
    created_at: "2026-09-04T00:00:00.000Z", last_used_at: "2026-09-04T00:00:00.000Z", valid_from: null,
    valid_to: null, expired_at: null, superseded_by: null, embedding_space: null, hlc: "1788000000000:0:test",
    deleted_at: null, ...overrides,
  };
}

const people: PersonRosterEntry[] = [
  rosterEntry({ id: "person-sage", display_name: "Sage", role: "owner" }),
  rosterEntry({ id: "person-bramble", display_name: "Bramble", role: "child", bio: "Loves dinosaurs", accent: "teal" }),
  rosterEntry({ id: "person-nova", display_name: "Nova", role: "adult" }),
];

function stubFetch(byPath: Record<string, unknown>) {
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/people")) return Promise.resolve(Response.json(people));
    if (url.includes("/api/files")) return Promise.resolve(Response.json([]));
    if (url.includes("/api/memory")) {
      const matched = Object.entries(byPath).find(([path]) => path !== "/api/people" && url.includes(path));
      const value = matched?.[1] ?? [];
      if (typeof value === "number") return Promise.resolve(new Response("", { status: value }));
      return Promise.resolve(Response.json(value));
    }
    throw new Error(`unstubbed fetch: ${url}`);
  }) as unknown as typeof fetch;
  return () => { globalThis.fetch = original; };
}

function renderProfile(path: string, who: Roster = viewer()) {
  return renderWithQueryClient(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/people/:id" element={<NextPersonProfilePage person={who} onPersonChange={() => {}} />} /></Routes>
    </MemoryRouter>,
  );
}

describe("NextPersonProfilePage", () => {
  test("shows a person's overview and profile details", async () => {
    const restore = stubFetch({});
    try {
      const view = renderProfile("/people/person-bramble", viewer({ role: "owner" }));
      expect(await view.findByText("Bramble")).toBeTruthy();
      expect(view.getByText("Child")).toBeTruthy();
      expect(view.getByText("Loves dinosaurs")).toBeTruthy();
      expect(view.getByText("Bramble's profile in this household.")).toBeTruthy();
    } finally { restore(); }
  });

  test("the signed-in person's own profile has Memories even for a child", async () => {
    const restore = stubFetch({ "/api/memory": [memory()] });
    try {
      const view = renderProfile("/people/person-sage?tab=memories", viewer({ role: "child" }));
      expect(await view.findByText("Likes dinosaurs")).toBeTruthy();
      expect(view.getByRole("tab", { name: "Memories" })).toBeTruthy();
    } finally { restore(); }
  });

  test("an owner sees another person's real memories and their own export/forget actions", async () => {
    const restore = stubFetch({ "/api/memory?person=person-bramble": [memory({ id: "mem-child", text: "Loves dinosaurs", person: "person-bramble" })] });
    try {
      const view = renderProfile("/people/person-bramble?tab=memories", viewer({ role: "owner" }));
      expect(await view.findByText("Loves dinosaurs")).toBeTruthy();
      expect(view.queryByText("My own memory")).toBeNull();
      expect(await view.findByRole("button", { name: "Export Bramble's memories" })).toBeTruthy();
      expect(await view.findByRole("button", { name: "Forget everything about Bramble" })).toBeTruthy();
      expect(view.getByText("preference")).toBeTruthy();
      expect(view.queryByText("preference · person")).toBeNull();
    } finally { restore(); }
  });

  test("a non-admin can view another profile but cannot see its Memories tab", async () => {
    const restore = stubFetch({});
    try {
      const view = renderProfile("/people/person-bramble?tab=memories", viewer({ role: "adult" }));
      expect(await view.findByText("Bramble")).toBeTruthy();
      expect(view.queryByRole("tab", { name: "Memories" })).toBeNull();
      expect(view.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe("true");
    } finally { restore(); }
  });

  test("the ids query filters own memories and the unfiltered link returns to the full list", async () => {
    const restore = stubFetch({ "/api/memory": [memory(), memory({ id: "mem-two", text: "Allergic to peanuts" })] });
    try {
      const view = renderProfile("/people/person-sage?tab=memories&ids=mem-one");
      expect(await view.findByText("Likes dinosaurs")).toBeTruthy();
      expect(view.queryByText("Allergic to peanuts")).toBeNull();
    } finally { restore(); }
  });

  test("unknown ids show a plain not-found state", async () => {
    const restore = stubFetch({});
    try {
      const view = renderProfile("/people/person-missing", viewer({ role: "owner" }));
      expect(await view.findByText("No one in this household has that profile.")).toBeTruthy();
      expect(view.getByRole("link", { name: "Back to People" }).getAttribute("href")).toBe("/people");
    } finally { restore(); }
  });

  test("the owner edit action remains available on self and for a child's profile", async () => {
    const restore = stubFetch({});
    try {
      const self = renderProfile("/people/person-sage", viewer({ role: "owner" }));
      expect(await self.findByRole("button", { name: "Edit" })).toBeTruthy();
      cleanup();
      const other = renderProfile("/people/person-bramble", viewer({ role: "owner" }));
      expect(await other.findByRole("button", { name: "Edit" })).toBeTruthy();
      expect(other.getByRole("link", { name: "Manage in Settings" }).getAttribute("href")).toContain("/settings?tab=household");
    } finally { restore(); }
  });

  test("saving a profile edit updates name, bio, and accent in the roster", async () => {
    let patchBody: unknown = null;
    let currentPeople = people;
    const original = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/people/person-bramble") && init?.method === "PATCH") {
        patchBody = JSON.parse(String(init.body));
        const updated: PersonRosterEntry = { ...currentPeople[1]!, display_name: "Bram", bio: "Loves the beach", accent: "violet" };
        currentPeople = [currentPeople[0]!, updated, currentPeople[2]!];
        return Promise.resolve(Response.json(updated));
      }
      if (url.endsWith("/api/people")) return Promise.resolve(Response.json(currentPeople));
      if (url.includes("/api/files")) return Promise.resolve(Response.json([]));
      throw new Error(`unstubbed fetch: ${url}`);
    }) as unknown as typeof fetch;
    try {
      const view = renderProfile("/people/person-bramble", viewer({ role: "owner" }));
      fireEvent.click(await view.findByRole("button", { name: "Edit" }));
      fireEvent.change(view.getByLabelText("Name"), { target: { value: "Bram" } });
      fireEvent.change(view.getByLabelText("Bio"), { target: { value: "Loves the beach" } });
      await act(async () => { fireEvent.click(view.getByRole("combobox", { name: "Accent color" })); });
      const violet = await view.findByRole("option", { name: "Violet" });
      await act(async () => {
        fireEvent.pointerDown(violet, { pointerId: 1, pointerType: "mouse", button: 0 });
        fireEvent.pointerUp(violet, { pointerId: 1, pointerType: "mouse", button: 0 });
        fireEvent.click(violet);
      });
      await waitFor(() => expect(view.getByRole("combobox", { name: "Accent color" }).textContent).toContain("Violet"));
      await act(async () => { fireEvent.click(view.getByRole("button", { name: "Save" })); });
      await view.findByText("Bram");
      expect(patchBody).toEqual({ displayName: "Bram", bio: "Loves the beach", accent: "violet" });
      expect(view.getByText("Loves the beach")).toBeTruthy();
    } finally { globalThis.fetch = original; }
  });

  test("updates the tab query when changing tabs", async () => {
    const restore = stubFetch({ "/api/memory": [] });
    try {
      const view = renderProfile("/people/person-sage", viewer({ role: "owner" }));
      fireEvent.click(await view.findByRole("tab", { name: "Memories" }));
      expect(await view.findByText("Nothing remembered yet.")).toBeTruthy();
      expect(view.getByRole("tab", { name: "Memories" }).getAttribute("aria-selected")).toBe("true");
    } finally { restore(); }
  });
});
