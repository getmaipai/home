import { afterAll, afterEach, expect, mock, spyOn, test } from "bun:test";
import { createElement } from "react";
import * as sonner from "sonner";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, ApiError, type CompanionEditable, type CompanionLook, type CompanionLookJob } from "@/lib/api";
import { CompanionEditorPage } from "@/shell/pages/CompanionEditorPage";

const realStackedAlphaVideo = { ...(await import("@maipai/ui/src/elements/stacked-alpha-video")) };
mock.module("@maipai/ui/src/elements/stacked-alpha-video", () => ({ StackedAlphaVideo: ({ src, label }: { src: string; label: string }) => createElement("div", { role: "img", "aria-label": label, "data-testid": "stacked-alpha-video", "data-src": src }) }));

const methods = ["editCompanion", "stackVoices", "companionLook", "companionLookPrompt", "generateCompanionLook", "companionLookJob", "cancelCompanionLookJob", "uploadCompanionLook", "setCompanionLookRest", "deleteCompanionLookVersion", "editCompanionLook", "makeCompanionLookSheet", "saveCompanionLookCard", "setCompanionLookKey", "approveCompanionLookSheet", "unapproveCompanionLookSheet"] as const;
const originals = Object.fromEntries(methods.map((key) => [key, api[key]]));
afterAll(() => { mock.module("@maipai/ui/src/elements/stacked-alpha-video", () => realStackedAlphaVideo); });
afterEach(() => { cleanup(); Object.assign(api, originals); });
const version = (id: string, label = `Picture ${id}`) => ({ id, label, source: "generated" as const, width: 480, height: 480, created_at: "2026-10-21T12:00:00Z", from: null, url: `/api/companions/hc-one/look/${id}/image` });
function look(overrides: Partial<CompanionLook> = {}): CompanionLook { return { versions: [version("v-1"), version("v-2")], rest: "v-1", key: `#${"00FF00"}`, sheet: { views: { left: null, right: null, mouth: null }, card: null, key: `#${"00FF00"}`, state: "empty", approved_by: null, approved_at: null }, ready_for_video: false, start_ready: false, can_generate: true, ...overrides }; }
function record(overrides: Partial<CompanionEditable> = {}): CompanionEditable { return { id: "hc-one", name: "Marlow", pronouns: null, tagline: "A calm helper", backstory: "Likes questions", interests: [], formality: "neutral", complexity: "standard", engagement: "balanced", filler_density: "light", behavior: [], examples: ["Hello", "How are you?", "Let's look."], examples_child: [], examples_teen: [], examples_adult: [], voice_id: "default", look_prompt: "A friendly fox", audience: "adult", status: "draft", review: null, can_edit: true, can_copy: true, can_set_audience: false, look: { versions: 1, rest: "version-1", sheet_state: "approved" }, states: { approved: 0, total: 12 }, ...overrides }; }
function open(path = "/companions/hc-one/edit", lookData: CompanionLook = look()) { api.stackVoices = async () => ({ voices: [] }); api.editCompanion = async () => record(); api.companionLook = async () => lookData; const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Routes><Route path="/companions/new" element={<CompanionEditorPage />} /><Route path="/companions/:id/edit" element={<CompanionEditorPage />} /></Routes></MemoryRouter></QueryClientProvider>); }
async function selectLook(view: ReturnType<typeof open>) { const tab = await view.findByRole("tab", { name: "Look" }); await act(async () => { fireEvent.click(tab); fireEvent.keyDown(tab, { key: "Enter" }); }); await waitFor(() => expect(tab.getAttribute("aria-selected")).toBe("true")); }
async function showLook(view: ReturnType<typeof open>) { await selectLook(view); await view.findByText("Describe how the character looks: species, colours, clothes. Keep it simple and friendly."); }

test("new companion has no look editor and asks to save first", async () => { const view = open("/companions/new"); await selectLook(view); expect(await view.findByText("Save the companion first, then add its look.")).toBeTruthy(); expect(view.queryByText("Describe how the character looks: species, colours, clothes. Keep it simple and friendly.")).toBeNull(); });

test("generation is disabled with Home's reason and while the prompt is empty", async () => {
  const view = open("/companions/hc-one/edit", look({ can_generate: false, generate_reason: "Picture creation is not set up on this computer." })); await showLook(view); expect(view.getByText("Picture creation is not set up on this computer.")).toBeTruthy(); expect(view.getByRole("button", { name: "Generate 4 pictures" }).hasAttribute("disabled")).toBe(true);
  const second = open("/companions/hc-one/edit", look({ can_generate: true })); await showLook(second); fireEvent.change(second.getByLabelText("Look prompt"), { target: { value: "" } }); expect(second.getByRole("button", { name: "Generate 4 pictures" }).hasAttribute("disabled")).toBe(true);
});

