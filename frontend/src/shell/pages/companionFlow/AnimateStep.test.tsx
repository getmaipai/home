import { afterEach, beforeEach, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, ApiError, type CompanionLook, type CompanionStateRow, type CompanionStates } from "@/lib/api";
import { CompanionShellViewer } from "@/lib/companionShells";
import { CompanionFlowPage } from "@/shell/pages/companionFlow/CompanionFlowPage";

const methods = ["settingsValues", "companions", "editCompanion", "companionLook", "companionStates", "generateCompanionStates", "companionStateRun", "generateCompanionKeyframe", "editCompanionKeyframe", "prepareCompanionKeyframe", "uploadCompanionKeyframe", "companionLookJob"] as const;
const originals = Object.fromEntries(methods.map((key) => [key, api[key]]));
const realMatchMedia = window.matchMedia;
afterEach(() => { cleanup(); Object.assign(api, originals); window.matchMedia = realMatchMedia; });
beforeEach(() => { window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as never; });

const ORDER = ["idle", "listening", "thinking", "speaking", "working", "researching", "writing", "done", "sleeping", "laughing", "surprised", "sad", "confused"];
const title = (id: string) => id[0]!.toUpperCase() + id.slice(1);
const urls = (id: string) => ({ h264: `/clip/${id}.h264.mp4`, av1: `/clip/${id}.av1.mp4`, still: `/clip/${id}.png` });
function row(id: string, extra: Partial<CompanionStateRow> = {}, madeIt = false): CompanionStateRow {
  return { id, label: title(id), kind: "loop", required: ORDER.indexOf(id) < 4, when_it_plays: `${title(id)} plays here`, default_motion: "", motion: "", approved: madeIt ? { take_id: "t1", approved_by: null, approved_at: null, urls: urls(id) } : null, takes: [], busy: false, keyframe: null, clip_out_of_date: false, status: madeIt ? "ready" : "missing", ...extra };
}
const states = (made: string[] = [], extra: Record<string, Partial<CompanionStateRow>> = {}): CompanionStates => ({ sheet_ready: true, start_ready: true, key: "#00FF00", states: ORDER.map((id) => row(id, extra[id], made.includes(id))), run: null, counts: { approved: made.length, total: 13, required_missing: [] } });
const version = { id: "v-1", label: "Picture", source: "generated" as const, width: 1024, height: 1024, created_at: "2026-10-29T12:00:00Z", from: null, url: "/portrait.png" };
const look: CompanionLook = { versions: [version], rest: "v-1", key: "#00FF00", sheet: null, ready_for_video: true, start_ready: true, can_generate: true, styles: [], audience_cap: "all" };

function open(data: () => CompanionStates) {
  const calls = { generate: [] as unknown[], keyframeMade: [] as string[], keyframeEdit: [] as unknown[], prepare: [] as unknown[] };
  api.settingsValues = async () => [{ key: "companions.preview_shells", value: true, source: "user", label: "Preview", level: "basic", secret: false }] as never;
  api.companions = async () => ({ allowed: true, can_create: true, can_discover: false, default_id: "x", companions: [], discover: [], robots: null });
  api.editCompanion = async () => ({ id: "hc-one", name: "Marlow" }) as never;
  api.companionLook = async () => look;
  api.companionStates = async () => data();
  api.generateCompanionStates = async (_id, body) => { calls.generate.push(body); return { job: "run-1" }; };
  api.companionStateRun = async () => ({ state: "running", label: "Making", percent: 40, current: null, takes_made: 0, error: null });
  api.generateCompanionKeyframe = async (_id, state) => { calls.keyframeMade.push(state); return { job: "kf-1" }; };
  api.editCompanionKeyframe = async (_id, state, instruction) => { calls.keyframeEdit.push([state, instruction]); return { job: "kf-2" }; };
  api.prepareCompanionKeyframe = async (_id, state, body) => { calls.prepare.push([state, body]); return { saved: true }; };
  api.companionLookJob = async () => ({ state: "running", percent: 10, label: "Working", versions: [], error: null });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><CompanionShellViewer.Provider value={{ id: "person-sage" } as never}><MemoryRouter initialEntries={["/companions/hc-one/create?step=2"]}><Routes>
    <Route path="/companions/:id/create" element={<CompanionFlowPage />} />
  </Routes></MemoryRouter></CompanionShellViewer.Provider></QueryClientProvider>);
  return { view, calls };
}
type View = ReturnType<typeof open>["view"];
const btn = (view: View, name: string) => view.getByRole("button", { name }) as HTMLButtonElement;

