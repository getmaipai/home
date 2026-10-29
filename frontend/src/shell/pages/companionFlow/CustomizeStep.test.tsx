import { afterEach, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, ApiError, type CompanionLook } from "@/lib/api";
import { CompanionShellViewer } from "@/lib/companionShells";
import { CompanionFlowPage } from "@/shell/pages/companionFlow/CompanionFlowPage";
import { guessPersonality } from "@/shell/pages/companionFlow/CustomizeStep";

const methods = ["settingsValues", "companions", "editCompanion", "companionLook", "companionStates", "getCompanionLookStyles", "stackVoices", "generateCompanionBackstory", "saveCompanion"] as const;
const originals = Object.fromEntries(methods.map((key) => [key, api[key]]));
const realOpen = window.open;
afterEach(() => { cleanup(); Object.assign(api, originals); window.open = realOpen; });

const version = { id: "v-1", label: "Picture", source: "generated" as const, width: 1024, height: 1024, created_at: "2026-10-29T12:00:00Z", from: null, url: "/portrait.png" };
const look: CompanionLook = { versions: [version], rest: "v-1", key: "#00FF00", sheet: null, ready_for_video: true, start_ready: true, can_generate: true, styles: [], audience_cap: "all" };
const saved = (extra: Record<string, unknown> = {}) => ({ id: "hc-one", name: "Marlow", voice_id: "default", status: "draft", behavior: [], backstory: "", formality: "neutral", complexity: "standard", engagement: "balanced", filler_density: "light", humor: "medium", ...extra }) as never;
function Where() { const location = useLocation(); return <div data-testid="where">{location.pathname}{location.search}</div>; }

function open(editable = saved()) {
  const calls = { saved: [] as unknown[], backstory: [] as unknown[], opened: [] as string[] };
  api.settingsValues = async () => [{ key: "companions.preview_shells", value: true, source: "user", label: "Preview", level: "basic", secret: false }] as never;
  api.companions = async () => ({ allowed: true, can_create: true, can_discover: false, default_id: "x", companions: [], discover: [], robots: null });
  api.editCompanion = async () => editable;
  api.companionLook = async () => look;
  api.getCompanionLookStyles = async () => ({ styles: [], keep: { id: "keep" as const, label: "Keep as is" } });
  api.companionStates = async () => ({ sheet_ready: true, start_ready: true, key: "#00FF00", states: [], run: null, counts: { approved: 0, total: 0, required_missing: [] } });
  api.stackVoices = async () => ({ voices: [{ id: "alba", name: "Alba", source: "preset", engine: "pocket", gender: "female", language: "en", description: "" }] }) as never;
  api.generateCompanionBackstory = async (_id, body) => { calls.backstory.push(body); return { text: "Marlow grew up beside a quiet lighthouse." }; };
  api.saveCompanion = async (_id, body) => { calls.saved.push(body); return { id: "hc-one", status: "ready", published: true }; };
  window.open = ((url: string) => { calls.opened.push(url); return null; }) as never;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><CompanionShellViewer.Provider value={{ id: "person-sage" } as never}><MemoryRouter initialEntries={["/companions/hc-one/create?step=3"]}><Routes>
    <Route path="/companions/:id/create" element={<CompanionFlowPage />} /><Route path="/companions" element={<Where />} />
  </Routes></MemoryRouter></CompanionShellViewer.Provider></QueryClientProvider>);
  return { view, calls };
}
const chip = (view: ReturnType<typeof open>["view"], name: string) => view.getByRole("radio", { name }) as HTMLElement;
const button = (view: ReturnType<typeof open>["view"], name: string) => view.getByRole("button", { name }) as HTMLButtonElement;

test("screen 3 shows its title, all three bar segments, and the mockup's fields", async () => {
  const { view } = open();
  expect(await view.findByText("Step 3 of 3 · Give your companion a voice, personality, and history")).toBeTruthy();
  expect(view.getAllByText("Customize Companion").length).toBeGreaterThan(0);
  for (const label of ["Choose Voice", "Create / Clone", "Friendly", "Funny", "Calm", "Professional", "Playful", "Custom"]) expect(view.getByRole("radio", { name: label })).toBeTruthy();
  for (const label of ["Preview", "Generate", "Test Conversation", "Save Companion", "Back"]) expect(view.getByRole("button", { name: label })).toBeTruthy();
  expect(view.getByPlaceholderText("How should your companion behave, speak, and interact? (Optional)")).toBeTruthy();
  expect(view.getByText("Generate a suggested backstory or write your own. You can edit it anytime.")).toBeTruthy();
  expect(view.getByText("All settings can be changed later.")).toBeTruthy();
  expect((view.getByLabelText("Backstory") as HTMLTextAreaElement).maxLength).toBe(400);
  expect((view.getByLabelText("Personality notes") as HTMLTextAreaElement).maxLength).toBe(300);
  expect(view.getByAltText("Marlow, companion preview").getAttribute("src")).toBe("/portrait.png");
});

