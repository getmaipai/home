import { afterEach, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, ApiError, type CompanionLook } from "@/lib/api";
import { CompanionShellViewer } from "@/lib/companionShells";
import { CompanionFlowPage } from "@/shell/pages/companionFlow/CompanionFlowPage";

const methods = ["settingsValues", "companions", "editCompanion", "createCompanionDraft", "companionLook", "generateCompanionLook", "companionLookJob", "uploadCompanionLook", "restyleCompanionLook", "prepareCompanionLook", "approveCompanionLook", "deleteCompanion", "updateCompanion", "cancelCompanionLookJob", "completeCompanionLook", "companionStates", "getCompanionLookStyles"] as const;
const originals = Object.fromEntries(methods.map((key) => [key, api[key]]));
afterEach(() => { cleanup(); Object.assign(api, originals); });

const adultStyles = [{ id: "cartoon", label: "Cartoon" }, { id: "anime", label: "Anime" }, { id: "photorealistic", label: "Realistic" }, { id: "3d", label: "3D" }, { id: "pixel", label: "Pixel" }, { id: "custom", label: "Custom", custom: true }];
const teenStyles = adultStyles.filter((s) => !s.custom);
const version = (id: string) => ({ id, label: `Picture ${id}`, source: "generated" as const, width: 1024, height: 1024, created_at: "2026-10-29T12:00:00Z", from: null, url: `/api/companions/hc-one/look/${id}/image` });
const look = (overrides: Partial<CompanionLook> = {}): CompanionLook => ({ versions: [], rest: null, key: `#${"00FF00"}`, sheet: null, ready_for_video: false, start_ready: false, can_generate: true, styles: adultStyles, keep: { id: "keep", label: "Keep as is" }, audience_cap: "all", ...overrides });
function Where() { return <div data-testid="where">{useLocation().pathname}</div>; }

function open(options: { path?: string; canCreate?: boolean; lookData?: CompanionLook; styles?: typeof adultStyles } = {}) {
  const calls = { draft: 0, generate: [] as unknown[], deleted: [] as string[], approved: [] as string[], prepare: [] as unknown[] };
  api.settingsValues = async () => [{ key: "companions.preview_shells", value: true, source: "user", label: "Preview", level: "basic", secret: false }] as never;
  api.companions = async () => ({ allowed: true, can_create: options.canCreate ?? true, can_discover: false, default_id: "x", companions: [], discover: [], robots: null });
  api.editCompanion = async () => ({ id: "hc-one", name: "Marlow" }) as never;
  api.createCompanionDraft = async () => { calls.draft++; return { id: "hc-one" }; };
  api.getCompanionLookStyles = async () => ({ styles: options.styles ?? adultStyles, keep: { id: "keep" as const, label: "Keep as is" } });
  api.companionLook = async () => options.lookData ?? look();
  api.generateCompanionLook = async (_id, body) => { calls.generate.push(body); return { job: "job-1" }; };
  api.companionLookJob = async () => ({ state: "done", percent: 100, label: "Done", versions: [{ id: "v-1", url: "/x", label: "Picture v-1" }], error: null });
  api.approveCompanionLook = async (_id, v) => { calls.approved.push(v); return { job: "sheet-1" }; };
  api.prepareCompanionLook = async (_id, body) => { calls.prepare.push(body); return { id: "v-2" }; };
  api.deleteCompanion = async (id) => { calls.deleted.push(id); };
  api.companionStates = async () => ({ sheet_ready: true, start_ready: true, key: "#00FF00", states: [], run: null, counts: { approved: 0, total: 0, required_missing: [] } });
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

test("the style tiles show at once, before a name or a draft exists", async () => {
  const { view, calls } = open();
  for (const label of ["Realistic", "Cartoon", "Anime", "3D", "Pixel", "Custom"]) expect(await view.findByRole("button", { name: label })).toBeTruthy();
  expect(view.queryByText(/Enter a name above/)).toBeNull();
  expect(calls.draft).toBe(0);
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
  const teen = open({ styles: teenStyles, lookData: look({ styles: teenStyles }) }); await nameIt(teen.view);
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
  expect(view.queryByLabelText("Remove background")).toBeNull();
  fireEvent.click(button(view, "Approve & Continue"));
  await waitFor(() => expect(calls.approved).toEqual(["v-1"]));
  await view.findByText("Step 2 of 3 · Generate and review your animations");
  expect(view.getByText("Generate Required")).toBeTruthy();
});

const reopened = (overrides: Partial<CompanionLook> = {}) => open({ path: "/companions/hc-one/create", lookData: look({ versions: [version("v-1")], rest: "v-1", ...overrides }) });
const dragBox = async (view: ReturnType<typeof open>["view"]) => {
  const box = (await view.findByRole("application", { name: /Character position/ })) as HTMLElement;
  box.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200, toJSON: () => ({}) });
  return box;
};