test("Copy prompt fetches the latest pack even when Home picture generation is disabled", async () => {
  const text = "Character picture for Marlow\nPrompt: A friendly fox"; let copied = ""; let requested = 0;
  api.companionLookPrompt = async () => { requested++; return { title: "Character picture for Marlow", prompt: "A friendly fox", negative_prompt: "none", text }; };
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value: string) => { copied = value; } } });
  const toast = spyOn(sonner, "toast");
  const view = open("/companions/hc-one/edit", look({ can_generate: false })); await showLook(view);
  const button = view.getByRole("button", { name: "Copy prompt" }); expect((button as HTMLButtonElement).disabled).toBe(false); fireEvent.click(button);
  await waitFor(() => expect(copied).toBe(text)); expect(requested).toBe(1); expect(toast).toHaveBeenCalledWith("Prompt copied. Paste it into your tool."); toast.mockRestore();
});

test("Copy prompt shows selectable text when clipboard access is denied", async () => {
  const text = "Character picture for Marlow\nPrompt: A friendly fox";
  api.companionLookPrompt = async () => ({ title: "Character picture for Marlow", prompt: "A friendly fox", negative_prompt: "none", text });
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denied"); } } });
  const view = open(); await showLook(view); fireEvent.click(view.getByRole("button", { name: "Copy prompt" }));
  expect((await view.findByLabelText("Copy this text yourself.")).getAttribute("readonly")).not.toBeNull(); expect((view.getByLabelText("Copy this text yourself.") as HTMLTextAreaElement).value).toBe(text);
});

test("upload sends rights and likeness fields and shows Home's 400 sentence", async () => {
  let sent: FormData | undefined; api.uploadCompanionLook = async (_id, body) => { sent = body; throw new ApiError("Use a PNG, JPEG or WebP picture.", 400); };
  const view = open(); await showLook(view); fireEvent.click(view.getByRole("button", { name: "Upload a picture" })); fireEvent.change(view.getByLabelText("Picture (PNG, JPEG or WebP)"), { target: { files: [new File(["png"], "fox.png", { type: "image/png" })] } }); fireEvent.click(view.getByLabelText("I made this picture or have the right to use it")); fireEvent.click(view.getByRole("button", { name: "Upload" })); await waitFor(() => expect(view.getByText("Use a PNG, JPEG or WebP picture.")).toBeTruthy()); expect(sent?.get("rights_confirmed")).toBe("true"); expect(sent?.get("shows_real_person")).toBe("false"); expect(sent?.get("image")).toBeTruthy();
});

test("real person choice shows the line and disables upload", async () => { const view = open(); await showLook(view); fireEvent.click(view.getByRole("button", { name: "Upload a picture" })); fireEvent.click(view.getByLabelText("This is a picture of a real person")); expect(view.getByText("Pictures of real people are not supported here yet. Use a drawing or a character instead.")).toBeTruthy(); expect(view.getByRole("button", { name: "Upload" }).hasAttribute("disabled")).toBe(true); });

test("running generation polls, shows progress, and refreshes new pictures", async () => {
  let resolveJob!: (job: CompanionLookJob) => void; let completed = false;
  api.generateCompanionLook = async () => ({ job: "job-1" }); api.companionLookJob = async () => new Promise((resolve) => { resolveJob = resolve; });
  const view = open(); await showLook(view); api.companionLook = async () => look({ versions: completed ? [version("v-3", "New fox")] : [version("v-1"), version("v-2")] }); fireEvent.click(view.getByRole("button", { name: "Generate 4 pictures" })); await waitFor(() => expect(view.getByRole("progressbar")).toBeTruthy()); completed = true; resolveJob({ state: "done", percent: 100, label: "Pictures ready", versions: [{ id: "v-3", url: "/v-3", label: "New fox" }], error: null }); expect(await view.findByText("New fox")).toBeTruthy();
});

