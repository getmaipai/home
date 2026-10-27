import { afterEach, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, ApiError, type CompanionCard, type CompanionDetail, type CompanionList } from "@/lib/api";
import { CompanionDetailPage, CompanionsPage } from "@/shell/pages/CompanionsPage";
import { CompanionShellViewer } from "@/lib/companionShells";

const originals = { companions: api.companions, companion: api.companion, companionActivity: api.companionActivity, conversationList: api.conversationList, createConversation: api.createConversation, setDefaultCompanion: api.setDefaultCompanion, addCompanion: api.addCompanion, removeCompanion: api.removeCompanion, deleteCompanion: api.deleteCompanion, stackVoices: api.stackVoices, setSetting: api.setSetting, settingsValues: api.settingsValues };
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
  return render(<QueryClientProvider client={client}><CompanionShellViewer.Provider value={preview ? viewer : null}><MemoryRouter initialEntries={[path]}><LocationProbe /><Routes><Route path="/companions" element={<CompanionsPage />} /><Route path="/companions/:id" element={<CompanionDetailPage />} /><Route path="/chat" element={<div>Chat route</div>} /></Routes></MemoryRouter></CompanionShellViewer.Provider></QueryClientProvider>);
}
function LocationProbe() { const location = useLocation(); return <output data-testid="location">{location.pathname}{location.search}</output>; }

async function openCardActions(view: { findByRole: (role: string, opts: { name: string }) => Promise<HTMLElement> }) {
  const trigger = await view.findByRole("button", { name: "Companion actions" });
  act(() => { fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1 }); fireEvent.click(trigger); });
}

test("directory cards show status, meta, actions and the new companion link", async () => {
  api.companions = async (): Promise<CompanionList> => ({ allowed: true, can_create: true, can_discover: true, companions: [card({ is_household: true, status: "draft", portrait: "lively-child/v7" }), card({ id: "lively-teen", name: "Riff", type: "teen", type_label: "Teen companion", is_default: true })], discover: [], robots: null, default_id: "lively-teen" });
  const view = open("/companions");
  await waitFor(() => expect(view.getByRole("heading", { name: "Sprout" })).toBeTruthy());
  expect(view.getByText("Familiar faces. Different ways to help.")).toBeTruthy();
  expect(view.getByText("Draft · needs a portrait")).toBeTruthy();
  expect(view.getByText("Your default")).toBeTruthy();
  expect(view.getAllByText("A cheerful friend.").length).toBe(2);
  expect(view.getAllByText("Choose a conversation to get started").length).toBe(2);
  expect(view.getAllByRole("button", { name: "Chat" }).length).toBe(2);
  expect(view.getAllByRole("button", { name: "View profile" }).length).toBe(2);
  expect(view.getByRole("searchbox", { name: "Search companions" })).toBeTruthy();
  expect(view.getByRole("link", { name: "New companion" }).getAttribute("href")).toBe("/companions/new");
  // A portrait image only appears once the browser has loaded it, so the pictured card shows no seeded face yet; the card without a picture shows exactly one (never a bare letter).
  expect(view.container.querySelectorAll('img[src^="data:image/svg+xml"]').length).toBe(1);
  expect(view.getAllByRole("button", { name: "New companion" }).length).toBe(1);
  expect(view.queryByText("Robots")).toBeNull();
});

test("directory own-job and latest-activity meta lines render, and search filters name and tagline", async () => {
  api.companions = async () => ({ allowed: true, can_create: false, can_discover: true, default_id: "", companions: [
    card({ id: "busy", name: "Busy", working_count: 2, waiting_count: 1 }),
    card({ id: "recent", name: "Recent", latest_activity: "2026-10-27T12:00:00Z", chat_count: 3 }),
  ], discover: [card({ id: "finder", name: "Finder", tagline: "A patient research guide" })], robots: null });
  const view = open("/companions");
  await view.findByText("2 working · 1 waiting on you");
  expect(view.getByText(/Last active .* · 3 chats/)).toBeTruthy();
  fireEvent.change(view.getByRole("searchbox", { name: "Search companions" }), { target: { value: "patient" } });
  expect(view.queryByRole("heading", { name: "Busy" })).toBeNull();
  const discover = view.getByRole("tab", { name: "Discover" });
  fireEvent.mouseDown(discover, { button: 0 }); fireEvent.click(discover);
  expect(await view.findByRole("heading", { name: "Finder" })).toBeTruthy();
  expect(view.getByRole("button", { name: "Add" })).toBeTruthy();
});

