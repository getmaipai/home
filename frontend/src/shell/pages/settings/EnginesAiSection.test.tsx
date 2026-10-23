// ENGINES-AI-01: Settings > Home settings > Engines and AI is the one page for the engines. The settings card (where the
// engine runs), the pairing wizard, the engines console (formerly /engines) and the AI model list (formerly /models)
// are all inside the settings shell, so the person never leaves it.
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { renderWithQueryClient } from "../../../../tests/renderWithQueryClient";
import { SettingsAreaPage } from "@/shell/pages/settings/SettingsAreaPage";
import { SETTINGS_AREAS } from "@/shell/pages/settings/settingsAreas";
import { SETTINGS_VIEWS } from "@/shell/pages/settings/settingsViews";
import { makePerson, mockHome, type HomeFixture } from "@/shell/pages/settings/settingsTestKit";
import type { Roster } from "@/lib/api";

let fixture: HomeFixture | null = null;
const realFetch = globalThis.fetch;
function RouterLocation() { return <output data-testid="router-location">{useLocation().search}</output>; }

function open(person: Roster, url: string) {
  fixture = mockHome();
  const settingsFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const path = (typeof input === "string" ? input : input.toString()).split("?")[0]!;
    const json = (body: unknown) => Promise.resolve(Response.json(body));
    if (path.endsWith("/api/engine-link/credentials")) return json({ paired: false });
    if (path.endsWith("/api/engines/health")) return json({ configured: false, health: [] });
    if (path.endsWith("/api/engines")) return json({ configured: false, roles: [], engines: [], budget: null });
    if (path.endsWith("/api/host/hardware")) return json({ platform: "darwin", totalRamGb: 24, cpuCount: 14, isAppleSilicon: true, unifiedMemoryGb: 24, cudaDevices: [] });
    if (path.includes("/api/host/models")) return json(path.endsWith("/selection") ? { modelId: null } : []);
    if (path.includes("/api/host/engine/status")) return json({ kind: "none", modelId: null, pid: null, startedAt: null });
    return settingsFetch(input, init);
  }) as typeof fetch;
  const restoreSettings = fixture.restore;
  fixture.restore = () => { restoreSettings(); globalThis.fetch = realFetch; };
  const view = renderWithQueryClient(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="settings/:area/:section?" element={<><RouterLocation /><SettingsAreaPage person={person} onPersonChange={() => {}} /></>} />
      </Routes>
    </MemoryRouter>,
  );
  return Object.assign(view, within(document.body));
}

afterEach(() => {
  cleanup();
  fixture?.restore();
  fixture = null;
});

describe("Engines and AI uses four tabs inside the settings shell", () => {
  test("Overview is the default and each tab shows its existing parts", async () => {
    const view = open(makePerson("owner"), "/settings/home/ai");
    expect(await view.findByRole("tab", { name: "Overview" })).toBeTruthy();
    expect(await view.findByRole("switch", { name: "Pause chat for everyone" })).toBeTruthy();
    expect(await view.findByText("Install the AI for this computer")).toBeTruthy();
    expect(view.queryByText("Engine computer link")).toBeNull();
    expect(view.getByRole("tab", { name: "Models" })).toBeTruthy();
    expect(view.getByRole("tab", { name: "Engines" })).toBeTruthy();
    expect(view.getByRole("tab", { name: "Advanced" })).toBeTruthy();
    // Still the settings shell: the area's own section list is on the page.
    expect(view.getAllByRole("link", { name: "Engines and AI" }).some((link) => link.closest('[data-slot="settings-column"]'))).toBe(true);
  });

  test("?tab keeps the requested shell tab in the URL", async () => {
    const view = open(makePerson("owner"), "/settings/home/ai?tab=advanced");
    expect(view.getByTestId("router-location").textContent).toContain("tab=advanced");
    expect(view.queryByRole("tab", { name: "Advanced" })).toBeNull();
  });

  test("Models opens the existing model and storage sections", async () => {
    const view = open(makePerson("owner"), "/settings/home/ai?tab=models");
    expect(view.getByTestId("router-location").textContent).toContain("tab=models");
    expect(await view.findByText("Models and storage")).toBeTruthy();
    expect(await view.findByText("This computer: Apple Silicon, 24 GB memory.")).toBeTruthy();
    expect((await view.findAllByText("Memory and model choices")).length).toBeGreaterThan(0);
  });

  test("the spec declares the tab strip and default view tab", () => {
    const ai = SETTINGS_AREAS.find((area) => area.id === "home")!.sections.find((section) => section.id === "ai")!;
    expect(ai.tabs?.map((tab) => tab.id)).toEqual(["overview", "models", "engines", "advanced"]);
    expect(ai.trail_view).toBe("home.engine_admin");
    expect(SETTINGS_VIEWS["home.engine_admin"]).toBeDefined();
  });

  test("Engines keeps the engine location setting available", async () => {
    const view = open(makePerson("owner"), "/settings/home/ai?tab=engines");
    const where = await view.findByRole("combobox", { name: "Where the engine runs" });
    expect((where as HTMLButtonElement).disabled).toBe(false);
  });

  test("the pairing wizard opens from this page without a selection first, on step 1 of 5", async () => {
    const view = open(makePerson("admin"), "/settings/home/ai?tab=engines");
    fireEvent.click(await view.findByRole("button", { name: "Pair engine computer" }));
    expect(await view.findByText("Step 1 of 5: Where the engine runs")).toBeTruthy();
  });
});

describe("the user list is ready for the People section", () => {
  test("home.users_admin is a registered view (the spec names it for People in the commons order)", () => {
    expect(SETTINGS_VIEWS["home.users_admin"]).toBeDefined();
  });
});