test("Stop cancels a job", async () => {
  api.generateCompanionLook = async () => ({ job: "job-2" }); api.companionLookJob = async () => new Promise(() => {}); let stopped = ""; api.cancelCompanionLookJob = async (_id, job) => { stopped = job; };
  const view = open(); await showLook(view); fireEvent.click(view.getByRole("button", { name: "Generate 4 pictures" })); fireEvent.click(await view.findByRole("button", { name: "Stop" })); await waitFor(() => expect(stopped).toBe("job-2"));
});

test("starting picture cannot be deleted; rest changes and edits call Home", async () => {
  const view = open(); await showLook(view); expect(view.getAllByRole("button", { name: "Delete" }).some((button) => button.hasAttribute("disabled"))).toBe(true); expect(view.getByText("Pick another starting picture first.")).toBeTruthy();
  let restId = ""; api.setCompanionLookRest = async (_id, id) => { restId = id; return { rest: id, sheet_reset: true }; }; const useButtons = view.getAllByRole("button", { name: "Use as starting picture" }); const enabledUse = useButtons.find((button) => !button.hasAttribute("disabled")); expect(enabledUse).toBeTruthy(); fireEvent.click(enabledUse!); await waitFor(() => expect(restId).toBeTruthy()); expect(await view.findByText("Changing the starting picture reset the character sheet. Make the sheet again and approve it.")).toBeTruthy();
  let edit: unknown; api.editCompanionLook = async (_id, body) => { edit = body; return { job: "job-edit" }; }; fireEvent.click(view.getAllByRole("button", { name: "Change it" })[0]!); fireEvent.change(view.getByLabelText("Say what to change"), { target: { value: "Make the scarf blue" } }); fireEvent.click(view.getByRole("button", { name: "Send" })); await waitFor(() => expect(edit).toEqual({ version_id: "v-2", instruction: "Make the scarf blue" }));
});

test("sheet has named empty views, starts a job, saves its card, and reports approve errors", async () => {
  const sheetLook = look({ sheet: { views: { left: null, right: null, mouth: null }, card: { text: "A small friendly fox with a blue scarf.", colours: ["blue"], species: "fox" }, key: `#${"00FF00"}`, state: "needs_review", approved_by: null, approved_at: null } });
  let resolveJob!: (job: CompanionLookJob) => void; api.makeCompanionLookSheet = async () => ({ job: "sheet-job", card_source: "look_prompt" }); api.companionLookJob = async () => new Promise((resolve) => { resolveJob = resolve; }); let saved = ""; api.saveCompanionLookCard = async (_id, body) => { saved = body.text; return { card: { text: body.text, colours: [], species: "fox" } }; }; api.approveCompanionLookSheet = async () => { throw new ApiError("A rest picture and description card are required.", 400); };
  const view = open("/companions/hc-one/edit", sheetLook); await showLook(view); expect(view.getByText("Turned left")).toBeTruthy(); expect(view.getByText("Turned right")).toBeTruthy(); expect(view.getByText("Mouth open")).toBeTruthy(); fireEvent.click(view.getByRole("button", { name: "Make the sheet" })); await waitFor(() => expect(view.getByRole("progressbar")).toBeTruthy()); resolveJob({ state: "done", percent: 100, label: "Sheet ready", versions: [], error: null }); await waitFor(() => expect(view.getByRole("button", { name: "Save card" }).hasAttribute("disabled")).toBe(false));
  fireEvent.change(view.getByLabelText("Description card"), { target: { value: "A little fox with soft orange fur, bright eyes and a neat blue scarf." } }); fireEvent.click(view.getByRole("button", { name: "Save card" })); await waitFor(() => expect(saved).toContain("soft orange fur")); fireEvent.click(view.getByRole("button", { name: "Approve the sheet" })); expect(await view.findByText("A rest picture and description card are required.")).toBeTruthy();
});

test("approved sheet shows its status after approval succeeds", async () => {
  const card = { text: "A small friendly fox with a blue scarf.", colours: [], species: "fox" }; const approved = { views: { left: null, right: null, mouth: null }, card, key: `#${"00FF00"}` as const, state: "approved" as const, approved_by: "Jesse", approved_at: "2026-10-21T12:00:00Z" };
  let current: CompanionLook = look({ sheet: { ...approved, state: "needs_review" } }); const view = open("/companions/hc-one/edit", current); await showLook(view); api.companionLook = async () => current; api.approveCompanionLookSheet = async () => { current = look({ sheet: approved }); return { sheet: approved }; }; fireEvent.click(view.getByRole("button", { name: "Approve the sheet" })); await waitFor(() => expect(view.getByText("Approved")).toBeTruthy());
});
