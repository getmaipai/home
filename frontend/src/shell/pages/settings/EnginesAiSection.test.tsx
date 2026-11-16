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
    if (path.endsWith("/api/ai/overview")) return json({ features: [{ id:"chat", name:"Chat", used_by:["chat"], levels:[{tier:"reduced",state:"off",word:"Off",model_label:null,size_bytes_missing:null,detail:null,action:null},{tier:"standard",state:"ready",word:"Ready",model_label:"Qwen",size_bytes_missing:null,detail:null,action:null},{tier:"boost",state:"same",word:"Same as Standard",model_label:null,size_bytes_missing:null,detail:null,action:null},{tier:"max",state:"same",word:"Same as Standard",model_label:null,size_bytes_missing:null,detail:null,action:null}],ready_count:1,level_count:4},{id:"pictures",name:"Pictures",used_by:["the Pictures app"],levels:[{tier:"reduced",state:"waits",word:"Waits for Standard",model_label:null,size_bytes_missing:null,detail:null,action:null},{tier:"standard",state:"missing",word:"Missing",model_label:"MiniMax H3-Image",size_bytes_missing:100,detail:null,action:{kind:"download",label:"Download",job:"pictures",level:"standard"}},{tier:"boost",state:"ready",word:"Ready",model_label:"MiniMax H3-Image",size_bytes_missing:null,detail:null,action:null},{tier:"max",state:"off",word:"Off",model_label:null,size_bytes_missing:null,detail:null,action:null}],ready_count:1,level_count:4}], helpers:[], attention:{items:[{id:"pictures-standard",kind:"missing",title:"Pictures standard",line:"MiniMax H3-Image is needed for this level.",action:{kind:"download",label:"Download",job:"pictures",level:"standard"}}],download_all:{bytes:100,count:1}},right_now:{engine:"ready",waiting:0,memory_free_bytes:1e9,models_bytes:1e9,disk_free_bytes:1e9} });
    if (path.endsWith("/api/ai/tiers/pictures")) return json({profile:"test",room_bytes:1e9,levels:[{tier:"standard",cap_bytes:1e9,recommended:"minimax-h3-image",candidates:[{id:"minimax-h3-image",label:"MiniMax H3-Image",family:"minimax",peak_bytes:1e9,verified:true,fits:true,refusal:null}]},{tier:"boost",cap_bytes:1e9,recommended:"minimax-h3-image",candidates:[{id:"minimax-h3-image",label:"MiniMax H3-Image",family:"minimax",peak_bytes:1e9,verified:true,fits:true,refusal:null}]},{tier:"max",cap_bytes:1e9,recommended:null,candidates:[]}] });
    if (path.endsWith("/api/ai/choices")) return json({ stack: "ok", message: null, tier: "p128", free_disk_bytes: 1e12, installed_bytes: 4e10, cards: [], alwaysOn: { text: "Always on: Home itself.", bytes: 1, rowIds: [] }, recommended: null, unused_bytes: 0 });
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

describe("Engines and AI uses four tabs inside the settings shell", () => {
  test("Features is the first tab and shows feature cards without attention", async () => {
    const view = open(makePerson("owner"), "/settings/ai?tab=overview");
    expect(await view.findByRole("tab", { name: "Features" })).toBeTruthy();
    expect((await view.findAllByTestId("ai-feature-card")).length).toBeGreaterThan(0);
    expect(view.queryByRole("heading", { name: "Needs attention" })).toBeNull();
    expect(view.queryByText("Install the AI for this computer")).toBeNull();
    expect(view.queryByText("Engine computer link")).toBeNull();
    expect(view.queryByRole("tab", { name: "Models" })).toBeNull();
    expect(view.getByRole("tab", { name: "Engines" })).toBeTruthy();
    expect(view.getByRole("tab", { name: "Advanced" })).toBeTruthy();
    // Still the settings shell: the area's own section list is on the page.
    expect(view.getAllByRole("link", { name: "AI and models" }).some((link) => link.closest('[data-slot="settings-column"]'))).toBe(true);
  });

  test("a teen is blocked from the Features page by the household role gate", async () => {
    const view = open(makePerson("teen"), "/settings/ai?tab=overview");
    expect(await view.findByText("Only a parent or admin can change these settings. Ask the person who set up Home.")).toBeTruthy();
    expect(view.queryByTestId("ai-features")).toBeNull();
  });

  test("?tab keeps the requested shell tab in the URL", async () => {
    const view = open(makePerson("owner"), "/settings/ai?tab=advanced");
    expect(view.getByTestId("router-location").textContent).toContain("tab=advanced");
    expect(view.queryByRole("tab", { name: "Advanced" })).toBeNull();
  });

  test("Advanced keeps the model and storage sections the Models tab used to hold", async () => {
    const view = open(makePerson("owner"), "/settings/ai?tab=advanced");
    expect(await view.findByText("Hugging Face token (for voice cloning)")).toBeTruthy();
    expect(await view.findByRole("button", { name: "Free up space" })).toBeTruthy();
    expect(view.queryByText("Models and storage")).toBeNull();
    expect(view.queryByText("This computer: Apple Silicon, 24 GB memory.")).toBeNull();
  });

  test("the spec declares the tab strip and default view tab", () => {
    const ai = SETTINGS_AREAS.find((area) => area.id === "settings")!.sections.find((section) => section.id === "ai")!;
    expect(ai.tabs?.map((tab) => tab.id)).toEqual(["overview", "engines", "advanced", "performance", "coding"]);
    expect(ai.tabs?.filter((tab) => ["overview", "engines", "advanced"].includes(tab.id)).every((tab) => tab.view === "home.engine_admin")).toBe(true);
    expect(SETTINGS_VIEWS["home.engine_admin"]).toBeDefined();
  });

  test("Engines keeps the engine location setting available", async () => {
    const view = open(makePerson("owner"), "/settings/ai?tab=engines");
    const where = await view.findByRole("combobox", { name: "Where the engine runs" });
    expect((where as HTMLButtonElement).disabled).toBe(false);
  });

  test("the pairing wizard opens from this page without a selection first, on step 1 of 5", async () => {
    const view = open(makePerson("admin"), "/settings/ai?tab=engines");
    fireEvent.click(await view.findByRole("button", { name: "Pair engine computer" }));
    expect(await view.findByText("Step 1 of 5: Where the engine runs")).toBeTruthy();
  });
});

describe("the user list is ready for the People section", () => {
  test("home.users_admin is a registered view (the spec names it for People in the commons order)", () => {
    expect(SETTINGS_VIEWS["home.users_admin"]).toBeDefined();
  });
});
