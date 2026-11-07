// I18N-F4b: the person-facing pages (home, companions, library, music, media, reference, projects, voices, showcase) render in
// Spanish. Each page opens with `es` active against a hub that answers every call with an error, so the error, empty and heading
// lines show; one of that page's own ids must appear in its Spanish text (an id with no es entry stays English and is not counted).
// A second test makes sure every id the F4b files carry formats in en-US, en-GB and es without braces left over.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, waitFor } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { i18n } from "@lingui/core";
import { ToastProvider } from "@maipai/ui/src/primitives/Toast";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { stubMatchMedia } from "../../../tests/stubMatchMedia";
import { activateLocale } from "@/i18n";
import type { Roster } from "@/lib/api";
import { NotFoundPage } from "@/shell/pages/NotFoundPage";
import { ProjectsPage } from "@/shell/pages/ProjectsPage";
import { FilesPage } from "@/shell/pages/FilesPage";
import { CompanionsPage, CompanionDetailPage } from "@/shell/pages/CompanionsPage";
import { ReferencePage } from "@/shell/pages/ReferencePage";
import { WikipediaPage } from "@/shell/pages/WikipediaPage";
import { MediaHomePage } from "@/shell/pages/MediaHomePage";
import { MediaSearchPage } from "@/shell/pages/MediaSearchPage";
import { DashboardPage } from "@/shell/pages/DashboardPage";
import { VoicesPage } from "@/shell/pages/VoicesPage";
import { MakeSongPage } from "@/shell/pages/MakeSongPage";
import { CreatePage } from "@/shell/pages/MusicStudioPages";
import { MusicWorkspace } from "@/shell/pages/MusicWorkspacePage";
import { BringSong } from "@/shell/pages/BringSong";
import { CompanionFlowPage } from "@/shell/pages/companionFlow/CompanionFlowPage";
import { CompanionAudienceDialog } from "@/shell/pages/CompanionAudienceDialog";
import { UiShowcasePage } from "@/shell/pages/UiShowcasePage";

const originalFetch = globalThis.fetch;
beforeEach(async () => { stubMatchMedia(); await activateLocale("es"); });
afterEach(async () => {
  cleanup();
  globalThis.fetch = originalFetch;
  await activateLocale("en-US");
});

function person(role: Roster["role"]): Roster {
  return { id: "person-abc123", display_name: "Nova", nickname: null, role, avatar_seed: "person-abc123", source: "hub", local_only: false, created_at: "2026-09-04T00:00:00.000Z", updated_at: "2026-09-04T00:00:00.000Z", deleted_at: null, enabled: true, guest_expires_at: null, memorialized_at: null, hlc: "1788000000000:0:test", hasSecret: true } as Roster;
}

const here = import.meta.dir;
/** The plain ids (no placeholders) a source file declares, with the Spanish each one now has. */
function spanishIds(files: string[]): string[] {
  const out = new Set<string>();
  for (const file of files) {
    const source = readFileSync(join(here, file), "utf8");
    for (const match of source.matchAll(/i18n\._\(\{ id: "((?:[^"\\]|\\.)*)"/g)) {
      const id = JSON.parse(`"${match[1]}"`) as string;
      if (/[{}]/.test(id)) continue;
      const text = i18n._({ id, message: id });
      if (text !== id) out.add(text);
    }
  }
  return [...out];
}

const at = (path: string, element: ReactElement, route = path): ReactElement => <ToastProvider><MemoryRouter initialEntries={[path]}><Routes><Route path={route} element={element} /></Routes></MemoryRouter></ToastProvider>;

