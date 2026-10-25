import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, ApiError, type CompanionCard, type CompanionDetail, type CompanionList } from "@/lib/api";
import { CompanionDetailPage, CompanionsPage } from "@/shell/pages/CompanionsPage";
import { CompanionShellViewer } from "@/lib/companionShells";

const originals = { companions: api.companions, companion: api.companion, setDefaultCompanion: api.setDefaultCompanion, stackVoices: api.stackVoices, setSetting: api.setSetting, settingsValues: api.settingsValues };
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

test("the gallery shows cards and create and household status badges", async () => {
  api.companions = async (): Promise<CompanionList> => ({ allowed: true, can_create: true, can_discover: true, companions: [card({ is_household: true, status: "draft" }), card({ id: "lively-teen", name: "Riff", type: "teen", type_label: "Teen companion", is_default: true })], robots: null, default_id: "lively-teen" });
  const view = open("/companions");
  await waitFor(() => expect(view.getByText("Sprout")).toBeTruthy());
  expect(view.getByText("Child companion")).toBeTruthy();
  expect(view.getByText("Teen companion")).toBeTruthy();
  expect(view.getAllByText("Short, simple words.").length).toBe(2);
  expect(view.getByText("Your default")).toBeTruthy();
  expect(view.getByRole("link", { name: "New companion" }).getAttribute("href")).toBe("/companions/new");
  expect(view.getByText("Made at home")).toBeTruthy();
  expect(view.getByText("Draft")).toBeTruthy();
  expect(view.queryByText("Robots")).toBeNull();
});

test("an admin sees which companion each robot has, with a link to its settings", async () => {
  api.companions = async (): Promise<CompanionList> => ({ allowed: true, can_create: false, can_discover: true, default_id: "lively-child", companions: [card()], robots: [{ id: "d1", name: "StackChan", controls: "child", companion_id: "lively-child", companion_name: "Sprout" }] });
  const view = open("/companions");
  await waitFor(() => expect(view.getByText(/StackChan: Sprout/)).toBeTruthy());
  expect(view.getByRole("link", { name: "Companion settings" }).getAttribute("href")).toBe("/settings/apps?tab=robot");
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


test("preview tabs show counts, discovery excludes default, and detail tasks are named", async () => {
  api.settingsValues = async () => [{ key: "companions.preview_shells", value: true, source: "user", label: "Preview", level: "basic", secret: false }] as never;
  api.companions = async () => ({ allowed: true, can_create: true, can_discover: true, default_id: "lively-teen", robots: null,
    companions: [card({ id: "lively-child", name: "Sprout", chats: 2 }), card({ id: "lively-teen", name: "Riff", is_default: true, chats: 0 })] });
  const yours = open("/companions", true);
  await waitFor(() => expect(yours.getByText(/\d tasks · 2 chats/)).toBeTruthy());
  expect(yours.getAllByText(/^(Working|Idle|Needs approval)$/).length).toBe(2);
  expect(yours.getAllByText(/Researching weekend plans|Last: Reviewed project|Expense report ready/).length).toBe(2);
  expect(yours.getByText("Sample activity. Real activity is coming soon.")).toBeTruthy();
  expect(yours.queryByRole("button", { name: "Add" })).toBeNull();
  expect(yours.getByRole("heading", { name: "Companions" }).parentElement?.parentElement?.contains(yours.getByRole("link", { name: "New companion" }))).toBe(true);
  const discover = yours.getByRole("tab", { name: "Discover" });
  fireEvent.mouseDown(discover, { button: 0 });
  fireEvent.click(discover);
  await waitFor(() => expect(yours.getByText("Included")).toBeTruthy());
  expect(yours.queryByText("Riff")).toBeNull();
  expect((yours.getByRole("button", { name: "Add" }) as HTMLButtonElement).disabled).toBe(true);
  cleanup();
  api.companion = async () => detail({ can_edit: true });
  const detailView = open("/companions/lively-child", true);
  await waitFor(() => expect(detailView.getByRole("tab", { name: "Tasks" })).toBeTruthy());
  const activity = detailView.getByRole("tab", { name: "Activity" });
  expect(activity.getAttribute("data-state")).toBe("active");
  expect(detailView.getByRole("tab", { name: "About" })).toBeTruthy();
  expect(detailView.getByRole("button", { name: "Set as my default" })).toBeTruthy();
  expect(detailView.getByRole("button", { name: "Companion settings" }).closest("a")?.getAttribute("href")).toBe("/companions/lively-child/edit");
  expect(detailView.queryByText("Sprout loves questions.")).toBeNull();
  expect(detailView.getByRole("heading", { name: "Recent activity" })).toBeTruthy();
  expect(detailView.getByText("Sample activity. Real activity is coming soon.")).toBeTruthy();
  expect((detailView.getByRole("button", { name: "Chat" }) as HTMLButtonElement).disabled).toBe(true);
  expect(detailView.getByRole("button", { name: "Chat" }).title).toBe("Coming soon");
  expect(detailView.getByRole("tab", { name: "Chats" })).toBeTruthy();
  expect(detailView.queryByText("Sprout loves questions.")).toBeNull();
  const tasks = detailView.getByRole("tab", { name: "Tasks" });
  fireEvent.mouseDown(tasks, { button: 0 });
  fireEvent.click(tasks);
  expect(await detailView.findByText("Coming soon: tasks Sprout is working on.")).toBeTruthy();
});

test("preview discovery is hidden when the list says it is unavailable", async () => {
  api.settingsValues = async () => [{ key: "companions.preview_shells", value: true, source: "user", label: "Preview", level: "basic", secret: false }] as never;
  api.companions = async () => ({ allowed: true, can_create: false, can_discover: false, default_id: "lively-child", companions: [card()], robots: null });
  const view = open("/companions", true);
  await waitFor(() => expect(view.getByRole("tab", { name: "Yours" })).toBeTruthy());
  expect(view.queryByRole("tab", { name: "Discover" })).toBeNull();
});
