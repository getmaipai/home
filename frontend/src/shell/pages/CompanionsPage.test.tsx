import { afterEach, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, ApiError, type CompanionCard, type CompanionDetail, type CompanionList } from "@/lib/api";
import { CompanionDetailPage, CompanionsPage } from "@/shell/pages/CompanionsPage";
import { CompanionShellViewer } from "@/lib/companionShells";

const originals = { companions: api.companions, companion: api.companion, setDefaultCompanion: api.setDefaultCompanion, deleteCompanion: api.deleteCompanion, stackVoices: api.stackVoices, setSetting: api.setSetting, settingsValues: api.settingsValues };
afterEach(() => { cleanup(); Object.assign(api, originals); });

function card(overrides: Partial<CompanionCard> = {}): CompanionCard {
  return {
    id: "lively-child", name: "Sprout", type: "child", type_label: "Child companion", tagline: "A cheerful friend.", who_can_use: "Anyone in the family, including kids.",
    dials: [{ label: "How it talks", value: "Talks like a friend." }, { label: "Word choice", value: "Short, simple words." }, { label: "Questions back", value: "Asks you things back and wants to know more." }, { label: "Casual chatter", value: "A few casual words." }],
    voice: "Alba", is_default: false, is_household: false, status: "ready", chats: 0, can_edit: false, can_copy: false, ...overrides,
  };
}
function detail(overrides: Partial<CompanionDetail> = {}): CompanionDetail {
  return { ...card(), about: "Sprout loves questions.", pronouns: "they/them", interests: ["animals"], examples: ["Wow, a slushie? What flavor?"], voice_value: "default", voice_is_own: false, voice_setting: null, used_by: null, ...overrides };
}
function open(path: string, preview = false, viewer = { id: "viewer" } as never) {
  api.stackVoices = async () => ({ voices: [] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><CompanionShellViewer.Provider value={preview ? viewer : null}><MemoryRouter initialEntries={[path]}><Routes><Route path="/companions" element={<CompanionsPage />} /><Route path="/companions/:id" element={<CompanionDetailPage />} /></Routes></MemoryRouter></CompanionShellViewer.Provider></QueryClientProvider>);
}

async function openCardActions(view: { findByRole: (role: string, opts: { name: string }) => Promise<HTMLElement> }) {
  const trigger = await view.findByRole("button", { name: "Companion actions" });
  act(() => { fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1 }); fireEvent.click(trigger); });
}

test("the gallery shows character tiles, default check and new companion tile", async () => {
  api.companions = async (): Promise<CompanionList> => ({ allowed: true, can_create: true, can_discover: true, companions: [card({ is_household: true, status: "draft" }), card({ id: "lively-teen", name: "Riff", type: "teen", type_label: "Teen companion", is_default: true })], robots: null, default_id: "lively-teen" });
  const view = open("/companions");
  await waitFor(() => expect(view.getByText("Sprout")).toBeTruthy());
  expect(view.queryByText("Child companion")).toBeNull();
  expect(view.queryByText("Teen companion")).toBeNull();
  expect(view.getAllByText("A cheerful friend.").length).toBe(2);
  expect(view.getByRole("button", { name: "Riff" }).getAttribute("aria-pressed")).toBe("true");
  expect(view.queryByRole("link", { name: "New companion" })).toBeNull();
  expect(view.getAllByRole("button", { name: "New companion" }).length).toBe(1);
  expect(view.queryByText("Made at home")).toBeNull();
  expect(view.queryByText("Draft")).toBeNull();
  expect(view.queryByText("Robots")).toBeNull();
});

test("preview status uses the kit badge and tile selection opens its detail", async () => {
  api.settingsValues = async () => [{ key: "companions.preview_shells", value: true, source: "user", label: "Preview", level: "basic", secret: false }] as never;
  api.companions = async (): Promise<CompanionList> => ({ allowed: true, can_create: false, can_discover: false, companions: [card({ id: "lively-child" })], robots: null, default_id: "" });
  const view = open("/companions", true, { id: "viewer" } as never);
  const status = await view.findByText("Needs approval");
  expect(status.className).toContain("cn-badge");
  expect(view.getByRole("button", { name: "Sprout" })).toBeTruthy();
});

test("standard companion card selection opens detail", async () => {
  api.companions = async (): Promise<CompanionList> => ({ allowed: true, can_create: false, can_discover: false, companions: [card()], robots: null, default_id: "" });
  api.companion = async () => detail();
  const view = open("/companions");
  fireEvent.click(await view.findByRole("button", { name: "Sprout" }));
  await waitFor(() => expect(view.getByText("Sprout loves questions.")).toBeTruthy());
});

