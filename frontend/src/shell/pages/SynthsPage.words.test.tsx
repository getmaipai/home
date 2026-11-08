import { afterEach, expect, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, type CompanionCard, type CompanionList } from "@/lib/api";
import { CompanionsPage } from "@/shell/pages/CompanionsPage";

afterEach(() => cleanup());
const originals = api.companions;

afterEach(() => { api.companions = originals; });

function card(overrides: Partial<CompanionCard> = {}): CompanionCard {
  return {
    id: "default-synth", name: "Sprout", type: "child", type_label: "Child companion", tagline: "A cheerful friend.", who_can_use: "Anyone in the family, including kids.",
    dials: [], voice: "Alba", is_default: true, is_household: false, status: "ready", chats: 0, can_edit: false, can_copy: false, ...overrides,
  } as CompanionCard;
}
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/companions"]}><Routes><Route path="/companions" element={<CompanionsPage />} /></Routes></MemoryRouter></QueryClientProvider>);
}
function assertNoUnexpectedCompanionWords() {
  const allow = new Set(["Your companion", "Make this my companion"]);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node.textContent?.trim() ?? "";
    if (/companion/i.test(value)) expect(allow.has(value)).toBe(true);
  }
  for (const element of document.body.querySelectorAll<HTMLElement>("*")) {
    for (const attr of ["aria-label", "placeholder", "title"]) {
      const value = element.getAttribute(attr);
      if (value && /companion/i.test(value)) expect(allow.has(value)).toBe(true);
    }
  }
}

test("Synths directory and empty state use synth wording", async () => {
  api.companions = async (): Promise<CompanionList> => ({ allowed: true, can_create: true, can_discover: true, companions: [card()], discover: [], robots: null, default_id: "default-synth" });
  const view = renderPage();
  await waitFor(() => expect(view.getByRole("heading", { name: "Sprout" })).toBeTruthy());
  expect(view.getByRole("tab", { name: "Yours" })).toBeTruthy();
  expect(view.getByText("No chats yet")).toBeTruthy();
  assertNoUnexpectedCompanionWords();
  await waitFor(() => expect(document.title).toBe("Synths - MaiPai Home"));
  view.unmount();

  api.companions = async (): Promise<CompanionList> => ({ allowed: true, can_create: false, can_discover: false, companions: [], discover: [], robots: null, default_id: "" });
  const empty = renderPage();
  await waitFor(() => expect(empty.getByText("No synths are installed yet.")).toBeTruthy());
  assertNoUnexpectedCompanionWords();
});

test("companion flow strings use synth wording except assignment phrases", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const files = ["companionFlow/CompanionFlowDialog.tsx", "companionFlow/CompanionFlowPage.tsx", "companionFlow/CustomizeStep.tsx"];
  const allow = new Set(["Your companion", "Make this my companion"]);
  const messagePattern = /message: "([^"]*)"/g;
  for (const file of files) {
    const source = readFileSync(resolve(here, file), "utf8");
    for (const match of source.matchAll(messagePattern)) {
      if (/companion/i.test(match[1]!)) expect(allow.has(match[1]!)).toBe(true);
    }
  }
});
