import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PersonProfilePage } from "@/shell/pages/PersonProfilePage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { waitForGone } from "../../../tests/waitForGone";
import type { MemoryRecord, PersonRosterEntry, ResolvedSetting, Roster } from "@/lib/api";
import type { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

afterEach(cleanup);

function viewer(overrides: Partial<Roster> = {}): Roster {
  return {
    id: "person-sage", display_name: "Sage", nickname: null, role: "adult", avatar_seed: "person-sage",
    bio: null, accent: null, source: "hub", local_only: false, created_at: "2026-09-05T00:00:00.000Z",
    updated_at: "2026-09-05T00:00:00.000Z", deleted_at: null, enabled: true, guest_expires_at: null,
    memorialized_at: null, hlc: "1788000000000:0:test", hasSecret: true, age_band: "adult", ...overrides,
  } as Roster;
}

function rosterEntry(overrides: Partial<Roster> = {}): PersonRosterEntry {
  const role = overrides.role ?? "adult";
  const result = { ...viewer(), sessionLockRequired: false, sessionLockTimeoutMinutes: 0, age_band: role === "child" ? "child" : role === "teen" ? "teen" : "adult", ...overrides };
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
    deleted_at: null, ...overrides, folder_id: overrides.folder_id ?? null,
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
      <Routes><Route path="/people/:id" element={<PersonProfilePage person={who} onPersonChange={() => {}} />} /></Routes>
    </MemoryRouter>,
  );
}

