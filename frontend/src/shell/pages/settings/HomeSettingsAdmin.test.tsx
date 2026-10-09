// ADMIN-HOME-SETTINGS-01: Home settings is the one household area. A person
// who is not an owner or admin lands on Account; the five household sections
// that had no entry draw inside it as trail views; and the area holds
// household scope only.
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { renderWithQueryClient } from "../../../../tests/renderWithQueryClient";
import { SettingsAreaPage } from "@/shell/pages/settings/SettingsAreaPage";
import { SETTINGS_AREAS } from "@/shell/pages/settings/settingsAreas";
import { makePerson, mockHome, type HomeFixture } from "@/shell/pages/settings/settingsTestKit";
import type { Roster } from "@/lib/api";

let fixture: HomeFixture | null = null;
const realFetch = globalThis.fetch;

function Where() {
  const { pathname } = useLocation();
  return <output data-testid="where">{pathname}</output>;
}

function open(person: Roster, url: string, home: Parameters<typeof mockHome>[0] = {}) {
  fixture = mockHome(home);
  // The five moved sections each read their own route; the settings fixture
  // answers the rest. Unlisted routes fall through to it.
  const settingsFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const path = (typeof input === "string" ? input : input.toString()).split("?")[0]!;
    const json = (body: unknown) => Promise.resolve(Response.json(body));
    if (path.endsWith("/api/engine-link/credentials")) return json({ paired: false });
    if (path.endsWith("/api/devices/discover-robots")) return json([]);
    if (path.endsWith("/api/plugins/stats")) return json({ total: 0, fallthroughRate: null, byCommand: [] });
    return settingsFetch(input, init);
  }) as typeof fetch;
  const restoreSettings = fixture.restore;
  fixture.restore = () => { restoreSettings(); globalThis.fetch = realFetch; };
  const view = renderWithQueryClient(
    <MemoryRouter initialEntries={[url]}>
      <Where />
      <Routes>
        <Route path="settings/:area/:section?" element={<SettingsAreaPage person={person} onPersonChange={() => {}} />} />
      </Routes>
    </MemoryRouter>,
  );
  return Object.assign(view, within(document.body));
}

const where = (view: ReturnType<typeof open>) => view.getByTestId("where").textContent;

const homeArea = () => SETTINGS_AREAS.find((area) => area.id === "home")!;

afterEach(() => {
  cleanup();
  fixture?.restore();
  fixture = null;
});

describe("who may open Home settings", () => {
  test.each(["adult", "teen", "child", "guest"] as const)("a %s opening /settings/home lands on Account and no household request is made", async (role) => {
    const view = open(makePerson(role), "/settings/home");
    await waitFor(() => expect(where(view)).toMatch(/^\/settings\/account/));
    expect(fixture!.requests.filter((r) => r.includes("scope=household"))).toEqual([]);
  });

  test.each(["owner", "admin"] as const)("an %s opens it", async (role) => {
    const view = open(makePerson(role), "/settings/home");
    await waitFor(() => expect(where(view)).toBe("/settings/home/general"));
  });
});

describe("the sections that had no entry draw inside Home settings", () => {
  test("the spec's Home area carries a trail view for each of them", () => {
    const trail = Object.fromEntries(homeArea().sections.filter((section) => section.trail_view).map((section) => [section.id, section.trail_view]));
    expect(trail).toEqual({ ai: "home.engine_admin", robot: "home.devices_admin", developer: "home.routing_stats" });
  });


  const cases: Array<[string, string, string, { robots?: boolean }]> = [
    ["engine computer pairing", "/settings/home/ai", "Engine computer link", {}],
    ["Hugging Face token", "/settings/home/ai", "Hugging Face token (for voice cloning)", {}],
    ["add a robot", "/settings/home/robot", "Add a robot", { robots: true }],
    ["robot passwords", "/settings/home/robot", "Robot passwords", { robots: true }],
    ["plugin routing stats", "/settings/home/developer", "Plugin routing", {}],
  ];
  test.each(cases)("%s", async (_name, url, heading, home) => {
    const view = open(makePerson("owner"), url, home);
    await waitFor(() => expect(where(view)).toBe(url));
    expect(await view.findByRole("heading", { name: heading })).toBeTruthy();
  });

  test("an admin sees them too", async () => {
    const view = open(makePerson("admin"), "/settings/home/ai");
    expect(await view.findByRole("heading", { name: "Engine computer link" })).toBeTruthy();
  });
});

describe("Home settings holds household scope only", () => {
  test("no card in the home area is at a person or device scope", () => {
    const scopes = homeArea().sections.flatMap((section) => (section.cards ?? []).filter((card) => card.group).map((card) => card.scope));
    expect(scopes.length).toBeGreaterThan(0);
    expect(scopes.every((scope) => scope === "household")).toBe(true);
  });

  test("an owner opening every Home section reads the household scope and no person's", async () => {
    const view = open(makePerson("owner"), "/settings/home/general");
    await waitFor(() => expect(where(view)).toBe("/settings/home/general"));
    await view.findByRole("heading", { name: /^General$/ });
    expect(fixture!.requests.filter((r) => /scope=person/.test(r) || /scope=person%3A/.test(r))).toEqual([]);
  });
});
