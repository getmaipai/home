// ENGINES-AI-01: Settings > Home settings > Engines and AI is the one page for the engines. The settings card (where the
// engine runs), the pairing wizard, the engines console (formerly /engines) and the AI model list (formerly /models)
// are all inside the settings shell, so the person never leaves it.
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
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
        <Route path="settings/:section?/:detailId?" element={<><RouterLocation /><SettingsAreaPage person={person} onPersonChange={() => {}} /></>} />
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

describe("Stack, Models: the AI and models page and the engines console in the settings shell", () => {
  test("Models shows the feature cards, the engine link and the console, and the Stack tabs are General, Models, Styles, Monitor, Maintain", async () => {
    const view = open(makePerson("owner"), "/settings/stack?tab=models");
    // STACK-MODELS-HOME-01: the shared page draws one card per feature from the Stack's choices (the kit's seeded Stack stands in here).
    expect(await view.findByTestId("feature-chat")).toBeTruthy();
    expect(view.queryByRole("heading", { name: "Needs attention" })).toBeNull();
    expect(await view.findByText("Engine computer link")).toBeTruthy();
    for (const name of ["General", "Models", "Styles", "Monitor", "Maintain"]) expect(view.getByRole("tab", { name })).toBeTruthy();
    // Still the settings shell: the area's own section list is on the page.
    expect(view.getAllByRole("link", { name: "Stack" }).some((link) => link.closest('[data-slot="settings-column"]'))).toBe(true);
  });

  test("the old Stack admin card is gone from the Models page (the link lives on General)", async () => {
    const view = open(makePerson("owner"), "/settings/stack?tab=models");
    await view.findByTestId("feature-chat");
    expect(view.queryByTestId("extra-stack-admin")).toBeNull();
  });

  test("a teen is sent to their own settings and never sees the Models page (UNSEEN-01)", async () => {
    const view = open(makePerson("teen"), "/settings/stack?tab=models");
    await waitFor(() => expect(view.queryByRole("tab", { name: "Models" })).toBeNull());
    expect(view.queryByTestId("ai-features")).toBeNull();
  });

  test("?tab keeps the requested shell tab in the URL", async () => {
    const view = open(makePerson("owner"), "/settings/stack?tab=maintain");
    expect(view.getByTestId("router-location").textContent).toContain("tab=maintain");
  });

  test("Maintain keeps the Hugging Face token the Advanced tab used to hold", async () => {
    const view = open(makePerson("owner"), "/settings/stack?tab=maintain");
    expect(await view.findByText("Hugging Face token (for voice cloning)")).toBeTruthy();
    expect(view.queryByRole("button", { name: "Free up space" })).toBeNull();
  });

  test("the spec declares the tab strip and the views behind it", () => {
    const stack = SETTINGS_AREAS.find((area) => area.id === "settings")!.sections.find((section) => section.id === "stack")!;
    expect(stack.tabs?.map((tab) => tab.id)).toEqual(["general", "models", "styles", "monitor", "maintain"]);
    expect(stack.tabs?.filter((tab) => tab.view).map((tab) => tab.view)).toEqual(["stack.general", "home.engine_admin", "stack.monitor", "stack.maintain"]);
    for (const view of ["stack.general", "home.engine_admin", "stack.monitor", "stack.maintain"]) expect(SETTINGS_VIEWS[view]).toBeDefined();
  });

  test("Models keeps the engine location setting available", async () => {
    const view = open(makePerson("owner"), "/settings/stack?tab=models");
    const where = await view.findByRole("combobox", { name: "Where the engine runs" });
    expect((where as HTMLButtonElement).disabled).toBe(false);
  });

  test("the pairing wizard opens from this page without a selection first, on step 1 of 5", async () => {
    const view = open(makePerson("admin"), "/settings/stack?tab=models");
    fireEvent.click(await view.findByRole("button", { name: "Pair engine computer" }));
    expect(await view.findByText("Step 1 of 5: Where the engine runs")).toBeTruthy();
  });
});

describe("the user list is ready for the People section", () => {
  test("home.users_admin is a registered view (the spec names it for People in the commons order)", () => {
    expect(SETTINGS_VIEWS["home.users_admin"]).toBeDefined();
  });
});
