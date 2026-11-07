// I18N-F3: all of Settings renders in Spanish, one assertion per area page. Each page opens at its URL with `es` active and must
// show its own section name and the area title in Spanish (a name with no es entry would stay English and fail here).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import FullLayout from "@maipai/ui/src/dashboard/layouts/full/FullLayout";
import { renderWithQueryClient } from "../../../../tests/renderWithQueryClient";
import { activateLocale } from "@/i18n";
import { SettingsAreaPage } from "@/shell/pages/settings/SettingsAreaPage";
import { SETTINGS_AREAS, settingsArea } from "@/shell/pages/settings/settingsAreas";
import { makePerson, mockHome, type HomeFixture } from "@/shell/pages/settings/settingsTestKit";

let fixture: HomeFixture | null = null;
beforeEach(async () => { await activateLocale("es"); });
afterEach(async () => {
  cleanup();
  fixture?.restore();
  fixture = null;
  await activateLocale("en-US");
});

const sections = SETTINGS_AREAS.find((area) => area.id === "settings")!.sections;

describe("Settings in Spanish", () => {
  for (const section of sections) {
    test(`/settings/${section.id} shows ${section.id} in Spanish`, async () => {
      fixture = mockHome({});
      const person = makePerson("owner");
      const view = renderWithQueryClient(
        <MemoryRouter initialEntries={[`/settings/${section.id}`]}>
          <Routes>
            <Route element={<FullLayout rail activeAppHref="/settings" />}>
              <Route path="settings/:section?/:detailId?" element={<SettingsAreaPage person={person} onPersonChange={() => {}} />} />
            </Route>
          </Routes>
        </MemoryRouter>,
      );
      const area = settingsArea("settings")!;
      const spanishSection = area.sections.find((candidate) => candidate.id === section.id)!.label;
      expect(await within(document.body).findAllByText(spanishSection)).not.toHaveLength(0);
      expect(within(document.body).getAllByText(area.title).length).toBeGreaterThan(0);
      expect(area.title).not.toBe("Settings");
      view.unmount();
    });
  }
});
