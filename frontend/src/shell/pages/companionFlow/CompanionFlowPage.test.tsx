import { afterEach, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, ApiError, type CompanionLook } from "@/lib/api";
import { CompanionShellViewer } from "@/lib/companionShells";
import { CompanionFlowPage } from "@/shell/pages/companionFlow/CompanionFlowPage";

const methods = ["settingsValues", "companions", "editCompanion", "createCompanionDraft", "companionLook", "generateCompanionLook", "companionLookJob", "uploadCompanionLook", "restyleCompanionLook", "prepareCompanionLook", "approveCompanionLook", "deleteCompanion", "updateCompanion", "cancelCompanionLookJob"] as const;
const originals = Object.fromEntries(methods.map((key) => [key, api[key]]));
afterEach(() => { cleanup(); Object.assign(api, originals); });

const adultStyles = [{ id: "cartoon", label: "Cartoon" }, { id: "anime", label: "Anime" }, { id: "photorealistic", label: "Realistic" }, { id: "3d", label: "3D" }, { id: "pixel", label: "Pixel" }, { id: "custom", label: "Custom", custom: true }];
const teenStyles = adultStyles.filter((s) => !s.custom);
const version = (id: string) => ({ id, label: `Picture ${id}`, source: "generated" as const, width: 1024, height: 1024, created_at: "2026-10-29T12:00:00Z", from: null, url: `/api/companions/hc-one/look/${id}/image` });
const look = (overrides: Partial<CompanionLook> = {}): CompanionLook => ({ versions: [], rest: null, key: `#${"00FF00"}`, sheet: null, ready_for_video: false, start_ready: false, can_generate: true, styles: adultStyles, keep: { id: "keep", label: "Keep as is" }, audience_cap: "all", ...overrides });
function Where() { return <div data-testid="where">{useLocation().pathname}</div>; }

function open(options: { path?: string; canCreate?: boolean; lookData?: CompanionLook } = {}) {
  const calls = { draft: 0, generate: [] as unknown[], deleted: [] as string[], approved: [] as string[], prepare: [] as unknown[] };
  api.settingsValues = async () => [{ key: "companions.preview_shells", value: true, source: "user", label: "Preview", level: "basic", secret: false }] as never;
  api.companions = async () => ({ allowed: true, can_create: options.canCreate ?? true, can_discover: false, default_id: "x", companions: [], discover: [], robots: null });
  api.editCompanion = async () => ({ id: "hc-one", name: "Marlow" }) as never;
  api.createCompanionDraft = async () => { calls.draft++; return { id: "hc-one" }; };
  api.companionLook = async () => options.lookData ?? look();
  api.generateCompanionLook = async (_id, body) => { calls.generate.push(body); return { job: "job-1" }; };
  api.companionLookJob = async () => ({ state: "done", percent: 100, label: "Done", versions: [{ id: "v-1", url: "/x", label: "Picture v-1" }], error: null });
  api.approveCompanionLook = async (_id, v) => { calls.approved.push(v); return { job: "sheet-1" }; };
  api.prepareCompanionLook = async (_id, body) => { calls.prepare.push(body); return { id: "v-2" }; };
  api.deleteCompanion = async (id) => { calls.deleted.push(id); };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><CompanionShellViewer.Provider value={{ id: "person-sage" } as never}><MemoryRouter initialEntries={[options.path ?? "/companions/create"]}><Routes>
    <Route path="/companions/create" element={<CompanionFlowPage />} /><Route path="/companions/:id/create" element={<CompanionFlowPage />} /><Route path="/companions" element={<Where />} />
  </Routes></MemoryRouter></CompanionShellViewer.Provider></QueryClientProvider>);
  return { view, calls };
}
const button = (view: ReturnType<typeof open>["view"], name: string) => view.getByRole("button", { name }) as HTMLButtonElement;
async function nameIt(view: ReturnType<typeof open>["view"], value = "Marlow") {
  const input = await view.findByLabelText("Character name"); fireEvent.change(input, { target: { value } }); fireEvent.blur(input);
}

test("Generate stays disabled until the name and a description are set", async () => {
  const { view } = open(); await nameIt(view, "");
  expect(button(view, "Generate Character").disabled).toBe(true);
  await nameIt(view, "Marlow"); await view.findByRole("button", { name: "Cartoon" });
  expect(button(view, "Generate Character").disabled).toBe(true);
  fireEvent.change(view.getByLabelText("Describe the character"), { target: { value: "A friendly fox" } });
  expect(button(view, "Generate Character").disabled).toBe(false);
});