test("card actions set a default without opening the card", async () => {
  api.companions = async (): Promise<CompanionList> => ({ allowed: true, can_create: false, can_discover: true, companions: [card()], robots: null, default_id: "" });
  const saved: string[] = [];
  api.setDefaultCompanion = async (id) => { saved.push(id); return { default_id: id }; };
  const view = open("/companions");
  await view.findByText("Sprout");
  await openCardActions(view);
  fireEvent.click(await view.findByRole("menuitem", { name: "Set as my default" }));
  await waitFor(() => expect(saved).toEqual(["lively-child"]));
  expect(view.getByTestId("companions")).toBeTruthy();
  expect(view.queryByText("Sprout loves questions.")).toBeNull();
});

test("card delete asks for confirmation before deleting a household companion", async () => {
  api.companions = async (): Promise<CompanionList> => ({ allowed: true, can_create: false, can_discover: false, companions: [card({ is_household: true, can_edit: true })], robots: null, default_id: "" });
  const deleted: string[] = [];
  api.deleteCompanion = async (id) => { deleted.push(id); };
  const view = open("/companions");
  await view.findByText("Sprout");
  await openCardActions(view);
  fireEvent.click(await view.findByRole("menuitem", { name: "Delete" }));
  expect(await view.findByText("Delete Sprout?")).toBeTruthy();
  expect(view.getByTestId("companions")).toBeTruthy();
  expect(view.queryByText("Sprout loves questions.")).toBeNull();
  expect(await view.findByText("This removes it for the whole home.")).toBeTruthy();
  expect(deleted).toEqual([]);
  fireEvent.click(view.getAllByRole("button", { name: "Delete" }).at(-1)!);
  await waitFor(() => expect(deleted).toEqual(["lively-child"]));
});

test("the gallery does not list robots; robot companions are set in Settings", async () => {
  api.companions = async (): Promise<CompanionList> => ({ allowed: true, can_create: false, can_discover: true, default_id: "lively-child", companions: [card()], robots: [{ id: "d1", name: "StackChan", controls: "child", companion_id: "lively-child", companion_name: "Sprout" }] });
  const view = open("/companions");
  await waitFor(() => expect(view.getByText("Sprout")).toBeTruthy());
  expect(view.queryByText(/StackChan/)).toBeNull();
});

test("when companions are off for the person the page says so", async () => {
  api.companions = async (): Promise<CompanionList> => ({ allowed: false, can_create: false, can_discover: false, companions: [], robots: null, default_id: "lively-teen" });
  const view = open("/companions");
  await waitFor(() => expect(view.getByText(/turned off for you/)).toBeTruthy());
});

