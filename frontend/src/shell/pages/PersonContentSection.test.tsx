// CONTENT-POLICY-05: an owner or admin reaches a person's content controls through the narrow override read (a teen's profile is closed to the
// ordinary settings read), a person sees only the keys the hub listed for them, and every label is the registry's.
import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PersonProfilePage } from "@/shell/pages/PersonProfilePage";
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

function stub(lists: { overrides?: ResolvedSetting[]; own?: ResolvedSetting[] }) {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = String(input); urls.push(url);
    if (url.includes("/overrides")) return Promise.resolve(Response.json(lists.overrides ?? []));
    if (url.includes("/api/settings/registry")) return Promise.resolve(Response.json(registry));
    if (url.includes("/api/settings?scope=")) return Promise.resolve(Response.json(lists.own ?? []));
    if (url.includes("/api/people")) return Promise.resolve(Response.json(roster));
    if (url.includes("/api/files")) return Promise.resolve(Response.json([]));
    if (url.includes("/api/library/summary")) return Promise.resolve(Response.json({ items: 0, bytes: 0, per_kind: {}, trash: { items: 0, bytes: 0 }, expiring: { items: 0, bytes: 0 } }));
    if (url.includes("/api/library")) return Promise.resolve(Response.json({ items: [], next_cursor: null }));
    if (url.includes("/api/biometric-prints")) return Promise.resolve(Response.json([]));
    throw new Error(`unstubbed fetch: ${url}`);
  }) as unknown as typeof fetch;
  return { urls, restore: () => { globalThis.fetch = original; } };
}
const render = (path: string, who: Roster) => renderWithQueryClient(
  <MemoryRouter initialEntries={[path]}><Routes><Route path="/people/:id" element={<PersonProfilePage person={who} onPersonChange={() => {}} />} /></Routes></MemoryRouter>,
);

describe("the person page's Content controls", () => {
  test("an owner on a teen's closed profile gets the override controls through the narrow read, with the registry's labels", async () => {
    const s = stub({ overrides: [value("content.ceiling", "PG-13"), value("content.unrated.library", "default"), value("content.filters", ["swearing"])] });
    try {
      const view = render("/people/person-marlow", sage);
      expect(await view.findByText("Content level")).toBeTruthy();
      expect(view.getByText("Unrated items in the library")).toBeTruthy();
      expect(view.getByText("Content filters")).toBeTruthy();
      expect(view.queryByText("Your content level")).toBeNull();
      expect(s.urls.some((u) => u.includes("/api/people/person-marlow/overrides"))).toBe(true);
      expect(s.urls.some((u) => u.includes("scope=person%3Aperson-marlow") || u.includes("scope=person:person-marlow"))).toBe(false);
    } finally { s.restore(); }
  });

  test("a teen on their own page has a Content tab with only the keys the hub listed: their own level, no ceiling select", async () => {
    const s = stub({ own: [value("content.own_ceiling", "default"), value("content.filters", [])] });
    try {
      const view = render("/people/person-marlow?tab=content", marlow);
      expect(await view.findByText("Your content level")).toBeTruthy();
      expect(view.getByText("Content filters")).toBeTruthy();
      expect(view.queryByText("Content level")).toBeNull();
      expect(view.getByRole("tab", { name: "Content" })).toBeTruthy();
    } finally { s.restore(); }
  });

  test("a child whose list has no content key sees no Content tab at all", async () => {
    const s = stub({ own: [] });
    try {
      const view = render("/people/person-nova", nova);
      expect(await view.findByText("Nova")).toBeTruthy();
      await new Promise((r) => setTimeout(r, 30));
      expect(view.queryByRole("tab", { name: "Content" })).toBeNull();
    } finally { s.restore(); }
  });
});
