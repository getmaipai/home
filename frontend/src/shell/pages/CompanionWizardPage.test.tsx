import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { CompanionShellViewer } from "@/lib/companionShells";
import { CompanionWizardPage } from "@/shell/pages/CompanionWizardPage";

const original = api.settingsValues;
afterEach(() => { cleanup(); api.settingsValues = original; });
function open(enabled: boolean) {
  api.settingsValues = async () => [{ key: "companions.preview_shells", value: enabled, source: "user", label: "Preview", level: "basic", secret: false }] as never;
  api.companions = async () => ({ allowed: true, can_create: true, can_discover: true, default_id: "default", companions: [], discover: [], robots: null });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><CompanionShellViewer.Provider value={{ id: "person-sage" } as never}><MemoryRouter initialEntries={["/companions/start"]}><Routes><Route path="/companions/start" element={<CompanionWizardPage />} /><Route path="/companions/new" element={<EditorLocation />} /></Routes></MemoryRouter></CompanionShellViewer.Provider></QueryClientProvider>);
}
function EditorLocation() { const location = useLocation(); return <div data-testid="editor-location">{JSON.stringify(location.state)}</div>; }

test("wizard selects a template and finishes with a trimmed name", async () => {
  const view = open(true);
  fireEvent.click(await view.findByRole("button", { name: "Continue" }));
  await waitFor(() => expect(view.getByTestId("companion-wizard")).toBeTruthy(), { timeout: 1000 });
  for (const template of ["Chat buddy", "Research", "Homework helper", "Storyteller", "Custom"]) {
    expect(view.getByRole("button", { name: template })).toBeTruthy();
  }
  expect(view.queryByRole("button", { name: "Shopping" })).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Continue" }));
  const finish = await view.findByRole("button", { name: "Finish" });
  expect((finish as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(view.getByLabelText("Name"), { target: { value: "  Nova  " } });
  expect((finish as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(finish);
  await waitFor(() => expect(view.getByTestId("editor-location").textContent).toBe(JSON.stringify({ name: "Nova", template: "chat-buddy" })));
});

test("Storyteller opens the editor with preset dials and an unsaved draft", async () => {
  api.settingsValues = async () => [{ key: "companions.preview_shells", value: true, source: "user", label: "Preview", level: "basic", secret: false }] as never;
  api.companions = async () => ({ allowed: true, can_create: true, can_discover: true, default_id: "default", companions: [], robots: null });
  api.createCompanion = async () => ({ id: "hc-new" });
  api.stackVoices = async () => ({ voices: [] });
  const view = open(true);
  try {
    fireEvent.click(await view.findByRole("button", { name: "Continue" }));
    fireEvent.click(await view.findByRole("button", { name: "Storyteller" }));
    fireEvent.click(view.getByRole("button", { name: "Continue" }));
    fireEvent.change(await view.findByLabelText("Name"), { target: { value: "Nova" } });
    fireEvent.click(view.getByRole("button", { name: "Finish" }));
    expect(await view.findByTestId("editor-location")).toBeTruthy();
    expect(view.getByTestId("editor-location").textContent).toBe(JSON.stringify({ name: "Nova", template: "storyteller" }));
  } catch (error) {
    throw new Error(`Storyteller flow failed: ${error instanceof Error ? error.message : String(error)}\n${view.container.textContent}`);
  }
});

test("intro explains companions and Continue opens the template step", async () => {
  const view = open(true);
  expect(await view.findByRole("heading", { name: "Create your companion" })).toBeTruthy();
  expect(view.getByText("Pick a starting point")).toBeTruthy();
  expect(view.getByText("Give it a name and a look")).toBeTruthy();
  expect(view.getByText("It stays in your home")).toBeTruthy();
  expect(view.getByRole("list").querySelectorAll("li")).toHaveLength(3);
  fireEvent.click(view.getByRole("button", { name: "Continue" }));
  expect(await view.findByTestId("companion-wizard")).toBeTruthy();
});

test("wizard route redirects when previews are off", async () => {
  const view = open(false);
  await waitFor(() => expect(view.getByTestId("editor-location")).toBeTruthy());
});

test("wizard waits for the setting before deciding", async () => {
  api.settingsValues = (() => new Promise(() => {})) as typeof api.settingsValues;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><CompanionShellViewer.Provider value={{ id: "person-sage" } as never}><MemoryRouter initialEntries={["/companions/start"]}><Routes><Route path="/companions/start" element={<CompanionWizardPage />} /><Route path="/companions/new" element={<EditorLocation />} /></Routes></MemoryRouter></CompanionShellViewer.Provider></QueryClientProvider>);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(view.queryByTestId("companion-wizard")).toBeNull();
  expect(view.queryByTestId("editor-location")).toBeNull();
});