test("edit mode opens on step 2 with the 13 tiles in spec order, 4 locked and 9 with checkboxes", async () => {
  const { view } = open(() => states());
  await view.findByText("Step 2 of 3 · Generate and review your animations");
  await view.findByRole("button", { name: "Idle" });
  const names = view.getAllByRole("button").map((b) => b.getAttribute("aria-label")).filter((n): n is string => ORDER.map(title).includes(n ?? ""));
  expect(names).toEqual(ORDER.map(title));
  expect(view.getAllByRole("img", { name: "Required" }).length).toBe(4);
  expect(view.getAllByRole("checkbox").length).toBe(9);
  expect(view.getByText("4 animations · Always included")).toBeTruthy();
  expect(view.getByText("9 animations · Select the ones you want")).toBeTruthy();
  expect(view.getAllByText("No animation yet").length).toBe(13);
});

test("Select All and the Generate Optional count follow ticked, not-yet-made animations", async () => {
  const { view, calls } = open(() => states(["working"]));
  await view.findByRole("button", { name: "Idle" });
  expect(btn(view, "Generate Optional (0)").disabled).toBe(true);
  fireEvent.click(btn(view, "Select All"));
  expect(btn(view, "Generate Optional (8)").disabled).toBe(false);
  fireEvent.click(view.getByRole("checkbox", { name: "Select Sad" }));
  expect(btn(view, "Generate Optional (7)")).toBeTruthy();
  await act(async () => { fireEvent.click(btn(view, "Generate Optional (7)")); });
  expect(calls.generate).toEqual([{ states: ["researching", "writing", "done", "sleeping", "laughing", "surprised", "confused"], count: 1 }]);
});

test("Continue stays disabled until all four required animations are made", async () => {
  const some = open(() => states(["idle", "listening", "thinking"]));
  await some.view.findByRole("button", { name: "Idle" });
  expect(btn(some.view, "Continue").disabled).toBe(true);
  cleanup();
  const all = open(() => states(["idle", "listening", "thinking", "speaking"]));
  await all.view.findByRole("button", { name: "Idle" });
  expect(btn(all.view, "Continue").disabled).toBe(false);
  expect(btn(all.view, "Generate Required").disabled).toBe(true);
});

test("Generate Required asks for the missing required animations", async () => {
  const { view, calls } = open(() => states(["idle"]));
  await view.findByRole("button", { name: "Idle" });
  await act(async () => { fireEvent.click(btn(view, "Generate Required")); });
  expect(calls.generate).toEqual([{ states: ["listening", "thinking", "speaking"], count: 1 }]);
});

test("a tile click switches the preview caption; the clip plays, or its still shows under reduced motion", async () => {
  const { view } = open(() => states(["idle"], { idle: { keyframe: { url: "/kf/idle", edited_at: "2026-10-29T12:00:00Z" } } }));
  await view.findByRole("button", { name: "Idle" });
  // The first animation that is made plays in the preview by itself; the person's own choice after that stays.
  await waitFor(() => expect(view.getByText("Marlow · Idle")).toBeTruthy());
  expect(document.querySelector("video")).not.toBeNull();
  fireEvent.click(btn(view, "Listening"));
  expect(view.getByText("Marlow · Listening")).toBeTruthy();
  cleanup();
  window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} })) as never;
  const reduced = open(() => states(["idle"]));
  await reduced.view.findByRole("button", { name: "Idle" });
  fireEvent.click(btn(reduced.view, "Idle"));
  expect((reduced.view.getByAltText("Marlow Idle still") as HTMLImageElement).getAttribute("src")).toBe("/clip/idle.png");
  expect(document.querySelector("video")).toBeNull();
});

