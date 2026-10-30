import { api } from "@/lib/api";
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
        <Route path="settings/:section?/:detailId?" element={<SettingsAreaPage person={person} onPersonChange={() => {}} />} />
      </Routes>
    </MemoryRouter>,
  );
  return Object.assign(view, within(document.body));
}

const where = (view: ReturnType<typeof open>) => view.getByTestId("where").textContent;

const homeArea = () => SETTINGS_AREAS.find((area) => area.id === "settings")!;

afterEach(() => {
  cleanup();
  fixture?.restore();
  fixture = null;
});

describe("who may open Home settings", () => {
  test.each(["adult", "teen", "child", "guest"] as const)("a %s opening /settings/home sees why it is refused and no household request is made", async (role) => {
    const view = open(makePerson(role), "/settings/household");
    expect(await view.findByText("Only a parent or admin can change these settings. Ask the person who set up Home.")).toBeTruthy();
    expect(fixture!.requests.filter((r) => r.includes("scope=household"))).toEqual([]);
  });

  test("the Reference library tab shows the library alone, not the Web search block of the Search tab", async () => {
    const original = { state: api.referenceState, catalog: api.referenceCatalog };
    api.referenceState = async () => ({ installed: [], jobs: [], matchesPresets: [] });
    api.referenceCatalog = async () => [];
    try {
      const view = open(makePerson("owner"), "/settings/search?tab=reference-library");
      expect(await view.findByText(/Offline data/)).toBeTruthy();
      expect(view.queryByText("SearXNG address")).toBeNull();
    } finally { Object.assign(api, { referenceState: original.state, referenceCatalog: original.catalog }); }
  });

  test.each(["owner", "admin"] as const)("an %s opens it", async (role) => {
    const view = open(makePerson(role), "/settings/household");
    await waitFor(() => expect(where(view)).toBe("/settings/household"));
  });
});

describe("the sections that had no entry draw inside Home settings", () => {
  test("tab views retain the old household page content", () => {
    const tabViews = Object.fromEntries(homeArea().sections.map((section) => [section.id, Object.fromEntries((section.tabs ?? []).filter((tab) => tab.view).map((tab) => [tab.id, tab.view]))]));
    expect(tabViews.ai).toMatchObject({ overview: "home.engine_admin" });
    expect(tabViews.media).toMatchObject({ pictures: "home.pictures_library", "media-library": "home.media_library" });
    expect(tabViews.apps).toMatchObject({ robot: "home.devices_admin" });
    expect(homeArea().sections.find((section) => section.id === "apps")?.tabs?.[0]?.id).toBe("robot");
    expect(tabViews.advanced).toMatchObject({ developer: "home.routing_stats" });
    expect(homeArea().sections.find((section) => section.id === "advanced")?.tabs?.[0]?.id).toBe("developer");
  });


  const cases: Array<[string, string, string, { robots?: boolean }]> = [
    ["robot passwords", "/settings/apps", "Robot password", { robots: true }],
    ["plugin routing stats", "/settings/advanced", "Plugin routing", {}],
  ];
  test.each(cases)("%s", async (_name, url, heading, home) => {
    const view = open(makePerson("owner"), url, home);
    await waitFor(() => expect(where(view)).toBe(url));
    expect(await view.findByRole("heading", { name: heading })).toBeTruthy();
  });

  test("the Devices page has no inline add form and the add query opens its dialog", async () => {
    const page = open(makePerson("owner"), "/settings/apps?tab=robot", { robots: true });
    await page.findByRole("button", { name: "Add a robot" });
    expect(page.queryByPlaceholderText("Six-digit code")).toBeNull();
    const dialog = open(makePerson("owner"), "/settings/apps?tab=robot&addRobot=1", { robots: true });
    expect(await dialog.findByRole("dialog")).toBeTruthy();
    expect(await dialog.findByPlaceholderText("Six-digit code")).toBeTruthy();
    expect(dialog.getByRole("heading", { name: "Add a robot" })).toBeTruthy();
  });

  test("engine computer pairing is on Engines", async () => {
    const view = open(makePerson("owner"), "/settings/ai?tab=engines");
    expect(await view.findByText("Engine computer link")).toBeTruthy();
  });

  test("Hugging Face token is on Advanced", async () => {
    const view = open(makePerson("owner"), "/settings/ai?tab=advanced");
    expect(await view.findByText("Hugging Face token (for voice cloning)")).toBeTruthy();
  });

  test("the robot add, install, and password sections stay hidden while Robots is off", async () => {
    const view = open(makePerson("owner"), "/settings/apps?tab=robot", { robots: true, robotsEnabled: false });
    await waitFor(() => expect(where(view)).toBe("/settings/apps"));
    expect(view.queryByRole("button", { name: "Add a robot" })).toBeNull();
    expect(view.queryByRole("heading", { name: "Robot password" })).toBeNull();
  });

  test("an admin sees them too", async () => {
    const view = open(makePerson("admin"), "/settings/ai?tab=engines");
    expect(await view.findByText("Engine computer link")).toBeTruthy();
  });
});

describe("Home settings holds household scope only", () => {
  test("household pages use only household scope cards", () => {
    const scopes = homeArea().sections.filter((section) => section.scope === "household").flatMap((section) => (section.cards ?? []).filter((card) => card.group).map((card) => card.scope));
    expect(scopes.length).toBeGreaterThan(0);
    expect(scopes.every((scope) => scope === "household")).toBe(true);
  });

  test("an owner opening every Home section reads the household scope and no person's", async () => {
    for (const page of ["household", "privacy", "ai", "home-voice", "apps", "backups"]) {
      const view = open(makePerson("owner"), `/settings/${page}`);
      await waitFor(() => expect(where(view)).toBe(`/settings/${page}`));
      await waitFor(() => expect(fixture!.scopes.length).toBeGreaterThan(0));
      expect(fixture!.requests.some((r) => /scope=household/.test(r))).toBe(true);
      expect(fixture!.requests.filter((r) => /scope=person/.test(r) || /scope=person%3A/.test(r))).toEqual([]);
      cleanup();
      fixture!.restore();
      fixture = null;
    }
  });
});
