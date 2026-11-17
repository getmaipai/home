// One screen per person: role, what they can use, what they can see (RULES.md C3, C7, C10). Content copy is the registry's.
import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PersonAccessEditor } from "@/apps/settings/PersonAccessEditor";
import { PeopleAccess } from "@/apps/settings/PeopleAccess";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { PersonRosterEntry, ResolvedSetting, Roster } from "@/lib/api";
import type { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

afterEach(cleanup);

const base = { nickname: null, avatar_seed: "x", bio: null, accent: null, source: "hub", local_only: false, created_at: "2026-09-05T00:00:00.000Z", updated_at: "2026-09-05T00:00:00.000Z", deleted_at: null, enabled: true, guest_expires_at: null, controls: null, memorialized_at: null, hlc: "1788000000000:0:test", hasSecret: true };
const sage = { ...base, id: "person-sage", display_name: "Sage", role: "owner", age_band: "adult" } as Roster;
const marlow = { ...base, id: "person-marlow", display_name: "Marlow", role: "teen", age_band: "teen" } as Roster;
const nova = { ...base, id: "person-nova", display_name: "Nova", role: "child", age_band: "child" } as Roster;
const roster = [sage, marlow, nova].map((p) => ({ ...p, sessionLockRequired: false, sessionLockTimeoutMinutes: 0 })) as unknown as PersonRosterEntry[];

const def = (key: string, label: string, options: string[], extra: Record<string, unknown> = {}) => ({
  key, scope: "person", selector: "select", range: { options, ...(extra.multiple ? { multiple: true } : {}) }, default: extra.multiple ? [] : options[0], label, help: `${label} help`,
  copy: { does: `${label} does.`, options: Object.fromEntries(options.map((o) => [o, `${o} copy`])), ...(extra.multiple ? { option_labels: Object.fromEntries(options.map((o) => [o, `${o} label`])) } : {}) },
  level: "basic", secret: false, lives_in: "person.allowance", honoured_by: ["home"],
}) as unknown as SettingsKey;
const registry = [
  def("content.ceiling", "Content level", ["G", "PG", "PG-13", "R", "X"]),
  def("content.unrated.library", "Unrated items in the library", ["default", "yes", "no"]),
  def("content.own_ceiling", "Your content level", ["default", "G", "PG"]),
  def("content.filters", "Content filters", ["swearing", "drugs"], { multiple: true }),
];
const value = (key: string, v: unknown): ResolvedSetting => ({ key, value: v, source: "default", label: registry.find((k) => k.key === key)!.label, level: "basic", secret: false });


const feature = (id: string, title: string, over: Record<string, unknown> = {}) => ({ id, title, min_role: "child", role_allows: true, effective: true, grant: null, ...over });
const visitor = { ...roster[2]!, id: "person-visitor", display_name: "Visitor", role: "guest", age_band: "child", controls: "child" } as unknown as PersonRosterEntry;

function stub() {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.includes("/overrides")) return Promise.resolve(Response.json([value("content.ceiling", "PG-13"), value("content.unrated.library", "default"), value("content.filters", ["swearing"])]));
    if (url.includes("/api/settings/registry")) return Promise.resolve(Response.json(registry));
    if (url.includes("/features")) return Promise.resolve(Response.json({ features: [feature("weather", "Weather"), feature("code", "Coding", { min_role: "adult", role_allows: false, effective: false, allow_for_minors: true })] }));
    if (url.endsWith("/api/grants") && method === "POST") return Promise.resolve(Response.json({ id: "g1" }, { status: 201 }));
    if (/\/api\/people\/[^/]+$/.test(url) && method === "PATCH") return Promise.resolve(Response.json({ ...roster[1]!, ...(init?.body ? JSON.parse(String(init.body)) : {}) }));
    if (url.endsWith("/api/people")) return Promise.resolve(Response.json([...roster, visitor]));
    if (url.includes("/api/settings")) return Promise.resolve(Response.json([]));
    throw new Error(`unstubbed fetch: ${method} ${url}`);
  }) as unknown as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}
const marlowEntry = roster[1]!;
const pick = async (view: ReturnType<typeof renderWithQueryClient>, trigger: string, option: string) => {
  fireEvent.click(await view.findByRole("combobox", { name: trigger }));
  const item = await view.findByRole("option", { name: option });
  fireEvent.click(item);
};