const cases: Array<[string, () => ReactElement, string[]]> = [
  ["Not found", () => <MemoryRouter><NotFoundPage /></MemoryRouter>, ["NotFoundPage.tsx"]],
  ["Projects", () => at("/projects", <ProjectsPage person={person("adult")} />), ["ProjectsPage.tsx"]],
  ["Library", () => at("/files", <FilesPage person={person("adult")} />), ["FilesPage.tsx"]],
  ["Companions", () => at("/companions", <CompanionsPage />), ["CompanionsPage.tsx"]],
  ["Companion profile", () => at("/companions/sprout", <CompanionDetailPage />, "/companions/:id"), ["CompanionsPage.tsx"]],
  ["Reference", () => at("/reference", <ReferencePage person={person("adult")} />, "/reference/*"), ["ReferencePage.tsx"]],
  ["Wikipedia", () => at("/wikipedia", <WikipediaPage person={person("adult")} />, "/wikipedia/*"), ["WikipediaPage.tsx"]],
  ["Media home", () => at("/media", <MediaHomePage />), ["MediaHomePage.tsx"]],
  ["Media search", () => at("/media/search?q=zzz", <MediaSearchPage />, "/media/search"), ["MediaSearchPage.tsx"]],
  ["Home", () => at("/", <DashboardPage person={person("owner")} />), ["DashboardPage.tsx", "dashboard/Greeting.tsx", "dashboard/AskBox.tsx", "dashboard/GettingStarted.tsx", "dashboard/HomeShelves.tsx", "dashboard/TodaySection.tsx"]],
  ["Voices", () => at("/voices", <VoicesPage person={person("adult")} />), ["VoicesPage.tsx"]],
  ["Make a song (child)", () => at("/music", <MakeSongPage adult={false} search="" />), ["MakeSongPage.tsx"]],
  ["Make a band (child)", () => at("/music/create", <CreatePage kind="band" adult={false} />), ["MusicStudioPages.tsx"]],
  ["Music workspace", () => at("/music", <MusicWorkspace adult search="" />), ["MusicWorkspacePage.tsx"]],
  ["Bring a song", () => at("/music", <BringSong adult />), ["BringSong.tsx"]],
  ["Companion flow", () => at("/companions/new", <CompanionFlowPage />), ["companionFlow/CompanionFlowPage.tsx"]],
  ["Companion audience", () => at("/", <CompanionAudienceDialog companionId="sprout" name="Sprout" onClose={() => undefined} />), ["CompanionAudienceDialog.tsx"]],
  ["Showcase", () => at("/showcase", <UiShowcasePage person={person("owner")} />), ["UiShowcasePage.tsx"]],
];

describe("person pages in Spanish", () => {
  for (const [name, page, files] of cases) {
    test(`${name} shows Spanish text`, async () => {
      globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({ error: "x" }), { status: 500, headers: { "Content-Type": "application/json" } }))) as unknown as typeof fetch;
      const view = renderWithQueryClient(page());
      const candidates = spanishIds(files);
      expect(candidates.length).toBeGreaterThan(0);
      await waitFor(() => {
        const body = document.body.textContent ?? "";
        const aria = [...document.querySelectorAll("[aria-label],[placeholder],[title]")].map((el) => `${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("placeholder") ?? ""} ${el.getAttribute("title") ?? ""}`).join(" ");
        expect(candidates.some((text) => `${body} ${aria}`.includes(text))).toBe(true);
      });
      view.unmount();
    });
  }
});

describe("every F4b id formats in each locale", () => {
  const files = ["BringSong", "ChatShortcutReference", "CompanionAudienceDialog", "CompanionsPage", "DashboardPage", "FilesPage", "MakeSongPage", "MediaHomePage", "MediaSearchPage", "MusicRemix", "MusicStudioPages", "MusicStudioView", "MusicVoiceCreate", "MusicWorkspacePage", "NotFoundPage", "PackageAppPage", "ProjectsPage", "ReferencePage", "UiShowcasePage", "VoicesPage", "WikipediaPage", "useCompanionStates", "companionFlow/AnimateStep", "companionFlow/CompanionFlowDialog", "companionFlow/CompanionFlowPage", "companionFlow/CreateCharacterStep", "companionFlow/CustomizeStep", "companionFlow/DraggablePicture", "companionFlow/KeyframeEditor", "companionFlow/errors", "companionFlow/useSheetWait", "dashboard/AskBox", "dashboard/GettingStarted", "dashboard/Greeting", "dashboard/HomeShelves", "dashboard/TodaySection"];
  const ids = new Set<string>();
  for (const file of files) {
    const path = existsSync(join(here, `${file}.tsx`)) ? `${file}.tsx` : `${file}.ts`;
    for (const match of readFileSync(join(here, path), "utf8").matchAll(/i18n\._\(\{ id: "((?:[^"\\]|\\.)*)"/g)) ids.add(JSON.parse(`"${match[1]}"`) as string);
  }
  const values = { count: 2, name: "Ember", title: "Song", kind: "band", step: 2, line: "Line", progress: "40", label: "Voice", place: "Paris", reason: "x", when: "5 min ago", working: 1, waiting: 2, list: "a, b", amount: "2", sourceKind: "audio", stage: "x", position: 3, minutes: 3, date: "2026-01-01", shared: "a ", access: "b ", engine: "e", line2: "l", q: "q", made: "Ada", NOUN: "band", value: 1, id: "x", pronouns: "they", tokens: 1 } as Record<string, unknown>;
  test("the F4b files carry ids", () => { expect(ids.size).toBeGreaterThan(300); });
  for (const locale of ["en-US", "en-GB", "es"]) {
    test(`${locale} formats every id without braces or plural syntax left`, async () => {
      await activateLocale(locale);
      const bad: string[] = [];
      for (const id of ids) {
        let text: string;
        try { text = i18n._({ id, message: id, values }); } catch (error) { bad.push(`${id}: ${String(error)}`); continue; }
        if (!text.trim() || /[{}]|plural|select,|undefined/.test(text)) bad.push(`${id} -> ${text}`);
      }
      expect(bad).toEqual([]);
    });
  }
});