test("preview companion tile selection opens its detail", async () => {
  api.settingsValues = async () => [{ key: "companions.preview_shells", value: true, source: "user", label: "Preview", level: "basic", secret: false }] as never;
  api.companions = async (): Promise<CompanionList> => ({ allowed: true, can_create: false, can_discover: false, companions: [card({ id: "lively-child" })], discover: [], robots: null, default_id: "" });
  const view = open("/companions", true, { id: "viewer" } as never);
  await waitFor(() => expect(view.getByText("Choose a conversation to get started")).toBeTruthy());
  expect(view.getByRole("heading", { name: "Sprout" })).toBeTruthy();
});

test("View profile opens the companion detail", async () => {
  api.companions = async (): Promise<CompanionList> => ({ allowed: true, can_create: false, can_discover: false, companions: [card()], discover: [], robots: null, default_id: "" });
  api.companion = async () => detail();
  api.companionActivity = async () => ({ activity: [{ id: "work-1", kind: "project", title: "A real project", state: "running", created_at: "2026-10-25T12:00:00Z", updated_at: "2026-10-25T12:00:00Z" }] });
  const view = open("/companions");
  fireEvent.click(await view.findByRole("button", { name: "View profile" }));
  await waitFor(() => expect(view.getByRole("tab", { name: "Activity" })).toBeTruthy());
  fireEvent.mouseDown(view.getByRole("tab", { name: "About" }), { button: 0 });
  expect(view.getByRole("heading", { name: "Sprout" })).toBeTruthy();
  fireEvent.mouseDown(view.getByRole("tab", { name: "Activity" }), { button: 0 });
  expect((await view.findAllByText("A real project")).length).toBeGreaterThan(0);
  fireEvent.mouseDown(view.getByRole("tab", { name: "Tasks" }), { button: 0 });
  expect(await view.findByText("Nothing needs you right now.")).toBeTruthy();
});

test("card actions set a default without opening the card", async () => {
  api.companions = async (): Promise<CompanionList> => ({ allowed: true, can_create: false, can_discover: true, companions: [card()], discover: [], robots: null, default_id: "" });
  const saved: string[] = [];
  api.setDefaultCompanion = async (id) => { saved.push(id); return { default_id: id }; };
  const view = open("/companions");
  await view.findByRole("heading", { name: "Sprout" });
  await openCardActions(view);
  fireEvent.click(await view.findByRole("menuitem", { name: "Set as my default" }));
  await waitFor(() => expect(saved).toEqual(["lively-child"]));
  expect(view.getByRole("heading", { name: "Sprout" })).toBeTruthy();
});

test("Add moves a discovered companion into Yours", async () => {
  api.settingsValues = async () => [{ key: "companions.preview_shells", value: true, source: "user", label: "Preview", level: "basic", secret: false }] as never;
  let held = [card({ id: "default", name: "MaiPai", is_default: true })];
  const added = card({ id: "pal", name: "Pal", type: "adult" });
  api.companions = async () => ({ allowed: true, can_create: false, can_discover: true, default_id: "default", companions: held, discover: held.some((item) => item.id === "pal") ? [] : [added], robots: null });
  api.addCompanion = async (id) => { held = [...held, added]; return { companions: ["default", id] }; };
  const view = open("/companions", true);
  const discoverTab = await view.findByRole("tab", { name: "Discover" });
  fireEvent.mouseDown(discoverTab, { button: 0 }); fireEvent.click(discoverTab);
  fireEvent.click(await view.findByRole("button", { name: "Add" }));
  await waitFor(() => expect(held.some((item) => item.id === "pal")).toBe(true));
  expect(held.some((item) => item.id === "pal")).toBe(true);
});

