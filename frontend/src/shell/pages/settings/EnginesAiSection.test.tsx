// ENGINES-AI-01: Settings > Home settings > Engines and AI is the one page for the engines. The settings card (where the
// engine runs), the pairing wizard, the engines console (formerly /engines) and the AI model list (formerly /models)
// are all inside the settings shell, so the person never leaves it.
import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { renderWithQueryClient } from "../../../../tests/renderWithQueryClient";
import { SettingsAreaPage } from "@/shell/pages/settings/SettingsAreaPage";
import { SETTINGS_AREAS } from "@/shell/pages/settings/settingsAreas";
import { SETTINGS_VIEWS } from "@/shell/pages/settings/settingsViews";
import { makePerson, mockHome, type HomeFixture } from "@/shell/pages/settings/settingsTestKit";
import type { Roster } from "@/lib/api";

let fixture: HomeFixture | null = null;
const realFetch = globalThis.fetch;

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
        <Route path="settings/:area/:section?" element={<SettingsAreaPage person={person} onPersonChange={() => {}} />} />
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

describe("Engines and AI is one page inside the settings shell", () => {
  test("the settings card, the pairing section, the engines console, the model list and the token are all on it", async () => {
    const view = open(makePerson("owner"), "/settings/home/ai");
    await waitFor(() => expect(document.body.textContent).toContain("Where the engine runs"));
    await waitFor(() => expect(view.getByText("Engine computer link")).toBeTruthy());
    // The engines console (it was /engines).
    expect(await view.findByRole("button", { name: "Check the connection" })).toBeTruthy();
    // The AI model list (it was /models): hardware as ModelsSection draws it.
    await waitFor(() => expect(view.getByText("This computer: Apple Silicon, 24 GB memory.")).toBeTruthy());
    expect(view.getByText("Hugging Face token (for voice cloning)")).toBeTruthy();
    // Still the settings shell: the area's own section list is on the page.
    expect(view.getByRole("link", { name: "Engines and AI" })).toBeTruthy();
  });

  test("the spec's Engines and AI section names the trail view that carries all of this", () => {
    const ai = SETTINGS_AREAS.find((area) => area.id === "home")!.sections.find((section) => section.id === "ai")!;
    expect(ai.trail_view).toBe("home.engine_admin");
    expect(SETTINGS_VIEWS["home.engine_admin"]).toBeDefined();
  });

  // The exact inputs that looked "impossible": the select on the Engines and AI card, chosen the way a person does.
  // The write must reach the settings route (the hub saves it and answers 200; the 500 that made it snap back was the
  // hub's, and is covered in backend/tests/remoteStackSettings.test.ts).
  test("choosing Another computer on the card sends the write and the control shows it", async () => {
    const view = open(makePerson("owner"), "/settings/home/ai");
    const where = await view.findByRole("combobox", { name: "Where the engine runs" });
    expect((where as HTMLButtonElement).disabled).toBe(false);
    await act(async () => { fireEvent.click(where); });
    const option = await view.findByRole("option", { name: "Another Computer" });
    await act(async () => { fireEvent.pointerDown(option); fireEvent.pointerUp(option); fireEvent.click(option); });
    await waitFor(() => expect(fixture!.puts).toContainEqual({ scope: "household", key: "engines.stack.where", value: "another_computer" }));
    await waitFor(() => expect(view.getByRole("combobox", { name: "Where the engine runs" }).textContent).toContain("Another Computer"));
  });

  test("the pairing wizard opens from this page without a selection first, on step 1 of 5", async () => {
    const view = open(makePerson("admin"), "/settings/home/ai");
    fireEvent.click(await view.findByRole("button", { name: "Pair engine computer" }));
    expect(await view.findByText("Step 1 of 5: Where the engine runs")).toBeTruthy();
  });
});

describe("the user list is ready for the People section", () => {
  test("home.users_admin is a registered view (the spec names it for People in the commons order)", () => {
    expect(SETTINGS_VIEWS["home.users_admin"]).toBeDefined();
  });
});