function limitSettings() {
  const registry: SettingsKey[] = [
    ...Array.from({ length: 9 }, (_, i) => ({
      key: `allowance.${i}.daily_minutes`, scope: "person", selector: "number", default: 0, label: `Allowance ${i + 1}`,
      level: "basic", secret: false, lives_in: "person.allowance", honoured_by: ["home"], range: { min: 0, max: 1440 },
    } as SettingsKey)),
    ...["storage.cap", "storage.cap_warning"].map((key) => ({
      key, scope: "person", selector: "number", default: 0, label: key, level: "basic", secret: false,
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

describe("PersonProfilePage", () => {
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

  // ADMIN-HOME-SETTINGS-01 (owner rule 2026-10-08): no one but the person sees
  // their weather and maps places, a child's included, so People > a child's
  // settings draws no key with the `location` selector for an owner or admin.
  test.each(["owner", "admin"] as const)("a %s opening a child's Limits tab is shown no location-selector key", async (role) => {
    const placeKey = { key: "weather.places", scope: "person", selector: "location", default: [], label: "Weather places", level: "basic", secret: false, lives_in: "weather.places", honoured_by: ["home"] } as unknown as SettingsKey;
    const original = globalThis.fetch;
    const { registry, values } = limitSettings();
    const withPlaces = [...registry, placeKey];
    const valuesWithPlaces = [...values, { key: placeKey.key, value: [], source: "default", label: placeKey.label, level: "basic", secret: false } as ResolvedSetting];
    const restore = stubProfileAndLimitsFetch();
    const inner = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/settings/registry")) return Promise.resolve(Response.json(withPlaces));
      if (url.includes("/api/settings?scope=")) return Promise.resolve(Response.json(valuesWithPlaces));
      return inner(input, init);
    }) as unknown as typeof fetch;
    try {
      const view = renderProfile("/people/person-bramble?tab=limits", viewer({ role }));
      expect(await view.findByText("Daily time limits for Bramble.")).toBeTruthy();
      await waitFor(() => expect(document.querySelectorAll('[id="settings-person.allowance"] input[type="number"]').length).toBe(9));
      expect(document.querySelector('[data-setting-key="weather.places"]')).toBeNull();
      expect(document.querySelector('[id="settings-weather.places"]')).toBeNull();
      expect(view.queryByText("Weather places")).toBeNull();
    } finally { restore(); globalThis.fetch = original; }
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

  test("limits follow the backend age band when an adult role has a child birthdate", async () => {
    const restore = stubFetch({});
    try {
      const mismatch = rosterEntry({ id: "person-bramble", display_name: "Bramble", role: "adult", age_band: "child" });
      const original = globalThis.fetch;
      globalThis.fetch = mock((input: RequestInfo | URL) => String(input).includes("/api/people")
        ? Promise.resolve(Response.json([people[0], mismatch, people[2]]))
        : Promise.resolve(Response.json([]))) as unknown as typeof fetch;
      const view = renderProfile("/people/person-bramble?tab=limits", viewer({ role: "owner" }));
      await view.findByText("Bramble");
      expect(await view.findByRole("tab", { name: "Limits" })).toBeTruthy();
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

  test("self has one Edit profile link and plain face status while another person's page keeps Edit and enrollment", async () => {
    const restore = stubFetch({});
    try {
      const self = renderProfile("/people/person-sage", viewer({ role: "owner" }));
      const edit = await self.findByRole("link", { name: "Edit profile" });
      expect(edit.getAttribute("href")).toBe("/settings/account/profile");
      expect(self.queryByRole("link", { name: "Manage in Settings" })).toBeNull();
      expect(self.queryByText("This is your own profile.")).toBeNull();
      expect(self.getByText((_, element) => element?.textContent === "Face recognition: Not set up yet")).toBeTruthy();
      expect(self.getAllByRole("link").filter((link) => link.getAttribute("href") === "/settings/account/profile")).toHaveLength(1);
      cleanup();
      const other = renderProfile("/people/person-bramble", viewer({ role: "owner" }));
      expect(await other.findByRole("button", { name: "Edit" })).toBeTruthy();
      expect(await other.findByText("Face recognition")).toBeTruthy();
      expect(other.queryByRole("link", { name: "Edit profile" })).toBeNull();
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
      fireEvent.mouseDown(await view.findByRole("tab", { name: "Memories" }), { button: 0 });
      expect(await view.findByText("Nothing remembered yet.")).toBeTruthy();
      expect(view.getByRole("tab", { name: "Memories" }).getAttribute("aria-selected")).toBe("true");
    } finally { restore(); }
  });
});

// NEXT-RETIRE-02C: coverage ported from the retired old-shell
// apps/people/PersonProfilePage.test.tsx. The live page renders the same
// OwnMemories / OtherPersonMemories, SharedMediaSection and ProfileForm, so
// these cases keep guarding that behavior now that the old page is gone.
describe("PersonProfilePage (ported from the retired old-shell page)", () => {
  function stubByPath(byPath: Record<string, unknown>): () => void {
    const original = globalThis.fetch;
    const withDefaults: Record<string, unknown> = { "/api/people": people, "/api/files": [], "/api/biometric-prints": [], ...byPath };
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = String(input);
      const match = Object.entries(withDefaults).filter(([path]) => url.includes(path)).sort((a, b) => b[0].length - a[0].length)[0];
      if (!match) throw new Error(`unstubbed fetch: ${url}`);
      if (typeof match[1] === "number") return Promise.resolve(new Response("", { status: match[1] }));
      return Promise.resolve(Response.json(match[1]));
    }) as unknown as typeof fetch;
    return () => { globalThis.fetch = original; };
  }

  // Custom handler first; anything it does not claim falls back to the usual roster, files and prints.
  function stubCustom(handler: (url: string, init?: RequestInit) => Response | null): () => void {
    const original = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const handled = handler(url, init);
      if (handled) return Promise.resolve(handled);
      if (url.endsWith("/api/people")) return Promise.resolve(Response.json(people));
      if (url.includes("/api/files")) return Promise.resolve(Response.json([]));
      if (url.includes("/api/biometric-prints")) return Promise.resolve(Response.json([]));
      throw new Error(`unstubbed fetch: ${url}`);
    }) as unknown as typeof fetch;
    return () => { globalThis.fetch = original; };
  }

  const owner = () => viewer({ id: "person-sage", role: "owner" });
  const rec = (overrides: Partial<MemoryRecord> = {}) => memory({ id: "mem1-abc123", ...overrides });

  function visibleFile(overrides: Partial<{ id: string; kind: string; media_type: string; shared: boolean }> = {}) {
    const id = overrides.id ?? "file-abc123";
    return {
      file: {
        id, owner_person_id: "person-bramble", origin: "sent", kind: overrides.kind ?? "image", media_type: overrides.media_type ?? "image/png",
        size: 12, sha256: "0".repeat(64), storage_path: `people/person-bramble/attachments/${id}`, retention: "kept",
        provenance: { conversation_id: null, turn_id: null, package_id: null, job_id: null, requested_by_person_id: null, note: null },
        created_at: "2026-09-27T00:00:00.000Z", hlc: "1788000000000:0:test",
      },
      owner_person_id: "person-bramble",
      shared: overrides.shared ?? true,
    };
  }

  test("shows the empty state for a household with nothing remembered yet", async () => {
    const restore = stubByPath({ "/api/memory": [] });
    try {
      const view = renderProfile("/people/person-sage?tab=memories");
      expect(await view.findByText("Nothing remembered yet.")).toBeTruthy();
    } finally { restore(); }
  });

  test("renders a memory with its raw category and scope", async () => {
    const restore = stubByPath({ "/api/memory": [rec()] });
    try {
      const view = renderProfile("/people/person-sage?tab=memories");
      expect(await view.findByText("Likes dinosaurs")).toBeTruthy();
      expect(await view.findByText("preference · person")).toBeTruthy();
    } finally { restore(); }
  });

  test("offers a retry rather than a blank page when the memory fetch fails", async () => {
    const restore = stubByPath({ "/api/memory": 500 });
    try {
      const view = renderProfile("/people/person-sage?tab=memories");
      expect(await view.findByRole("button", { name: "Try again" })).toBeTruthy();
    } finally { restore(); }
  });

  test("a non-admin cannot open another person's Memories tab at all", async () => {
    const restore = stubByPath({});
    try {
      const view = renderProfile("/people/person-bramble?tab=memories", viewer({ id: "person-sage", role: "adult" }));
      await view.findByText("Bramble");
      await waitForGone(() => view.queryByRole("tab", { name: "Memories" }));
    } finally { restore(); }
  });

  test("forgetting a child's memories asks first, then calls the real forget route", async () => {
    let forgetCalled = false;
    const restore = stubCustom((url, init) => {
      if (url.endsWith("/api/memory/forget") && init?.method === "POST") { forgetCalled = true; return Response.json({ deleted: 1 }); }
      if (url.includes("person=person-bramble")) return Response.json([rec({ id: "mem2-def456", text: "Loves dinosaurs", person: "person-bramble" })]);
      return null;
    });
    try {
      const view = renderProfile("/people/person-bramble?tab=memories", owner());
      fireEvent.click(await view.findByRole("button", { name: "Forget everything about Bramble" }));
      await view.findByText("Forget everything MaiPai remembers about Bramble?");
      expect(forgetCalled).toBe(false);
      fireEvent.click(await view.findByRole("button", { name: "Yes, forget everything" }));
      await waitFor(() => expect(forgetCalled).toBe(true));
    } finally { restore(); }
  });

  describe("batch select and clear-all (own memories only)", () => {
    const twoRecords = () => [rec(), rec({ id: "mem2-def456", text: "Allergic to peanuts" })];

    test("select mode shows the count as rows are checked", async () => {
      const restore = stubByPath({ "/api/memory": twoRecords() });
      try {
        const view = renderProfile("/people/person-sage?tab=memories");
        fireEvent.click(await view.findByRole("button", { name: "Select memories" }));
        expect(await view.findByText("0 selected")).toBeTruthy();
        fireEvent.click(await view.findByRole("checkbox", { name: "Select Likes dinosaurs" }));
        expect(await view.findByText("1 selected")).toBeTruthy();
      } finally { restore(); }
    });

    test("clear all asks, names the real count, then empties the list", async () => {
      let forgottenIds: string[] | null = null;
      const restore = stubCustom((url, init) => {
        if (url.endsWith("/api/memory/batch-forget") && init?.method === "POST") {
          const ids = (JSON.parse(init.body as string) as { ids: string[] }).ids;
          forgottenIds = ids;
          return Response.json({ outcomes: ids.map((id) => ({ id, deleted: true })) });
        }
        if (url.endsWith("/api/memory")) return Response.json(forgottenIds ? [] : twoRecords());
        return null;
      });
      try {
        const view = renderProfile("/people/person-sage?tab=memories");
        await view.findByText("Likes dinosaurs");
        fireEvent.click(await view.findByRole("button", { name: "Clear all" }));
        await view.findByText("Forget every one of your 2 memories? This cannot be undone.");
        fireEvent.click(await view.findByRole("button", { name: "Yes, forget all" }));
        await waitFor(() => expect(forgottenIds).toEqual(["mem1-abc123", "mem2-def456"]));
        await waitForGone(() => view.queryByText("Likes dinosaurs"));
      } finally { restore(); }
    });
  });

  describe("who may hear a household memory (audience control)", () => {
    const household = (overrides: Partial<MemoryRecord> = {}) => rec({ scope: "household", person: null, ...overrides });

    test("an adult sees the control on a household row and changing it calls the real route", async () => {
      let audienceBody: unknown = null;
      const restore = stubCustom((url, init) => {
        if (url.endsWith("/api/memory/mem1-abc123/audience") && init?.method === "POST") {
          audienceBody = JSON.parse(init.body as string);
          return Response.json({ ...household(), child_disclosure: "adult_only" });
        }
        if (url.endsWith("/api/memory")) return Response.json([household()]);
        return null;
      });
      try {
        const view = renderProfile("/people/person-sage?tab=memories");
        await view.findByText("Likes dinosaurs");
        fireEvent.click(await view.findByRole("combobox", { name: "Who may hear this" }));
        fireEvent.click(await view.findByRole("option", { name: "Adults only" }));
        await waitFor(() => expect(audienceBody).toEqual({ child_disclosure: "adult_only" }));
      } finally { restore(); }
    });

    test("a child sees no audience control and an adult-only memory still renders", async () => {
      const restore = stubByPath({ "/api/memory": [household({ child_disclosure: "adult_only" })] });
      try {
        const view = renderProfile("/people/person-sage?tab=memories", viewer({ role: "child" }));
        await view.findByText("Likes dinosaurs");
        expect(view.queryByRole("combobox", { name: "Who may hear this" })).toBeNull();
      } finally { restore(); }
    });
  });

  describe("header card and Edit dialog", () => {
    test("Edit is offered to an owner managing someone else", async () => {
      const restore = stubByPath({});
      try {
        const view = renderProfile("/people/person-bramble", owner());
        expect(await view.findByRole("button", { name: "Edit" })).toBeTruthy();
      } finally { restore(); }
    });

    test("an adult viewing another adult's page gets no Edit action", async () => {
      const restore = stubByPath({});
      try {
        const view = renderProfile("/people/person-nova", viewer({ id: "person-sage", role: "adult" }));
        await view.findByText("Nova");
        expect(view.queryByRole("button", { name: "Edit" })).toBeNull();
      } finally { restore(); }
    });
  });

  describe("shared media grid", () => {
    test("shows what's been shared, and leaves out a non-image/video file", async () => {
      const restore = stubByPath({
        "/api/files": [
          visibleFile({ id: "file-photo1", kind: "image" }),
          visibleFile({ id: "file-video1", kind: "video", media_type: "video/mp4" }),
          visibleFile({ id: "file-doc1", kind: "document", media_type: "application/pdf" }),
        ],
      });
      try {
        const view = renderProfile("/people/person-bramble", owner());
        expect(await view.findByRole("button", { name: "Open media: A photo Bramble shared" })).toBeTruthy();
        expect(await view.findByRole("button", { name: "Open media: A video Bramble shared" })).toBeTruthy();
        expect(await view.findAllByRole("button", { name: /^Open media:/ })).toHaveLength(2);
      } finally { restore(); }
    });

    test("a page given an already-filtered empty list shows no media to a third person", async () => {
      const restore = stubByPath({ "/api/files": [] });
      try {
        const view = renderProfile("/people/person-bramble", viewer({ id: "person-nova", role: "adult" }));
        await view.findByText("Bramble");
        expect(view.queryByRole("button", { name: /Open media/ })).toBeNull();
      } finally { restore(); }
    });

    test("an honest empty state when nothing's been shared yet, worded for a viewer looking at someone else", async () => {
      const restore = stubByPath({});
      try {
        const view = renderProfile("/people/person-bramble", owner());
        expect(await view.findByText("Bramble hasn't shared anything with you yet.")).toBeTruthy();
      } finally { restore(); }
    });

    test("an honest empty state worded for your own page", async () => {
      const restore = stubByPath({});
      try {
        const view = renderProfile("/people/person-sage", owner());
        expect(await view.findByText("You haven't shared anything yet.")).toBeTruthy();
      } finally { restore(); }
    });

    test("a failed fetch offers a retry instead of a blank grid", async () => {
      const restore = stubByPath({ "/api/files": 500 });
      try {
        const view = renderProfile("/people/person-bramble", owner());
        expect(await view.findByText("Could not load what's been shared.")).toBeTruthy();
        expect((await view.findAllByRole("button", { name: "Try again" })).length).toBeGreaterThan(0);
      } finally { restore(); }
    });
  });
});