test("Yours menu removes a held companion", async () => {
  const pal = card({ id: "pal", name: "Pal", type: "adult" });
  api.companions = async () => ({ allowed: true, can_create: false, can_discover: true, default_id: "default", companions: [pal], discover: [], robots: null });
  let removed = "";
  api.removeCompanion = async (id) => { removed = id; return { companions: ["default"] }; };
  const view = open("/companions");
  await view.findByRole("heading", { name: "Pal" });
  await openCardActions(view);
  fireEvent.click(await view.findByRole("menuitem", { name: "Remove from Yours" }));
  await waitFor(() => expect(removed).toBe("pal"));
});

test("card delete asks for confirmation before deleting a household companion", async () => {
  api.companions = async (): Promise<CompanionList> => ({ allowed: true, can_create: false, can_discover: false, companions: [card({ is_household: true, can_edit: true })], discover: [], robots: null, default_id: "" });
  const deleted: string[] = [];
  api.deleteCompanion = async (id) => { deleted.push(id); };
  const view = open("/companions");
  await view.findByText("Sprout");
  await openCardActions(view);
  fireEvent.click(await view.findByRole("menuitem", { name: "Delete" }));
  expect(await view.findByText("Delete Sprout?")).toBeTruthy();
  expect(view.queryByRole("heading", { name: "Sprout" })).toBeNull();
  expect(await view.findByText("This removes it for the whole home.")).toBeTruthy();
  expect(deleted).toEqual([]);
  fireEvent.click(view.getAllByRole("button", { name: "Delete" }).at(-1)!);
  await waitFor(() => expect(deleted).toEqual(["lively-child"]));
});

test("the gallery does not list robots; robot companions are set in Settings", async () => {
  api.companions = async (): Promise<CompanionList> => ({ allowed: true, can_create: false, can_discover: true, default_id: "lively-child", companions: [card()], discover: [], robots: [{ id: "d1", name: "StackChan", controls: "child", companion_id: "lively-child", companion_name: "Sprout" }] });
  const view = open("/companions");
  await waitFor(() => expect(view.getByText("Sprout")).toBeTruthy());
  expect(view.queryByText(/StackChan/)).toBeNull();
});

test("when companions are off for the person the page says so", async () => {
  api.companions = async (): Promise<CompanionList> => ({ allowed: false, can_create: false, can_discover: false, companions: [], discover: [], robots: null, default_id: "lively-teen" });
  const view = open("/companions");
  await waitFor(() => expect(view.getByText(/turned off for you/)).toBeTruthy());
});

test("the household detail shows settings icon and copy actions", async () => {
  api.companion = async () => detail({ is_household: true, can_edit: true, can_copy: true, task_count: 2 });
  api.copyCompanion = async () => ({ id: "copy-id" });
  const saved: string[] = [];
  api.setDefaultCompanion = async (id) => { saved.push(id); return { default_id: id }; };
  const view = open("/companions/lively-child");
  await waitFor(() => expect(view.getByRole("tab", { name: "Activity" })).toBeTruthy());
  fireEvent.mouseDown(view.getByRole("tab", { name: "About" }), { button: 0 });
  expect(view.getByRole("heading", { name: "Sprout" })).toBeTruthy();
  expect(view.getByText(/Talks like a friend/)).toBeTruthy();
  expect(view.getByText(/Wow, a slushie/)).toBeTruthy();
  expect(view.getByRole("button", { name: "Play a sample" })).toBeTruthy();
  expect(view.getByRole("link", { name: "Edit" }).getAttribute("href")).toBe("/companions/lively-child/edit");
  expect(view.getByRole("button", { name: "Customize a copy" })).toBeTruthy();
  
  expect(saved).toEqual([]);
  expect(view.getByRole("button", { name: "Chat with Sprout" })).toBeTruthy();
  expect(view.getByText("Household companion")).toBeTruthy();
  expect(view.getAllByText("Anyone in the family, including kids.").length).toBeGreaterThan(0);
  expect(view.getByRole("tab", { name: "Activity" })).toBeTruthy();
  expect(view.getByRole("tab", { name: "About" })).toBeTruthy();
  expect(view.getByRole("tab", { name: "Tasks 2" })).toBeTruthy();
});