test("there is no Remove background control anywhere on screen 1", async () => {
  const { view } = reopened(); await view.findByRole("application", { name: /Character position/ });
  expect(view.queryByText("Remove background")).toBeNull();
  expect(view.queryByRole("switch")).toBeNull();
});

test("the preview gets the strong frame and the checkerboard", async () => {
  const { view } = reopened(); await view.findByRole("application", { name: /Character position/ });
  const stage = document.querySelector('[data-slot="generation-stage"]')!;
  expect(stage.getAttribute("data-frame")).toBe("strong");
  expect(stage.getAttribute("data-transparency")).toBe("checker");
});

test("dragging moves the picture live, then asks Home once to place it after the pause", async () => {
  const { view, calls } = reopened(); const box = await dragBox(view);
  api.prepareCompanionLook = async (_id, body) => { calls.prepare.push(body); api.companionLook = async () => look({ versions: [version("v-1"), version("v-2")], rest: "v-1" }); return { id: "v-2" }; };
  fireEvent.pointerDown(box, { clientX: 100, clientY: 100, pointerId: 1 });
  fireEvent.pointerMove(box, { clientX: 120, clientY: 90, pointerId: 1 });
  fireEvent.pointerMove(box, { clientX: 140, clientY: 80, pointerId: 1 });
  fireEvent.pointerUp(box, { clientX: 140, clientY: 80, pointerId: 1 });
  const picture = box.querySelector("img")!;
  expect([picture.style.getPropertyValue("--dx"), picture.style.getPropertyValue("--dy")]).toEqual(["20%", "-10%"]);
  expect(calls.prepare).toEqual([]);
  await waitFor(() => expect(calls.prepare.length).toBe(1), { timeout: 2000 });
  const sent = calls.prepare[0] as { version_id: string; remove_background: boolean; frame: { zoom: number; x: number; y: number } };
  expect(sent.version_id).toBe("v-1"); expect(sent.remove_background).toBe(true);
  expect(sent.frame.zoom).toBe(1); expect(sent.frame.x).toBeCloseTo(0.7, 5); expect(sent.frame.y).toBeCloseTo(0.4, 5);
  // The placed picture replaces the live move, so the picture does not jump.
  await waitFor(() => expect([picture.style.getPropertyValue("--dx"), picture.style.getPropertyValue("--dy")]).toEqual(["0%", "0%"]));
});

test("the arrow keys move the character and the wheel zooms it", async () => {
  const { view, calls } = reopened(); const box = await dragBox(view);
  fireEvent.keyDown(box, { key: "ArrowRight" }); fireEvent.keyDown(box, { key: "ArrowRight" }); fireEvent.keyDown(box, { key: "ArrowDown" });
  fireEvent.wheel(box, { deltaY: -100 });
  await waitFor(() => expect(calls.prepare.length).toBe(1), { timeout: 2000 });
  const sent = calls.prepare[0] as { frame: { zoom: number; x: number; y: number } };
  expect(sent.frame.x).toBeCloseTo(0.54, 5); expect(sent.frame.y).toBeCloseTo(0.52, 5); expect(sent.frame.zoom).toBeCloseTo(1.22, 2); /* the wheel zooms by a fixed share per notch (no upper limit), 1.22 for 100 */
});

