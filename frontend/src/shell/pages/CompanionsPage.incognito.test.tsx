import { afterEach, beforeEach, expect, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, type CompanionCard, type CompanionDetail, type CompanionList } from "@/lib/api";
import { CompanionDetailPage, CompanionsPage } from "@/shell/pages/CompanionsPage";
import { IncognitoProvider } from "@/shell/incognitoContext";
import { writeIncognitoCache } from "@/shell/incognitoCache";

const originals = { companions: api.companions, companion: api.companion, companionActivity: api.companionActivity, stackVoices: api.stackVoices, settingsValues: api.settingsValues };
beforeEach(() => { try { localStorage.setItem("maipai.incognito-explanation-seen", "true"); } catch { /* ignore */ } });
afterEach(() => { cleanup(); Object.assign(api, originals); writeIncognitoCache(false); });

function card(overrides: Partial<CompanionCard> = {}): CompanionCard {
  return {
    id: "lively-child", name: "Sprout", type: "child", type_label: "Child companion", tagline: "A cheerful friend.", who_can_use: "Anyone in the family.",
    dials: [], voice: "Alba", is_default: false, is_household: false, status: "ready", chats: 0, can_edit: false, can_copy: false, ...overrides,
  } as CompanionCard;
}

function open(path: string) {
  api.stackVoices = async () => ({ voices: [] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><IncognitoProvider><MemoryRouter initialEntries={[path]}><Routes><Route path="/companions" element={<CompanionsPage />} /><Route path="/companions/:id" element={<CompanionDetailPage />} /></Routes></MemoryRouter></IncognitoProvider></QueryClientProvider>);
}

const list = (): CompanionList => ({ allowed: true, can_create: false, can_discover: false, default_id: "riff", companions: [
  card({ id: "riff", name: "Riff", is_default: true, latest_activity_at: "2026-10-27T12:00:00Z", chat_count: 3 }),
  card({ id: "busy", name: "Busy", working_count: 2, waiting_count: 1 }),
], discover: [], robots: null } as CompanionList);

test("with Incognito off the directory marks the selected companion and shows its chat history", async () => {
  writeIncognitoCache(false);
  api.companions = async () => list();
  const view = open("/companions");
  await view.findByRole("heading", { name: "Riff" });
  expect(view.getAllByText("Your companion").length).toBeGreaterThan(0);
  expect(view.getByText(/Last active .* · 3 chats/)).toBeTruthy();
});

test("with Incognito on the directory shows no selected-companion mark and no chat or activity history", async () => {
  writeIncognitoCache(true);
  api.companions = async () => list();
  const view = open("/companions");
  await view.findByRole("heading", { name: "Riff" });
  expect(view.queryByText("Your companion")).toBeNull();
  expect(view.queryByText(/Last active/)).toBeNull();
  expect(view.queryByText(/working/)).toBeNull();
  expect(view.queryByText("No chats yet")).toBeNull();
});

test("with Incognito on a companion's page asks the hub for no activity or task history", async () => {
  writeIncognitoCache(true);
  let asked = 0;
  api.companion = async () => ({ ...card(), about: "Sprout loves questions.", pronouns: "they/them", interests: [], examples: [], voice_value: "default", voice_is_own: false, voice_setting: null, used_by: null } as CompanionDetail);
  api.companionActivity = (async () => { asked += 1; return { activity: [] }; }) as typeof api.companionActivity;
  const view = open("/companions/lively-child");
  await waitFor(() => expect(view.getByRole("tab", { name: "Activity" })).toBeTruthy());
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(asked).toBe(0);
});