test("tiles use the keyframe picture, or the portrait dimmed until one exists", async () => {
  const { view } = open(() => states([], { idle: { keyframe: { url: "/kf/idle", edited_at: "2026-10-29T12:00:00Z" } } }));
  await view.findByRole("button", { name: "Idle" });
  const idle = btn(view, "Idle").querySelector("img")!, listening = btn(view, "Listening").querySelector("img")!;
  expect(idle.getAttribute("src")).toContain("/kf/idle");
  expect(listening.getAttribute("src")).toBe("/portrait.png");
  expect(listening.className).toContain("opacity-40");
});

test("Make another redoes the selected animation once", async () => {
  const { view, calls } = open(() => states(["idle"]));
  await view.findByRole("button", { name: "Idle" });
  await waitFor(() => expect(view.getByText("Marlow · Idle")).toBeTruthy()); /* the made animation is already selected */
  await act(async () => { fireEvent.click(btn(view, "Make another")); });
  expect(calls.generate).toEqual([{ states: ["idle"], count: 1 }]);
});

test("Edit keyframe opens the editor; its three actions call the keyframe routes", async () => {
  const { view, calls } = open(() => states(["idle"], { idle: { keyframe: { url: "/kf/idle", edited_at: "2026-10-29T12:00:00Z" } } }));
  await view.findByRole("button", { name: "Idle" });
  fireEvent.click(btn(view, "Idle"));
  fireEvent.click(btn(view, "Edit keyframe"));
  const dialog = await view.findByRole("dialog", { name: "Edit keyframe: Idle" });
  const inside = within(dialog);
  fireEvent.change(inside.getByLabelText("Describe a change"), { target: { value: "bigger smile" } });
  await act(async () => { fireEvent.click(inside.getByRole("button", { name: "Change picture" })); });
  expect(calls.keyframeEdit).toEqual([["idle", "bigger smile"]]);
  await waitFor(() => expect((inside.getByRole("button", { name: "Change picture" }) as HTMLButtonElement).disabled).toBe(true));
});

test("the keyframe editor has no Remove background control and always removes the background when placing", async () => {
  const { view } = open(() => states([], { idle: { keyframe: { url: "/kf/idle", edited_at: "2026-10-29T12:00:00Z" } } }));
  await view.findByRole("button", { name: "Idle" });
  fireEvent.click(btn(view, "Idle"));
  fireEvent.click(btn(view, "Edit keyframe"));
  const dialog = await view.findByRole("dialog", { name: "Edit keyframe: Idle" });
  expect(within(dialog).queryByRole("switch")).toBeNull();
  expect(within(dialog).queryByText("Remove background")).toBeNull();
  expect(within(dialog).getByRole("slider", { name: "Zoom" })).toBeTruthy();
});

test("an animation with no keyframe offers to make its picture first", async () => {
  const { view, calls } = open(() => states());
  await view.findByRole("button", { name: "Idle" });
  fireEvent.click(btn(view, "Idle"));
  fireEvent.click(btn(view, "Edit keyframe"));
  const dialog = await view.findByRole("dialog", { name: "Edit keyframe: Idle" });
  await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Make picture" })); });
  expect(calls.keyframeMade).toEqual(["idle"]);
});

test("tile words: Out of date, Waiting its turn, Needs another try, Making", async () => {
  const { view } = open(() => states(["idle"], {
    idle: { clip_out_of_date: true }, listening: { status: "waiting", status_label: "Waiting its turn" },
    thinking: { status: "Needs another try" }, speaking: { busy: true },
  }));
  await view.findByRole("button", { name: "Idle" });
  for (const word of ["Out of date", "Waiting its turn", "Needs another try", "Making"]) expect(view.getAllByText(word).length).toBe(1);
  expect(view.getByRole("progressbar", { name: "Speaking progress" })).toBeTruthy();
});

test("a refused clip request shows as one plain line", async () => {
  const { view } = open(() => states(["idle"]));
  await view.findByRole("button", { name: "Idle" });
  api.generateCompanionStates = async () => { throw new ApiError("The video engine is not ready. Check it, then try again.", 503); };
  fireEvent.click(btn(view, "Idle"));
  await act(async () => { fireEvent.click(btn(view, "Make another")); });
  const alerts = await view.findAllByRole("alert");
  expect(alerts.length).toBe(1);
  expect(alerts[0]!.textContent).toBe("The video engine is not ready. Check it, then try again.");
});