describe("PersonAccessEditor", () => {
  test("shows the three sections in order, Coding first, with the registry's content labels", async () => {
    const s = stub();
    try {
      const view = renderWithQueryClient(<MemoryRouter><PersonAccessEditor viewer={sage} target={marlowEntry} onBack={() => {}} /></MemoryRouter>);
      expect(await view.findByText("Content level")).toBeTruthy();
      expect(view.getByText("Unrated items in the library")).toBeTruthy();
      expect(view.getByText("Content filters")).toBeTruthy();
      const headings = view.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
      expect(headings).toEqual(["Role", "What Marlow can use", "What Marlow can see"]);
      await view.findByText("Weather");
      const titles = Array.from(view.container.querySelectorAll("[data-testid=person-features] [data-slot=item-title]")).map((e) => e.textContent);
      expect(titles[0]).toBe("Coding");
      expect(s.calls.some((c) => c.url.includes("/api/people/person-marlow/overrides"))).toBe(true);
    } finally { s.restore(); }
  });

  test("a feature choice saves at once and says Saved", async () => {
    const s = stub();
    try {
      const view = renderWithQueryClient(<MemoryRouter><PersonAccessEditor viewer={sage} target={marlowEntry} onBack={() => {}} /></MemoryRouter>);
      await view.findByText("Weather");
      expect(view.queryByText("Saved.")).toBeNull();
      fireEvent.click(view.getAllByRole("radio", { name: "Denied" })[1]!);
      await waitFor(() => expect(s.calls.some((c) => c.method === "POST" && c.url.endsWith("/api/grants") && (c.body as { action: string }).action === "use:weather")).toBe(true));
      expect(await view.findByText("Saved.")).toBeTruthy();
    } finally { s.restore(); }
  });

  test("the owner changes a role only after a confirmation, then it saves and says Saved", async () => {
    const s = stub();
    try {
      const view = renderWithQueryClient(<MemoryRouter><PersonAccessEditor viewer={sage} target={marlowEntry} onBack={() => {}} /></MemoryRouter>);
      await pick(view, "Role for Marlow", "Adult");
      expect(await view.findByText("Make Marlow Adult?")).toBeTruthy();
      expect(s.calls.some((c) => c.method === "PATCH")).toBe(false);
      fireEvent.click(view.getByRole("button", { name: "Make Adult" }));
      await waitFor(() => expect(s.calls.some((c) => c.method === "PATCH" && JSON.stringify(c.body) === JSON.stringify({ role: "adult" }))).toBe(true));
      expect(await view.findByText("Saved.")).toBeTruthy();
    } finally { s.restore(); }
  });

  test("an admin sees the role as text with the reason it is fixed, and no role picker", async () => {
    const s = stub();
    try {
      const admin = { ...sage, id: "person-admin", role: "admin" } as Roster;
      const view = renderWithQueryClient(<MemoryRouter><PersonAccessEditor viewer={admin} target={marlowEntry} onBack={() => {}} /></MemoryRouter>);
      expect(await view.findByText("Only the owner can change a role.")).toBeTruthy();
      expect(view.queryByRole("combobox", { name: "Role for Marlow" })).toBeNull();
    } finally { s.restore(); }
  });

  test("raising a guest's controls asks first; lowering them does not", async () => {
    const s = stub();
    try {
      const view = renderWithQueryClient(<MemoryRouter><PersonAccessEditor viewer={sage} target={visitor} onBack={() => {}} /></MemoryRouter>);
      await pick(view, "Controls", "Adult controls");
      expect(await view.findByText("Give Visitor adult controls?")).toBeTruthy();
      expect(s.calls.some((c) => c.method === "PATCH")).toBe(false);
      fireEvent.click(view.getByRole("button", { name: "Keep current controls" }));
      expect(s.calls.some((c) => c.method === "PATCH")).toBe(false);
    } finally { s.restore(); }
  });

  test("it is absent (not locked) on a person's own page and for anyone who is not an owner or admin", async () => {
    const s = stub();
    try {
      const own = renderWithQueryClient(<MemoryRouter><PersonAccessEditor viewer={sage} target={{ ...roster[0]! }} onBack={() => {}} /></MemoryRouter>);
      expect(own.container.textContent).toBe("");
      cleanup();
      const teen = renderWithQueryClient(<MemoryRouter><PersonAccessEditor viewer={{ id: "person-marlow", role: "teen" }} target={roster[2]!} onBack={() => {}} /></MemoryRouter>);
      expect(teen.container.textContent).toBe("");
      await new Promise((r) => setTimeout(r, 30));
      expect(s.calls).toHaveLength(0);
    } finally { s.restore(); }
  });
});

describe("PeopleAccess", () => {
  test("the roster opens one person's page and Back returns to the list; the viewer's own row has no access button", async () => {
    const s = stub();
    try {
      const view = renderWithQueryClient(<MemoryRouter initialEntries={["/settings/household?tab=people"]}><PeopleAccess person={sage} /></MemoryRouter>);
      expect(await view.findByRole("button", { name: "Role and access for Marlow" })).toBeTruthy();
      expect(view.queryByRole("button", { name: "Role and access for Sage" })).toBeNull();
      fireEvent.click(view.getByRole("button", { name: "Role and access for Marlow" }));
      expect(await view.findByText("What Marlow can use")).toBeTruthy();
      fireEvent.click(view.getByRole("button", { name: "Back to everyone" }));
      expect(await view.findByRole("button", { name: "Role and access for Nova" })).toBeTruthy();
    } finally { s.restore(); }
  });

  test("opening your own id in the address bar shows the list, not your own access page", async () => {
    const s = stub();
    try {
      const view = renderWithQueryClient(<MemoryRouter initialEntries={["/settings/household?tab=people&person=person-sage"]}><PeopleAccess person={sage} /></MemoryRouter>);
      expect(await view.findByRole("button", { name: "Role and access for Marlow" })).toBeTruthy();
      expect(view.queryByText("What Sage can use")).toBeNull();
    } finally { s.restore(); }
  });
});