test("the draft is created once and the style tiles come from the look response", async () => {
  const { view, calls } = open(); await nameIt(view);
  for (const label of ["Realistic", "Cartoon", "Anime", "3D", "Pixel", "Custom"]) expect(await view.findByRole("button", { name: label })).toBeTruthy();
  expect(button(view, "Cartoon").getAttribute("aria-pressed")).toBe("true");
  fireEvent.change(view.getByLabelText("Describe the character"), { target: { value: "A friendly fox" } });
  await act(async () => { fireEvent.click(button(view, "Generate Character")); });
  await waitFor(() => expect(calls.generate.length).toBe(1));
  expect(calls.draft).toBe(1); expect(calls.generate[0]).toEqual({ prompt: "A friendly fox", style: "cartoon", count: 1 });
});

test("Custom shows its one-line input and the teen list has no Custom tile", async () => {
  const adult = open(); await nameIt(adult.view);
  fireEvent.click(await adult.view.findByRole("button", { name: "Custom" }));
  const typed = adult.view.getByLabelText("Custom style") as HTMLInputElement; expect(typed.maxLength).toBe(120);
  cleanup();
  const teen = open({ lookData: look({ styles: teenStyles }) }); await nameIt(teen.view);
  await teen.view.findByRole("button", { name: "Cartoon" });
  expect(teen.view.queryByRole("button", { name: "Custom" })).toBeNull();
});

test("Approve is disabled until a picture exists, then approves and moves to step 2", async () => {
  const empty = open(); await nameIt(empty.view); await empty.view.findByRole("button", { name: "Cartoon" });
  expect(button(empty.view, "Approve & Continue").disabled).toBe(true);
  expect(empty.view.getByText("Your character will appear here")).toBeTruthy();
  cleanup();
  const { view, calls } = open({ path: "/companions/hc-one/create", lookData: look({ versions: [version("v-1")], rest: "v-1" }) });
  await waitFor(() => expect(button(view, "Approve & Continue").disabled).toBe(false));
  expect(view.getByLabelText("Remove background")).toBeTruthy();
  fireEvent.click(button(view, "Approve & Continue"));
  await waitFor(() => expect(calls.approved).toEqual(["v-1"]));
  await view.findByText("Step 2 of 3 · Bring it to life");
  expect(view.getAllByText("This step comes next.").length).toBe(1);
});

test("remove background calls the prepare route", async () => {
  const { view, calls } = open({ path: "/companions/hc-one/create", lookData: look({ versions: [version("v-1")], rest: "v-1" }) });
  await waitFor(() => expect(button(view, "Approve & Continue").disabled).toBe(false));
  fireEvent.click(view.getByRole("switch", { name: "Remove background" }));
  await waitFor(() => expect(calls.prepare).toEqual([{ version_id: "v-1", remove_background: true }]));
});

test("closing with an empty draft asks keep or discard; discard deletes it", async () => {
  const { view, calls } = open(); await nameIt(view); await view.findByRole("button", { name: "Cartoon" });
  fireEvent.click(view.getByRole("button", { name: "Close" }));
  expect(await view.findByText("Keep this draft or discard it?")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Discard" }));
  await waitFor(() => expect(calls.deleted).toEqual(["hc-one"]));
  await waitFor(() => expect(view.getByTestId("where").textContent).toBe("/companions"));
});

test("closing with no draft goes straight back to the companions list", async () => {
  const { view } = open(); await view.findByLabelText("Character name");
  fireEvent.click(view.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(view.getByTestId("where").textContent).toBe("/companions"));
});

test("a child account gets the not-allowed message, not the dialog", async () => {
  const { view } = open({ canCreate: false });
  expect(await view.findByText(/Making a companion is for teens and adults/)).toBeTruthy();
  expect(view.queryByLabelText("Character name")).toBeNull();
});

test("an API error shows as one line under the button", async () => {
  const { view } = open(); await nameIt(view); await view.findByRole("button", { name: "Cartoon" });
  api.generateCompanionLook = async () => { throw new ApiError("That picture was withheld. Change the description and try again.", 422); };
  fireEvent.change(view.getByLabelText("Describe the character"), { target: { value: "A fox" } });
  await act(async () => { fireEvent.click(button(view, "Generate Character")); });
  expect((await view.findByRole("alert")).textContent).toBe("That picture was withheld. Change the description and try again.");
});