test("chips select one at a time", async () => {
  const { view } = open();
  await view.findByRole("radio", { name: "Friendly" });
  expect(chip(view, "Friendly").getAttribute("aria-checked")).toBe("true");
  fireEvent.click(chip(view, "Calm"));
  expect(chip(view, "Calm").getAttribute("aria-checked")).toBe("true");
  expect(chip(view, "Friendly").getAttribute("aria-checked")).toBe("false");
});

test("Generate puts the suggested backstory in the box, and Save posts the right body", async () => {
  const { view, calls } = open();
  await view.findByRole("radio", { name: "Friendly" });
  fireEvent.click(chip(view, "Funny"));
  fireEvent.change(view.getByLabelText("Personality notes"), { target: { value: "Short jokes." } });
  await act(async () => { fireEvent.click(button(view, "Generate")); });
  await waitFor(() => expect((view.getByLabelText("Backstory") as HTMLTextAreaElement).value).toBe("Marlow grew up beside a quiet lighthouse."));
  expect(calls.backstory).toEqual([{ hint: "Short jokes." }]);
  await act(async () => { fireEvent.click(button(view, "Save Companion")); });
  await waitFor(() => expect(calls.saved.length).toBe(1));
  expect(calls.saved[0]).toEqual({ voice_id: "default", personality: "funny", style_notes: "Short jokes.", backstory: "Marlow grew up beside a quiet lighthouse." });
  await waitFor(() => expect(view.getByTestId("where").textContent).toBe("/companions"));
});

test("a save blocked with go_back_to look shows the sentence and a button to screen 1", async () => {
  const { view } = open();
  await view.findByRole("radio", { name: "Friendly" });
  api.saveCompanion = async () => { throw new ApiError("Go back to the look screen and check the starting picture.", 422, undefined, undefined, undefined, undefined, undefined, undefined, "look"); };
  await act(async () => { fireEvent.click(button(view, "Save Companion")); });
  expect((await view.findByRole("alert")).textContent).toBe("Go back to the look screen and check the starting picture.");
  fireEvent.click(button(view, "Go to Create Character"));
  await view.findByText("Step 1 of 3 · Design your companion's appearance");
});

test("a save blocked with go_back_to animations jumps to screen 2", async () => {
  const { view } = open();
  await view.findByRole("radio", { name: "Friendly" });
  api.saveCompanion = async () => { throw new ApiError("Go back to animations and check the approved clips.", 409, undefined, undefined, undefined, undefined, undefined, undefined, "animations"); };
  await act(async () => { fireEvent.click(button(view, "Save Companion")); });
  await view.findByText("Go back to animations and check the approved clips.");
  fireEvent.click(button(view, "Go to Animate Character"));
  await view.findByText("Step 2 of 3 · Generate and review your animations");
});

test("Test Conversation opens the temporary chat in a new tab", async () => {
  const { view, calls } = open();
  await view.findByRole("radio", { name: "Friendly" });
  fireEvent.click(button(view, "Test Conversation"));
  expect(calls.opened).toEqual(["/chat?try=hc-one"]);
});

test("editing loads the saved voice, personality, notes and backstory", async () => {
  const { view } = open(saved({ status: "ready", voice_id: "default", formality: "formal", complexity: "advanced", engagement: "brief", filler_density: "none", humor: "low", behavior: ["Speaks plainly.", "Stays calm."], backstory: "A retired ship captain." }));
  await waitFor(() => expect(chip(view, "Professional").getAttribute("aria-checked")).toBe("true"));
  expect((view.getByLabelText("Personality notes") as HTMLTextAreaElement).value).toBe("Speaks plainly. Stays calm.");
  expect((view.getByLabelText("Backstory") as HTMLTextAreaElement).value).toBe("A retired ship captain.");
});

test("dials that match no chip read as Custom", () => {
  expect(guessPersonality({ formality: "formal", complexity: "simple", engagement: "curious", filler_density: "none", humor: "high" })).toBe("custom");
  expect(guessPersonality({ formality: "casual", complexity: "simple", engagement: "curious", filler_density: "frequent", humor: "high" })).toBe("playful");
});

test("a fresh draft that has no voice, notes or backstory fields still opens", async () => {
  const { view } = open({ id: "hc-one", name: "Marlow", status: "draft", formality: "neutral", complexity: "standard", engagement: "balanced", filler_density: "light", humor: "medium" } as never);
  await waitFor(() => expect(chip(view, "Friendly").getAttribute("aria-checked")).toBe("true"));
  expect((view.getByLabelText("Backstory") as HTMLTextAreaElement).value).toBe("");
});
