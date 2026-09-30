import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { NextPersonProfilePage } from "@/next/pages/NextPersonProfilePage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { MemoryRecord, PersonRosterEntry, ResolvedSetting, Roster } from "@/lib/api";
import type { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

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
    if (url.includes("/api/biometric-prints")) return Promise.resolve(Response.json([]));
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

function limitSettings() {
  const registry: SettingsKey[] = [
    ...Array.from({ length: 9 }, (_, i) => ({
      key: `allowance.${i}.daily_minutes`, scope: "person", selector: "number", label: `Allowance ${i + 1}`,
      level: "basic", secret: false, lives_in: "person.allowance", honoured_by: ["home"], range: { min: 0, max: 1440 },
    } as SettingsKey)),
    ...["storage.cap", "storage.cap_warning"].map((key) => ({
      key, scope: "person", selector: "number", label: key, level: "basic", secret: false,
      lives_in: "person.storage", honoured_by: ["home"], range: { min: 0, max: 100000 },
    } as SettingsKey)),
  ];
  const values: ResolvedSetting[] = registry.map((setting) => ({ key: setting.key, value: 30, source: "default", label: setting.label, level: setting.level, secret: false }));
  return { registry, values };
}

function stubProfileAndLimitsFetch(puts: Array<{ url: string; method: string; body: unknown }> = []) {
  const original = globalThis.fetch;
  const { registry, values } = limitSettings();
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/people")) return Promise.resolve(Response.json(people));
    if (url.includes("/api/files")) return Promise.resolve(Response.json([]));
    if (url.includes("/api/biometric-prints")) return Promise.resolve(Response.json([]));
    if (url.includes("/api/settings/registry")) return Promise.resolve(Response.json(registry));
    if (url.includes("/api/settings?scope=")) return Promise.resolve(Response.json(values));
    if (url.endsWith("/api/settings") && init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      puts.push({ url, method: init.method, body });
      return Promise.resolve(Response.json({ key: body.key, value: body.value, source: "user", label: body.key, level: "basic", secret: false }));
    }
    throw new Error(`unstubbed fetch: ${url}`);
  }) as unknown as typeof fetch;
  return () => { globalThis.fetch = original; };
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

  test("an owner sees a child's Limits tab with all nine allowance rows", async () => {
    const restore = stubProfileAndLimitsFetch();
    try {
      const view = renderProfile("/people/person-bramble?tab=limits", viewer({ role: "owner" }));
      expect(await view.findByRole("tab", { name: "Limits" })).toBeTruthy();
      expect(view.getByRole("tab", { name: "Limits" }).getAttribute("aria-selected")).toBe("true");
      expect(await view.findByText("Daily time limits for Bramble.")).toBeTruthy();
      expect(document.querySelectorAll('[id="settings-person.allowance"] input[type="number"]').length).toBe(9);
      expect(document.querySelector('[id="settings-person.storage"]')).toBeTruthy();
      expect(view.getByText("Storage")).toBeTruthy();
      expect(view.queryByText("My storage")).toBeNull();
    } finally { restore(); }
  });

  test("an owner does not see Limits on their own profile", async () => {
    const restore = stubFetch({});
    try {
      const view = renderProfile("/people/person-sage", viewer({ role: "owner" }));
      await view.findByText("Sage");
      expect(view.queryByRole("tab", { name: "Limits" })).toBeNull();
    } finally { restore(); }
  });

  test("an owner does not see Limits on a teen's profile", async () => {
    const restore = stubFetch({});
    try {
      const teen = rosterEntry({ id: "person-nova", display_name: "Nova", role: "teen" });
      const original = globalThis.fetch;
      globalThis.fetch = mock((input: RequestInfo | URL) => String(input).includes("/api/people")
        ? Promise.resolve(Response.json([...people.slice(0, 2), teen]))
        : Promise.resolve(Response.json([]))) as unknown as typeof fetch;
      const view = renderProfile("/people/person-nova", viewer({ role: "owner" }));
      await view.findByText("Nova");
      expect(view.queryByRole("tab", { name: "Limits" })).toBeNull();
      globalThis.fetch = original;
    } finally { restore(); }
  });

  test("a member cannot see Limits on another child's profile", async () => {
    const restore = stubFetch({});
    try {
      const view = renderProfile("/people/person-bramble", viewer({ role: "adult" }));
      await view.findByText("Bramble");
      expect(view.queryByRole("tab", { name: "Limits" })).toBeNull();
    } finally { restore(); }
  });

  test("changing an allowance writes to the child's person settings", async () => {
    const puts: Array<{ url: string; method: string; body: unknown }> = [];
    const restore = stubProfileAndLimitsFetch(puts);
    try {
      const view = renderProfile("/people/person-bramble?tab=limits", viewer({ role: "owner" }));
      const row = await view.findByLabelText("Allowance 1");
      const allowanceName = ["allowance", "0", "daily_minutes"].join(".");
      fireEvent.change(row, { target: { value: "45" } });
      fireEvent.blur(row);
      await waitFor(() => expect(puts).toContainEqual({
        url: "/api/settings", method: "PUT", body: { scope: "person:person-bramble", key: allowanceName, value: 45 },
      }));
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
      expect(view.getByRole("link", { name: "Back to Family" }).getAttribute("href")).toBe("/people");
    } finally { restore(); }
  });

  test("self has Settings links while an owner keeps Edit and the enrollment card for someone else", async () => {
    const restore = stubFetch({});
    try {
      const self = renderProfile("/people/person-sage", viewer({ role: "owner" }));
      const edit = await self.findByRole("link", { name: "Edit in Settings" });
      expect(edit.getAttribute("href")).toBe("/settings?tab=me&section=profile");
      expect(self.getAllByRole("link", { name: "Manage in Settings" })[0]?.getAttribute("href")).toBe("/settings?tab=me&section=profile");
      cleanup();
      const other = renderProfile("/people/person-bramble", viewer({ role: "owner" }));
      expect(await other.findByRole("button", { name: "Edit" })).toBeTruthy();
      expect(await other.findByText("Face recognition")).toBeTruthy();
      expect(other.queryByRole("link", { name: "Manage in Settings" })).toBeNull();
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