test("a running job disables Generate with a busy label and shows the percent and label as a progress bar", async () => {
  const { view } = open(); await nameIt(view); await view.findByRole("button", { name: "Cartoon" });
  api.companionLookJob = async () => ({ state: "running", percent: 40, label: "Making the picture", versions: [], error: null });
  fireEvent.change(view.getByLabelText("Describe the character"), { target: { value: "A fox" } });
  await act(async () => { fireEvent.click(button(view, "Generate Character")); });
  const busy = await view.findByRole("button", { name: "Making your character..." }) as HTMLButtonElement;
  expect(busy.disabled).toBe(true);
  const bar = await view.findByRole("progressbar", { name: "Making the picture" });
  expect((bar.querySelector("[data-slot=progress-indicator]") as HTMLElement).style.transform).toBe("translateX(-60%)");
  expect(view.getByText("Making the picture")).toBeTruthy();
  expect(view.getByRole("button", { name: "Stop" })).toBeTruthy();
});

test("Approve shows its busy label while the request is in flight and an error under the button", async () => {
  const { view } = reopened(); await waitFor(() => expect(button(view, "Approve & Continue").disabled).toBe(false));
  let fail: (e: Error) => void = () => {};
  api.approveCompanionLook = () => new Promise((_resolve, reject) => { fail = reject; });
  fireEvent.click(button(view, "Approve & Continue"));
  const busy = await view.findByRole("button", { name: "Getting your character ready..." }) as HTMLButtonElement;
  expect(busy.disabled).toBe(true);
  await act(async () => { fail(new ApiError("Home could not save this picture. Try again.", 500)); });
  expect((await view.findByRole("alert")).textContent).toBe("Home could not save this picture. Try again.");
  expect(button(view, "Approve & Continue").disabled).toBe(false);
});

test("a cut-off picture is completed once by itself, with no Fill in button", async () => {
  const { view } = open({ path: "/companions/hc-one/create", lookData: look({ versions: [{ ...version("v-1"), clipped: ["bottom"] }], rest: null }) });
  const asked: string[] = [];
  api.completeCompanionLook = async (_id, versionId) => { asked.push(versionId); return { job: "job-9" }; };
  await waitFor(() => expect(asked).toEqual(["v-1"]));
  expect(view.queryByRole("button", { name: "Fill in the cut-off parts" })).toBeNull();
  expect(view.queryByRole("slider")).toBeNull();
});

test("a 409 from the automatic fill-in shows Home's sentence", async () => {
  const { view } = open({ path: "/companions/hc-one/create", lookData: look({ versions: [{ ...version("v-1"), clipped: ["left"] }], rest: null }) });
  api.completeCompanionLook = async () => { throw new ApiError("A picture is already being made for this companion. Wait for it or stop it.", 409); };
  expect((await view.findByRole("alert")).textContent).toBe("A picture is already being made for this companion. Wait for it or stop it.");
});

test("a chosen photo uploads at once, shows a thumbnail and shows on the right as it is, with Generate switched off", async () => {
  URL.createObjectURL = () => "blob:photo"; URL.revokeObjectURL = () => undefined;
  const { view } = open(); await nameIt(view);
  fireEvent.click(await view.findByRole("radio", { name: "Upload Photo" }));
  const uploads: File[] = [];
  api.uploadCompanionLook = async (_id, body) => { uploads.push(body.get("image") as File); return { id: "v-1", clipped: [] } as never; };
  api.companionLook = async () => look({ versions: [version("v-1")], rest: null });
  const input = await view.findByLabelText("Photo"); const photo = new File([new Uint8Array([1])], "me.jpeg", { type: "image/jpeg" });
  fireEvent.change(input, { target: { files: [photo] } });
  await waitFor(() => expect(uploads).toHaveLength(1));
  expect(await view.findByAltText("Your upload")).toBeTruthy();
  await view.findByRole("application", { name: /Character position/ });
  expect(button(view, "Generate Character").disabled).toBe(true);
});

