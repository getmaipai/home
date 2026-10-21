import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, ApiError, type CompanionCard, type CompanionDetail, type CompanionList } from "@/lib/api";
import { CompanionDetailPage, CompanionsPage } from "@/shell/pages/CompanionsPage";

const originals = { companions: api.companions, companion: api.companion, setDefaultCompanion: api.setDefaultCompanion, stackVoices: api.stackVoices, setSetting: api.setSetting };
afterEach(() => { cleanup(); Object.assign(api, originals); });

function card(overrides: Partial<CompanionCard> = {}): CompanionCard {
  return {
    id: "lively-child", name: "Sprout", type: "child", type_label: "Child companion", tagline: "A cheerful friend.", who_can_use: "Anyone in the family, including kids.",
    dials: [{ label: "How it talks", value: "Talks like a friend." }, { label: "Word choice", value: "Short, simple words." }, { label: "Questions back", value: "Asks you things back and wants to know more." }, { label: "Casual chatter", value: "A few casual words." }],
    voice: "The voice you chose in Settings", is_default: false, is_household: false, status: "ready", can_edit: false, can_copy: false, ...overrides,
  };
}
function detail(overrides: Partial<CompanionDetail> = {}): CompanionDetail {
  return { ...card(), about: "Sprout loves questions.", pronouns: "they/them", interests: ["animals"], examples: ["Wow, a slushie? What flavor?"], voice_value: "default", voice_is_own: false, voice_setting: null, used_by: null, ...overrides };
}
function open(path: string) {
  api.stackVoices = async () => ({ voices: [] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Routes><Route path="/companions" element={<CompanionsPage />} /><Route path="/companions/:id" element={<CompanionDetailPage />} /></Routes></MemoryRouter></QueryClientProvider>);
}

test("the gallery shows cards and create and household status badges", async () => {
  api.companions = async (): Promise<CompanionList> => ({ allowed: true, can_create: true, companions: [card({ is_household: true, status: "draft" }), card({ id: "lively-teen", name: "Riff", type: "teen", type_label: "Teen companion", is_default: true })], robots: null });
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
  api.companions = async (): Promise<CompanionList> => ({ allowed: true, can_create: false, companions: [card()], robots: [{ id: "d1", name: "StackChan", controls: "child", companion_id: "lively-child", companion_name: "Sprout" }] });
  const view = open("/companions");
  await waitFor(() => expect(view.getByText(/StackChan: Sprout/)).toBeTruthy());
  expect(view.getByRole("link", { name: "Companion settings" }).getAttribute("href")).toBe("/settings/home/robot");
});

test("when companions are off for the person the page says so", async () => {
  api.companions = async (): Promise<CompanionList> => ({ allowed: false, can_create: false, companions: [], robots: null });
  const view = open("/companions");
  await waitFor(() => expect(view.getByText(/turned off for you/)).toBeTruthy());
});

test("the detail shows edit and copy actions where allowed", async () => {
  api.companion = async () => detail({ can_edit: true, can_copy: true });
  api.copyCompanion = async () => ({ id: "copy-id" });
  const saved: string[] = [];
  api.setDefaultCompanion = async (id) => { saved.push(id); return { default_id: id }; };
  const view = open("/companions/lively-child");
  await waitFor(() => expect(view.getByText("Sprout loves questions.")).toBeTruthy());
  expect(view.getByText("Talks like a friend.")).toBeTruthy();
  expect(view.getByText(/Wow, a slushie/)).toBeTruthy();
  expect(view.getByRole("button", { name: "Play a sample" })).toBeTruthy();
  expect(view.getByRole("link", { name: "Edit" }).getAttribute("href")).toBe("/companions/lively-child/edit");
  expect(view.getByRole("button", { name: "Make a copy" })).toBeTruthy();
  expect(view.queryByText("Who uses it")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Set as my default" }));
  await waitFor(() => expect(saved).toEqual(["lively-child"]));
  await waitFor(() => expect((view.getByRole("button", { name: "Your default" }) as HTMLButtonElement).disabled).toBe(true));
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
  await waitFor(() => expect(view.getByLabelText("Voice for this companion")).toBeTruthy());
  expect(saved).toEqual([]);
});

test("a person who is not an admin gets no voice picker", async () => {
  api.companion = async () => detail();
  const view = open("/companions/lively-child");
  await waitFor(() => expect(view.getByText("Sprout loves questions.")).toBeTruthy());
  expect(view.queryByLabelText("Voice for this companion")).toBeNull();
});