test("a bundled companion makes editing through a copy clear", async () => {
  api.companion = async () => detail({ is_household: false, can_edit: false, can_copy: true });
  const view = open("/companions/lively-child");
  await waitFor(() => expect(view.getByRole("tab", { name: "Activity" })).toBeTruthy());
  fireEvent.mouseDown(view.getByRole("tab", { name: "About" }), { button: 0 });
  expect(view.getByRole("button", { name: "Customize a copy" })).toBeTruthy();
  expect(view.getByText("This companion comes with Home, so it can't be changed. Make a copy and edit that.")).toBeTruthy();
  expect(view.queryByRole("link", { name: "Companion settings" })).toBeNull();
});

test("a refused save shows the sentence from the hub", async () => {
  api.companion = async () => detail();
  api.setDefaultCompanion = async () => { throw new ApiError("Companions are turned off for you. Ask an owner or admin to turn them on.", 403); };
  const view = open("/companions/lively-child");
  expect(view.queryByRole("button", { name: "Set as my default" })).toBeNull();
});

test("an admin's detail lists the people and robots using the companion", async () => {
  api.companion = async () => detail({ used_by: { people: [{ id: "p1", name: "Marlow" }], robots: [{ id: "d1", name: "StackChan" }] } });
  const view = open("/companions/lively-child");
  await waitFor(() => expect(view.getByRole("tab", { name: "Activity" })).toBeTruthy());
  fireEvent.mouseDown(view.getByRole("tab", { name: "About" }), { button: 0 });
  await waitFor(() => expect(view.getByText(/People: Marlow/)).toBeTruthy());
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
  await waitFor(() => expect(view.getByRole("tab", { name: "Activity" })).toBeTruthy());
  fireEvent.mouseDown(view.getByRole("tab", { name: "About" }), { button: 0 });
  const picker = await view.findByLabelText("Voice for this companion");
  expect(saved).toEqual([]);
  fireEvent.click(picker);
  fireEvent.click(await view.findByRole("option", { name: "Alba" }));
  await waitFor(() => expect(saved).toEqual([["household", "companion.voice.lively_child", "alba"]]));
});

test("a person who is not an admin gets no voice picker", async () => {
  api.companion = async () => detail();
  const view = open("/companions/lively-child");
  await waitFor(() => expect(view.getByRole("tab", { name: "Activity" })).toBeTruthy());
  fireEvent.mouseDown(view.getByRole("tab", { name: "About" }), { button: 0 });
  expect(view.getByRole("heading", { name: "Sprout" })).toBeTruthy();
  expect(view.queryByLabelText("Voice for this companion")).toBeNull();
});


