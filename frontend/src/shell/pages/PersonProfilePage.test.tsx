import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PersonProfilePage } from "@/shell/pages/PersonProfilePage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { PersonRosterEntry, ResolvedSetting, Roster } from "@/lib/api";
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

const people: PersonRosterEntry[] = [
  rosterEntry({ id: "person-sage", display_name: "Sage", role: "owner" }),
  rosterEntry({ id: "person-bramble", display_name: "Bramble", role: "child", bio: "Loves dinosaurs", accent: "teal" }),
  rosterEntry({ id: "person-nova", display_name: "Nova", role: "adult" }),
];

function stubFetch(byPath: Record<string, unknown>) {
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/settings/api-keys/people/")) return Promise.resolve(Response.json({ keys: [{ id: "key_abcd1234", person_id: "person-bramble", scopes: ["code"], status: "active", created_at: "2026-10-01T00:00:00.000Z", expires_at: "2027-01-01T00:00:00.000Z", revoked_at: null, hint: "QWER" }] }));
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
    {
      key: "generation.kid_enabled", scope: "person", selector: "boolean", default: true, label: "This child can make cartoon pictures and videos",
      level: "basic", secret: false, lives_in: "person.likeness", honoured_by: ["home"],
    } as unknown as SettingsKey,
    {
      key: "likeness.adults", scope: "person", selector: "boolean", default: false, label: "Let other adults make pictures that look like me",
      level: "basic", secret: false, lives_in: "person.likeness", honoured_by: ["home"],
    } as unknown as SettingsKey,
    {
      key: "topics.bodies", scope: "person", selector: "select", default: "default", label: "Bodies and relationships",
      level: "basic", secret: false, lives_in: "person.topics", honoured_by: ["home"],
      range: { options: ["default", "redirect", "gentle"] },
      copy: { option_labels: { default: "Follow child controls (recommended)", redirect: "Gently point to you", gentle: "Answer simply with correct body words" } },
    } as unknown as SettingsKey,
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
      expect(view.queryByText(/Face recognition:/)).toBeNull();
      expect(view.queryByText("Face recognition")).toBeNull();
      expect(view.queryByRole("link", { name: "Enroll" })).toBeNull();
    } finally { restore(); }
  });

  test("profile has no memories tab, list, or management controls", async () => {
    const restore = stubFetch({});
    try {
      const view = renderProfile("/people/person-bramble?tab=memories", viewer({ role: "adult" }));
      expect(await view.findByText("Bramble")).toBeTruthy();
      expect(view.queryByRole("tab", { name: "Memories" })).toBeNull();
      expect(view.queryByRole("button", { name: /Forget|Export|Clear all|Select memories/ })).toBeNull();
      expect(view.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe("true");
    } finally { restore(); }
  });

  test("an admin sees no Coding access row on a person's profile", async () => {
    const restore = stubFetch({});
    try {
      const view = renderProfile("/people/person-bramble", viewer({ role: "owner" }));
      expect(await view.findByText("Bramble")).toBeTruthy();
      expect(view.queryByText(/Hint •••• QWER/)).toBeNull();
      expect(view.queryByText("Laptop, Claude Code")).toBeNull();
      expect(view.queryByText(/last used|host/i)).toBeNull();
    } finally { restore(); }
  });

  // KIDS-CREATE-01: the per-child cartoon switch lives in the adults-only likeness card, which a child never sees and a parent never opens for a child. It is drawn on the child's own Limits tab, alone (no likeness consent switch beside it).
  test("a child's Limits tab carries the child's cartoon switch, and only that key of its card", async () => {
    const restore = stubProfileAndLimitsFetch();
    try {
      const view = renderProfile("/people/person-bramble?tab=limits", viewer({ role: "owner" }));
      expect(await view.findByText("This child can make cartoon pictures and videos")).toBeTruthy();
      expect(view.getByText("Pictures and videos")).toBeTruthy();
      expect(view.queryByText(/look like me/)).toBeNull();
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

  test("an owner sees a child's Topics tab with plain-word choices and the fixed note", async () => {
    const restore = stubProfileAndLimitsFetch();
    try {
      const view = renderProfile("/people/person-bramble?tab=topics", viewer({ role: "owner" }));
      expect(await view.findByRole("tab", { name: "Topics" })).toBeTruthy();
      expect(view.getByRole("tab", { name: "Topics" }).getAttribute("aria-selected")).toBe("true");
      expect(await view.findByText("Sensitive subjects")).toBeTruthy();
      expect(await view.findByRole("combobox", { name: "Bodies and relationships" })).toBeTruthy();
      expect(await view.findByText(/Some things never change for Bramble/)).toBeTruthy();
      expect(view.queryByText("Allowance 1")).toBeNull();
    } finally { restore(); }
  });

  test("Topics is not on a child's own profile, a teen's profile or a member's view of a child", async () => {
    const restore = stubProfileAndLimitsFetch();
    try {
      const own = renderProfile("/people/person-bramble?tab=topics", viewer({ id: "person-bramble", display_name: "Bramble", role: "child", age_band: "child" }));
      await own.findByText("Bramble");
      expect(own.queryByRole("tab", { name: "Topics" })).toBeNull();
      own.unmount();
      const member = renderProfile("/people/person-bramble?tab=topics", viewer({ role: "adult" }));
      await member.findByText("Bramble");
      expect(member.queryByRole("tab", { name: "Topics" })).toBeNull();
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

  test("a teen opens their own profile and a teen's profile is closed to an admin only", async () => {
    const teen = rosterEntry({ id: "person-nova", display_name: "Nova", role: "teen" });
    const restore = stubFetch({});
    const original = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => String(input).includes("/api/people")
      ? Promise.resolve(Response.json([...people.slice(0, 2), teen]))
      : Promise.resolve(Response.json([]))) as unknown as typeof fetch;
    try {
      const self = renderProfile("/people/person-nova", viewer({ id: "person-nova", display_name: "Nova", role: "teen" }));
      expect(await self.findByText("Nova")).toBeTruthy();
      expect(self.queryByText("You cannot open this profile.")).toBeNull();
      self.unmount();
      const peer = renderProfile("/people/person-nova", viewer({ role: "adult" }));
      expect(await peer.findByText("Nova")).toBeTruthy();
      expect(peer.queryByText("You cannot open this profile.")).toBeNull();
    } finally { globalThis.fetch = original; restore(); }
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
      await view.findByText("You cannot open this profile.");
      expect(view.queryByRole("tab", { name: "Limits" })).toBeNull();
      globalThis.fetch = original;
    } finally { restore(); }
  });

  test("an owner or admin cannot open a teen's profile at all, even by URL, but opens a child's", async () => {
    const teen = rosterEntry({ id: "person-nova", display_name: "Nova", role: "teen" });
    const restore = stubFetch({});
    const original = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => String(input).includes("/api/people")
      ? Promise.resolve(Response.json([...people.slice(0, 2), teen]))
      : Promise.resolve(Response.json([]))) as unknown as typeof fetch;
    try {
      for (const role of ["owner", "admin"] as const) {
        const teenView = renderProfile("/people/person-nova?tab=memories", viewer({ role }));
        expect(await teenView.findByText("You cannot open this profile.")).toBeTruthy();
        expect(teenView.getByText("Back to Family").getAttribute("href")).toBe("/people");
        expect(teenView.queryByText("Nova")).toBeNull();
        expect(teenView.queryByRole("button", { name: "Edit" })).toBeNull();
        expect(teenView.queryByText("Face recognition")).toBeNull();
        teenView.unmount();
        const childView = renderProfile("/people/person-bramble", viewer({ role }));
        expect(childView.queryByRole("tab", { name: "Memories" })).toBeNull();
        childView.unmount();
      }
    } finally { globalThis.fetch = original; restore(); }
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

  test("unknown ids show a plain not-found state", async () => {
    const restore = stubFetch({});
    try {
      const view = renderProfile("/people/person-missing", viewer({ role: "owner" }));
      expect(await view.findByText("No one in this household has that profile.")).toBeTruthy();
      expect(view.getByRole("link", { name: "Back to Family" }).getAttribute("href")).toBe("/people");
    } finally { restore(); }
  });

  test("self has one Edit profile link and face enrollment lives off Profile", async () => {
    const restore = stubFetch({});
    try {
      const self = renderProfile("/people/person-sage", viewer({ role: "owner" }));
      const edit = await self.findByRole("link", { name: "Edit profile" });
      expect(edit.getAttribute("href")).toBe("/settings/profile?tab=profile");
      expect(self.queryByRole("link", { name: "Manage in Settings" })).toBeNull();
      expect(self.queryByText("This is your own profile.")).toBeNull();
      expect(self.queryByText(/Face recognition/)).toBeNull();
      expect(self.getAllByRole("link").filter((link) => link.getAttribute("href") === "/settings/profile?tab=profile")).toHaveLength(1);
      cleanup();
      const other = renderProfile("/people/person-bramble", viewer({ role: "owner" }));
      expect(await other.findByRole("button", { name: "Edit" })).toBeTruthy();
      expect(other.queryByText("Face recognition")).toBeNull();
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

  test("keeps the remaining profile tabs and no memories tab", async () => {
    const restore = stubFetch({});
    try {
      const view = renderProfile("/people/person-sage", viewer({ role: "owner" }));
      expect(await view.findByRole("tab", { name: "Overview" })).toBeTruthy();
      expect(view.queryByRole("tab", { name: "Memories" })).toBeNull();
    } finally { restore(); }
  });
});

// Profile-specific coverage after memories moved to Settings.
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

  const owner = () => viewer({ id: "person-sage", role: "owner" });

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
          visibleFile({ id: "file-photo1", kind: "image", shared: true }),
          visibleFile({ id: "file-video1", kind: "video", media_type: "video/mp4", shared: true }),
          visibleFile({ id: "file-doc1", kind: "document", media_type: "application/pdf", shared: true }),
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

    test("shows the plain empty line when nothing's been shared", async () => {
      const restore = stubByPath({});
      try {
        const view = renderProfile("/people/person-bramble", owner());
        expect(await view.findByText("Nothing shared yet.")).toBeTruthy();
      } finally { restore(); }
    });

    test("owned files are not shown as shared", async () => {
      const restore = stubByPath({ "/api/files": [visibleFile({ id: "file-owned", kind: "image", shared: false })] });
      try {
        const view = renderProfile("/people/person-sage", owner());
        expect(await view.findByText("Nothing shared yet.")).toBeTruthy();
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