test("Approve opens screen 2 at once and screen 2 waits for the character to be made ready", async () => {
  const { view, calls } = open({ path: "/companions/hc-one/create", lookData: look({ versions: [version("v-1")], rest: "v-1" }) });
  api.companionLookJob = async () => ({ state: "running", percent: 40, label: "Making character sheet", versions: [], error: null });
  api.companionStates = async () => ({ sheet_ready: false, start_ready: false, key: "#00FF00", states: [], run: null, counts: { approved: 0, total: 0, required_missing: [] } });
  await waitFor(() => expect(button(view, "Approve & Continue").disabled).toBe(false));
  fireEvent.click(await view.findByRole("button", { name: "Approve & Continue" }));
  expect(await view.findByText("Drawing your character from the sides and with its mouth open, so every animation matches. This takes a few minutes, and your animations start by themselves when it is done.")).toBeTruthy();
  expect(calls.approved).toEqual(["v-1"]);
});

test("when the character could not be made ready, screen 2 says so and Try again approves the picture again", async () => {
  const { view, calls } = open({ path: "/companions/hc-one/create", lookData: look({ versions: [version("v-1")], rest: "v-1" }) });
  api.companionLookJob = async () => ({ state: "failed", percent: 0, label: "Failed", versions: [], error: "The side view did not work. Try again." });
  api.companionStates = async () => ({ sheet_ready: false, start_ready: false, key: "#00FF00", states: [], run: null, counts: { approved: 0, total: 0, required_missing: [] } });
  await waitFor(() => expect(button(view, "Approve & Continue").disabled).toBe(false));
  fireEvent.click(await view.findByRole("button", { name: "Approve & Continue" }));
  expect((await view.findByText("The side view did not work. Try again.")).tagName).toBe("P");
  fireEvent.click(await view.findByRole("button", { name: "Try again" }));
  await waitFor(() => expect(calls.approved).toEqual(["v-1", "v-1"]));
});

test("closing with an empty draft asks keep or discard; discard deletes it", async () => {
  const { view, calls } = open(); await nameIt(view); await view.findByRole("button", { name: "Cartoon" });
  // The tiles show before the draft exists, so wait for the draft and its (empty) look before closing.
  await waitFor(() => expect(calls.draft).toBe(1)); await act(async () => { await Promise.resolve(); });
  fireEvent.click(view.getByRole("button", { name: "Close" }));
  expect(await view.findByText("Keep this draft or discard it?")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Discard" }));
  await waitFor(() => expect(calls.deleted).toEqual(["hc-one"]));
  await waitFor(() => expect(view.getByTestId("where").textContent).toBe("/companions"));
});

test("closing while the draft is still being made waits for it, then asks keep or discard", async () => {
  const { view, calls } = open();
  let finish: (value: { id: string }) => void = () => {};
  api.createCompanionDraft = () => { calls.draft++; return new Promise((resolve) => { finish = resolve; }); };
  await nameIt(view); await waitFor(() => expect(calls.draft).toBe(1));
  fireEvent.click(view.getByRole("button", { name: "Close" }));
  await act(async () => { await Promise.resolve(); });
  // Still waiting: it neither left the dialog nor asked yet.
  expect(view.queryByTestId("where")).toBeNull();
  expect(view.queryByText("Keep this draft or discard it?")).toBeNull();
  await act(async () => { finish({ id: "hc-one" }); });
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