test("preview cards show real counts and detail activity, and the detail page is a hero with rows", async () => {
  api.settingsValues = async () => [{ key: "companions.preview_shells", value: true, source: "user", label: "Preview", level: "basic", secret: false }] as never;
  api.companions = async () => ({ allowed: true, can_create: true, can_discover: true, default_id: "lively-teen", robots: null,
    companions: [card({ id: "lively-child", name: "Sprout", chats: 2 }), card({ id: "lively-teen", name: "Riff", is_default: true, chats: 0 })], discover: [card({ id: "lively-adult", name: "Pal", type: "adult", tagline: "Research helper" })] });
  const yours = open("/companions", true);
  await waitFor(() => expect(yours.getAllByText("Choose a conversation to get started").length).toBe(2));
  expect(yours.queryByRole("button", { name: "Add" })).toBeNull();
  expect(yours.getAllByRole("button", { name: "New companion" }).length).toBe(1);
  expect(yours.getByRole("link", { name: "New companion" }).getAttribute("href")).toBe("/companions/start");
  const discover = yours.getByRole("tab", { name: "Discover" });
  fireEvent.mouseDown(discover, { button: 0 });
  fireEvent.click(discover);
  await waitFor(() => expect(yours.getByRole("heading", { name: "Pal" })).toBeTruthy());
  expect(yours.getByRole("button", { name: "Add" })).toBeTruthy();
  expect(yours.queryByText("Riff")).toBeNull();
  expect((yours.getByRole("button", { name: "Add" }) as HTMLButtonElement).disabled).toBe(false);
  cleanup();
  api.companion = async () => detail({ can_edit: true });
  api.companionActivity = async () => ({ activity: [{ id: "job-1", kind: "image", title: "Made a picture", state: "done", created_at: "2026-10-25T12:00:00Z", updated_at: "2026-10-25T12:00:00Z" }] });
  const detailView = open("/companions/lively-child", true);
  await waitFor(() => expect(detailView.getByRole("tab", { name: "Activity" })).toBeTruthy());
  expect(detailView.getByRole("tab", { name: "Activity" }).getAttribute("data-state")).toBe("active");
  expect(detailView.queryByText(/Coming soon: (tasks|your chats)/)).toBeNull();
  expect(detailView.getByRole("link", { name: "All companions" }).getAttribute("href")).toBe("/companions");
  
  expect((detailView.getByRole("button", { name: "Chat with Sprout" }) as HTMLButtonElement).disabled).toBe(false);
  expect(await detailView.findByText("Made a picture")).toBeTruthy();
  const created: unknown[][] = [];
  api.createConversation = async (_mode, _carryFrom, _folderId, companionId) => { created.push([_mode, _carryFrom, _folderId, companionId]); return { id: "conversation-new" } as never; };
  fireEvent.click(detailView.getByRole("button", { name: "Chat with Sprout" }));
  await waitFor(() => expect(created.length).toBe(1));
  expect(created[0]?.[3]).toBe("lively-child");
  expect(await detailView.findByText("Chat route")).toBeTruthy();
  expect(detailView.getByTestId("location").textContent).toBe("/chat?conversation=conversation-new");
});

test("preview discovery is hidden when the list says it is unavailable", async () => {
  api.settingsValues = async () => [{ key: "companions.preview_shells", value: true, source: "user", label: "Preview", level: "basic", secret: false }] as never;
  api.companions = async () => ({ allowed: true, can_create: false, can_discover: false, default_id: "lively-child", companions: [card()], discover: [], robots: null });
  const view = open("/companions", true);
  await waitFor(() => expect(view.getByRole("tab", { name: "Yours" })).toBeTruthy());
  expect(view.queryByRole("tab", { name: "Discover" })).toBeNull();
});

test("profile defaults to Activity and lists only its own activity", async () => {
  api.settingsValues = async () => [{ key: "companions.preview_shells", value: true, source: "user", label: "Preview", level: "basic", secret: false }] as never;
  api.companion = async () => detail();
  api.conversationList = async () => [
    { id: "chat-1", companion_id: "lively-child", title: "Animal facts", created_at: "2026-10-20T00:00:00Z", last_turn_at: "2026-10-24T00:00:00Z" },
    { id: "chat-other", companion_id: "other", title: "Other companion", created_at: "2026-10-23T00:00:00Z", last_turn_at: "2026-10-23T00:00:00Z" },
  ] as never;
  const view = open("/companions/lively-child", true);
  await waitFor(() => expect(view.getByRole("tab", { name: "Activity" })).toBeTruthy());
});

test("profile chat starts a chat with this companion", async () => {
  api.settingsValues = async () => [{ key: "companions.preview_shells", value: true, source: "user", label: "Preview", level: "basic", secret: false }] as never;
  api.companion = async () => detail();
  api.conversationList = async () => [];
  const created: unknown[][] = [];
  api.createConversation = async (...args) => { created.push(args); return { id: "new-chat" } as never; };
  const view = open("/companions/lively-child", true);
  fireEvent.click(await view.findByRole("button", { name: "Chat with Sprout" }));
  await waitFor(() => expect(created.length).toBe(1));
  expect(created[0]?.[3]).toBe("lively-child");
  await waitFor(() => expect(view.getByTestId("location").textContent).toBe("/chat?conversation=new-chat"));
});

