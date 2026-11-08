import { toastError, spyOnToast } from "../../../../tests/toastSpy";
import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithQueryClient } from "../../../../tests/renderWithQueryClient";
import { HouseSettings } from "@/shell/pages/settings/HouseSettings";
import { settingsArea } from "@/shell/pages/settings/settingsAreas";
import { areaAllows } from "@maipai/ui/src/settings/settingsAudience";
import { makePerson, mockHome } from "@/shell/pages/settings/settingsTestKit";

spyOnToast();
afterEach(cleanup);
function setup(role: "owner" | "admin" | "adult" | "teen" | "child", fail: { registry?: boolean; grantWrite?: boolean } = {}) {
  const fixture = mockHome(); const base = globalThis.fetch; const grants: Array<{ person: string; action: string; effect: string }> = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = (typeof input === "string" ? input : input.toString()).split("?")[0]!;
    if (fail.registry && url.endsWith("/api/house/admin/registry")) return Promise.resolve(Response.json({ error: "no" }, { status: 500 }));
    if (fail.grantWrite && url === "/api/grants" && init?.method === "POST") return Promise.resolve(Response.json({ error: "Home could not save that access." }, { status: 500 }));
    if (url === "/api/grants" && init?.method === "POST") { grants.push(JSON.parse(String(init.body))); return Promise.resolve(Response.json({ id: "g" }, { status: 201 })); }
    if (url.startsWith("/api/grants/") && init?.method === "DELETE") return Promise.resolve(Response.json({ id: "g" }));
    return base(input, init);
  }) as typeof fetch;
  const view = renderWithQueryClient(<MemoryRouter><HouseSettings person={makePerson(role)} onPersonChange={() => {}} /></MemoryRouter>);
  return { view, grants, restore: () => { globalThis.fetch = base; fixture.restore(); } };
}

describe("House settings", () => {
  test("is hidden from teens and children", () => {
    const area = settingsArea("house")!;
    for (const role of ["teen", "child"] as const) { const person = makePerson(role); expect(areaAllows(area, { role: person.role, band: person.age_band })).toBe(false); }
  });
  test("shows the sensitive lock rule and tests the connection", async () => {
    const { view, restore } = setup("owner");
    await waitFor(() => expect(view.getByText("Front lock")).toBeTruthy());
    expect(view.getAllByText("Locked by rule").length).toBeGreaterThan(0);
    await waitFor(() => expect(view.getByRole("button", { name: "Test Home" })).toBeTruthy());
    await act(async () => fireEvent.click(view.getByRole("button", { name: "Test Home" })));
    await waitFor(() => expect(view.getByText("Connected · 2 rooms · 4 devices")).toBeTruthy());
    restore();
  });
  test("lists the connection with no token shown, and the exposure list loads on open and saves", async () => {
    const { view, restore } = setup("owner");
    await waitFor(() => expect(view.getByText(/http:\/\/192\.168\.1\.20:8123 · Token saved/)).toBeTruthy());
    const saves: unknown[] = [];
    const base = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = (typeof input === "string" ? input : input.toString()).split("?")[0]!;
      if (url.endsWith("/default/exposure") && init?.method === "PUT") { saves.push(JSON.parse(String(init.body))); return Promise.resolve(Response.json({ ok: true })); }
      return base(input, init);
    }) as typeof fetch;
    await act(async () => fireEvent.click(view.getByRole("button", { name: "What Home can see in Home" })));
    await waitFor(() => expect(view.getByLabelText("Whole room Kitchen")).toBeTruthy());
    expect(view.getByText(/Nothing is chosen yet/)).toBeTruthy();
    expect(view.getByText(/needs its own permission for each person/)).toBeTruthy();
    await act(async () => fireEvent.click(view.getByLabelText("Whole room Kitchen")));
    await act(async () => fireEvent.click(view.getByRole("button", { name: "Save what Home can see" })));
    await waitFor(() => expect(saves).toEqual([{ areas: ["k"], entities: [] }]));
    globalThis.fetch = base;
    restore();
  });
  test("changing to control writes see and control, then none revokes both", async () => {
    const { view, grants, restore } = setup("owner");
    await waitFor(() => expect(view.getByLabelText("Light access for Teen")).toBeTruthy());
    await act(async () => fireEvent.click(view.getByLabelText("Light access for Teen")));
    await act(async () => fireEvent.click(view.getByRole("option", { name: "Control" })));
    await waitFor(() => expect(grants).toEqual([{ person: "person-teen", action: "house.see:entity:light.k", effect: "allow" }, { person: "person-teen", action: "house.control:entity:light.k", effect: "allow" }]));
    await waitFor(() => expect(view.getByLabelText("Light access for Teen")).toBeTruthy());
    await act(async () => fireEvent.click(view.getByLabelText("Light access for Teen")));
    await act(async () => fireEvent.click(view.getByRole("option", { name: "None" })));
    await waitFor(() => expect(view.container.textContent).toContain("Saved"));
    restore();
  });
  test("a registry that fails to load says so with a Retry, never an empty table", async () => {
    const { view, restore } = setup("owner", { registry: true });
    await waitFor(() => expect(view.getByText(/Could not load the household\. Check your connection and try again\./)).toBeTruthy());
    expect(view.getByRole("button", { name: "Retry" })).toBeTruthy();
    restore();
  });
  test("a refused save toasts, shows no Saved line and leaves the controls usable", async () => {
    const { view, restore } = setup("owner", { grantWrite: true });
    await waitFor(() => expect(view.getByLabelText("Light access for Teen")).toBeTruthy());
    await act(async () => fireEvent.click(view.getByLabelText("Light access for Teen")));
    await act(async () => fireEvent.click(view.getByRole("option", { name: "See" })));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Home could not save that access. Check your connection and try again."));
    expect(view.queryByText("Saved")).toBeNull();
    await waitFor(() => expect(view.getByLabelText("Light access for Teen").hasAttribute("disabled")).toBe(false));
    restore();
  });
});