test("the household detail shows settings icon and copy actions", async () => {
  api.companion = async () => detail({ is_household: true, can_edit: true, can_copy: true });
  api.copyCompanion = async () => ({ id: "copy-id" });
  const saved: string[] = [];
  api.setDefaultCompanion = async (id) => { saved.push(id); return { default_id: id }; };
  const view = open("/companions/lively-child");
  await waitFor(() => expect(view.getByText("Sprout loves questions.")).toBeTruthy());
  expect(view.getByText("Talks like a friend.")).toBeTruthy();
  expect(view.getByText(/Wow, a slushie/)).toBeTruthy();
  expect(view.getByRole("button", { name: "Play a sample" })).toBeTruthy();
  const settingsButton = view.getByRole("button", { name: "Companion settings" });
  const settingsLink = settingsButton.closest("a");
  expect(settingsLink).toBeTruthy();
  expect(settingsLink!.getAttribute("href")).toBe("/companions/lively-child/edit");
  expect(view.getByRole("button", { name: "Make a copy" })).toBeTruthy();
  expect(view.queryByText("Who uses it")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Set as my default" }));
  await waitFor(() => expect(saved).toEqual(["lively-child"]));
  await waitFor(() => expect((view.getByRole("button", { name: "Your default" }) as HTMLButtonElement).disabled).toBe(true));
});

test("a bundled companion makes editing through a copy clear", async () => {
  api.companion = async () => detail({ is_household: false, can_edit: false, can_copy: true });
  const view = open("/companions/lively-child");
  await waitFor(() => expect(view.getByText("Sprout loves questions.")).toBeTruthy());
  expect(view.getByRole("button", { name: "Edit a copy" })).toBeTruthy();
  expect(view.getByText("This companion comes with Home, so it can't be changed. Make a copy and edit that.")).toBeTruthy();
  expect(view.queryByRole("link", { name: "Companion settings" })).toBeNull();
});

test("a refused save shows the sentence from the hub", async () => {
  api.companion = async () => detail();
  api.setDefaultCompanion = async () => { throw new ApiError("Companions are turned off for you. Ask an owner or admin to turn them on.", 403); };
  const view = open("/companions/lively-child");
  fireEvent.click(await view.findByRole("button", { name: "Set as my default" }));
  await waitFor(() => expect(view.getByText(/Ask an owner or admin/)).toBeTruthy());
});

test("an admin's detail lists the people and robots using the companion", async () => {
  api.companion = async () => detail({ used_by: { people: [{ id: "p1", name: "Marlow" }], robots: [{ id: "d1", name: "StackChan" }] } });
  const view = open("/companions/lively-child");
  await waitFor(() => expect(view.getByText("Who uses it")).toBeTruthy());
  expect(view.getByText(/People: Marlow/)).toBeTruthy();
  expect(view.getByText(/Robots: StackChan/)).toBeTruthy();
});

test("a companion that is not on the person's list reads as a plain message", async () => {
  api.companion = async () => { throw new ApiError("No such companion", 404); };
  const view = open("/companions/lively-adult");
  await waitFor(() => expect(view.getByText(/not on your list/)).toBeTruthy());
});

test("an admin picks the companion's voice and it saves to the household setting", async () => {
  api.companion = async () => detail({ voice_setting: "default", used_by: { people: [], robots: [] } });
  api.stackVoices = async () => ({ voices: [{ id: "alba", name: "Alba", source: "preset", onDisk: true } as never] });
  const saved: Array<[string, string, unknown]> = [];
  api.setSetting = (async (scope: string, key: string, value: unknown) => { saved.push([scope, key, value]); return {} as never; }) as typeof api.setSetting;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/companions/lively-child"]}><Routes><Route path="/companions/:id" element={<CompanionDetailPage />} /></Routes></MemoryRouter></QueryClientProvider>);
  const picker = await view.findByLabelText("Voice for this companion");
  expect(saved).toEqual([]);
  fireEvent.click(picker);
  fireEvent.click(await view.findByRole("option", { name: "Alba" }));
  await waitFor(() => expect(saved).toEqual([["household", "companion.voice.lively_child", "alba"]]));
});

test("a person who is not an admin gets no voice picker", async () => {
  api.companion = async () => detail();
  const view = open("/companions/lively-child");
  await waitFor(() => expect(view.getByText("Sprout loves questions.")).toBeTruthy());
  expect(view.queryByLabelText("Voice for this companion")).toBeNull();
});


test("preview tabs show status and activity, and the detail page is a hero with rows", async () => {
  api.settingsValues = async () => [{ key: "companions.preview_shells", value: true, source: "user", label: "Preview", level: "basic", secret: false }] as never;
  api.companions = async () => ({ allowed: true, can_create: true, can_discover: true, default_id: "lively-teen", robots: null,
    companions: [card({ id: "lively-child", name: "Sprout", chats: 2 }), card({ id: "lively-teen", name: "Riff", is_default: true, chats: 0 })] });
  const yours = open("/companions", true);
  await waitFor(() => expect(yours.getAllByText(/^(Working|Idle|Needs approval)$/).length).toBe(2));
  expect(yours.getByText("Sample activity. Real activity is coming soon.")).toBeTruthy();
  expect(yours.queryByRole("button", { name: "Add" })).toBeNull();
  expect(yours.getAllByRole("button", { name: "New companion" }).length).toBe(1);
  expect(yours.queryByRole("link", { name: "New companion" })).toBeNull();
  const discover = yours.getByRole("tab", { name: "Discover" });
  fireEvent.mouseDown(discover, { button: 0 });
  fireEvent.click(discover);
  await waitFor(() => expect(yours.getByRole("button", { name: "Sprout" })).toBeTruthy());
  expect(yours.queryByText("Riff")).toBeNull();
  expect((yours.getByRole("button", { name: "Add" }) as HTMLButtonElement).disabled).toBe(true);
  cleanup();
  api.companion = async () => detail({ can_edit: true });
  const detailView = open("/companions/lively-child", true);
  await waitFor(() => expect(detailView.getByRole("button", { name: /^Voice/ })).toBeTruthy());
  expect(detailView.queryByRole("tab")).toBeNull();
  expect(detailView.queryByText(/Coming soon: (tasks|your chats)/)).toBeNull();
  expect(detailView.getByRole("link", { name: "All companions" }).getAttribute("href")).toBe("/companions");
  expect(detailView.queryByText("Sprout loves questions.")).toBeNull();
  expect((detailView.getByRole("button", { name: "Chat" }) as HTMLButtonElement).disabled).toBe(true);
  expect(detailView.getByRole("button", { name: "Companion actions" })).toBeTruthy();
  fireEvent.click(detailView.getByRole("button", { name: /Recent activity/ }));
  expect(await detailView.findByText("Sample activity. Real activity is coming soon.")).toBeTruthy();
});

test("preview discovery is hidden when the list says it is unavailable", async () => {
  api.settingsValues = async () => [{ key: "companions.preview_shells", value: true, source: "user", label: "Preview", level: "basic", secret: false }] as never;
  api.companions = async () => ({ allowed: true, can_create: false, can_discover: false, default_id: "lively-child", companions: [card()], robots: null });
  const view = open("/companions", true);
  await waitFor(() => expect(view.getByRole("tab", { name: "Yours" })).toBeTruthy());
  expect(view.queryByRole("tab", { name: "Discover" })).toBeNull();
});