test("activity groups dated rows, prioritizes needs-you, and keeps chats out of tasks", async () => {
  api.companion = async () => detail({ task_count: 2 });
  const now = new Date();
  const today = now.toISOString();
  api.companionActivity = async () => ({ activity: [
    { id: "routine", kind: "project", title: "Routine task", state: "done", created_at: today, updated_at: today },
    { id: "waiting", kind: "job", title: "Waiting task", state: "waiting", needs_you: true, waiting_reason: "Choose a color", conversation_id: "conv-2", created_at: today, updated_at: today },
    { id: "chat-row", kind: "chat", title: "Garden chat", state: "done", conversation_id: "conv-1", created_at: today, updated_at: today },
  ] });
  const view = open("/companions/lively-child");
  await view.findByRole("button", { name: "Open chat" });
  const feed = view.getByRole("region", { name: "Activity" });
  expect(feed.textContent?.indexOf("Waiting task")).toBeLessThan(feed.textContent!.indexOf("Routine task"));
  expect(view.getByRole("separator", { name: "Today" })).toBeTruthy();
  expect(view.getByRole("button", { name: "Open chat" })).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Review task" }));
  expect(view.getByTestId("location").textContent).toContain("?tab=tasks&task=waiting");
  expect(await view.findByRole("heading", { name: "Waiting task" })).toBeTruthy();
  expect(view.getAllByText("Choose a color").length).toBeGreaterThan(0);
  expect(view.queryByText("Garden chat", { selector: "button" })).toBeNull();
  expect(view.getByRole("link", { name: "Open source conversation" }).getAttribute("href")).toBe("/chat?conversation=conv-2");
});

test("task tabs show counts, real progress and media result route", async () => {
  api.companion = async () => detail({ task_count: 3 });
  api.companionActivity = async () => ({ activity: [
    { id: "ask", kind: "job", title: "Pick a style", state: "waiting", needs_you: true, progress: "The choices are ready", waiting_reason: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: "run", kind: "project", title: "Research", state: "running", progress: "Reading sources", created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: "pic", kind: "picture", title: "Finished picture", state: "done", result_ref: "media-pic", created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  ] });
  const view = open("/companions/lively-child?tab=tasks&task=ask");
  await view.findByRole("heading", { name: "Pick a style" });
  expect(view.getByText("Needs you", { selector: "[data-slot='badge']" })).toBeTruthy();
  expect(view.getByRole("heading", { name: "Pick a style" })).toBeTruthy();
  expect(view.getAllByText(/Understood the request/).length).toBeGreaterThan(0);
  expect(view.getAllByText(/Waiting for your choice/).length).toBeGreaterThan(0);
  const runningTab = view.getByRole("tab", { name: "Running 1" });
  fireEvent.mouseDown(runningTab, { button: 0 });
  expect(view.queryByText("Nothing is running.")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: /Research/ }));
  expect(view.getByText("Reading sources")).toBeTruthy();
  const completedTab = view.getByRole("tab", { name: "Completed 1" });
  fireEvent.mouseDown(completedTab, { button: 0 });
  fireEvent.click(view.getByRole("button", { name: /Finished picture/ }));
  expect(view.getByRole("link", { name: "Open result" }).getAttribute("href")).toBe("/media/media-pic");
  expect(view.queryByText(/step|option/i)).toBeNull();
});

test("task tabs show their empty copy and activity shows its own empty copy", async () => {
  api.companion = async () => detail();
  api.companionActivity = async () => ({ activity: [] });
  const view = open("/companions/lively-child");
  await view.findByText("No activity for Sprout yet.");
  fireEvent.mouseDown(view.getByRole("tab", { name: "Tasks" }), { button: 0 });
  await view.findByText("Nothing needs you right now.");
  fireEvent.mouseDown(view.getByRole("tab", { name: "Running" }), { button: 0 });
  await view.findByText("Nothing is running.");
  fireEvent.mouseDown(view.getByRole("tab", { name: "Completed" }), { button: 0 });
  await view.findByText("Nothing has finished yet.");
});
