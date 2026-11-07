// I18N-F5: the apps (setup wizard, clock, people, reminders, memory, notifications, home, library) render in Spanish. Each case opens
// with `es` active and must show a piece of text whose Spanish differs from its English id (an id with no es entry stays English
// and fails here). A second test formats every message id that comes from these apps in en-US, en-GB and es.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { readFileSync } from "node:fs";
import { MemoryRouter } from "react-router-dom";
import { i18n } from "@lingui/core";
import { renderWithQueryClient } from "../../tests/renderWithQueryClient";
import { activateLocale } from "@/i18n";
import { parsePo } from "../../scripts/po";
import { AlarmDays } from "@/apps/clock/AlarmDays";
import { ClockPage } from "@/apps/clock/ClockPage";
import { greetingFor } from "@/apps/home/greeting";
import { kindStyle } from "@/apps/library/appPresentation";
import { NotificationsPage } from "@/apps/notifications/NotificationsPage";
import { NewPersonForm } from "@/apps/people/NewPersonForm";
import { ACCENT_LABELS, ROLE_LABELS } from "@/apps/people/roles";
import { RemindersPage } from "@/apps/reminders/RemindersPage";
import { SetupWizard, checksSummary, checksTitle } from "@/apps/setup/SetupWizard";
import { LICENCE_ACK_SENTENCE } from "../../../shared/licenceTerms";

const originalFetch = globalThis.fetch;
beforeEach(async () => { await activateLocale("es"); });
afterEach(async () => {
  cleanup();
  globalThis.fetch = originalFetch;
  await activateLocale("en-US");
});

const spanish = (id: string): string => {
  const text = i18n._({ id, message: id });
  expect(text).not.toBe(id);
  return text;
};

function route(url: string): unknown {
  if (url.includes("/api/setup/state")) {
    const at = new Date().toISOString();
    const ids = ["welcome", "engine_location", "storage", "checks", "plan", "away", "owner", "coding_mode", "face", "profile", "hello", "backup_key", "done"];
    return { id: "setup-test", source: "wizard", steps: ids.map((id) => ({ id, status: "pending", at })), phase: "computers", engine: { where: "this_computer", hardware: {} }, away: "later", plan: { option: "recommended", tier: "minimal", roles: [] }, checks: [], started_at: at, completed_at: null, hlc: "1790000000000:0:abcdef" };
  }
  if (url.includes("/api/notifications")) return [];
  if (url.endsWith("/api/lists")) return [];
  if (url.endsWith("/api/alarms") || url.endsWith("/api/quick-timers") || url.endsWith("/api/world-places") || url.endsWith("/api/coming-up")) return [];
  return [];
}
function stubFetch() {
  globalThis.fetch = ((input: RequestInfo | URL) => Promise.resolve(Response.json(route(String(input))))) as unknown as typeof fetch;
}

describe("apps in Spanish", () => {
  const cases: Array<[string, () => ReactElement, string]> = [
    ["Setup wizard", () => <MemoryRouter><SetupWizard onDone={() => {}} /></MemoryRouter>, "Set up my Home"],
    ["Clock", () => <MemoryRouter><ClockPage /></MemoryRouter>, "Add an alarm with the plus button."],
    ["New person form", () => <NewPersonForm actorRole="owner" onSubmit={() => {}} submitLabel="Add" busy={false} error={null} />, "Role"],
    ["Reminders", () => <MemoryRouter><RemindersPage /></MemoryRouter>, "Today"],
    ["Notifications", () => <NotificationsPage />, "Notifications"],
  ];
  for (const [name, page, anchor] of cases) {
    test(`${name} shows Spanish text`, async () => {
      stubFetch();
      const view = renderWithQueryClient(page());
      const expected = spanish(anchor);
      await waitFor(() => expect(document.body.textContent).toContain(expected));
      view.unmount();
    });
  }

  test("alarm day buttons follow the language", () => {
    const view = render(<AlarmDays days={[1]} onToggle={() => {}} />);
    expect(view.getByRole("button", { name: "lunes" })).toBeTruthy();
    expect(view.queryByRole("button", { name: "Monday" })).toBeNull();
  });

  test("helper modules return Spanish", () => {
    expect(greetingFor(new Date(2026, 10, 7, 9), "Nova")).toBe("Buenos días, Nova");
    expect(ROLE_LABELS.owner).not.toBe("Owner");
    expect(ACCENT_LABELS.blue).not.toBe("Blue");
    expect(kindStyle("plugin").label).not.toBe("Plugin");
    expect(checksTitle("another_computer")).not.toBe("Checking your computers");
    expect(checksSummary([])).not.toBe("Everything looks ready.");
  });
});

describe("the licence line in the wizard stays in step with the shared text", () => {
  test("its message is the shared English sentence", () => {
    const source = readFileSync("src/apps/setup/SetupWizard.tsx", "utf8");
    expect(source).toContain(`id: ${JSON.stringify(LICENCE_ACK_SENTENCE)}`);
  });
});

describe("every app message formats in every locale", () => {
  const catalog = parsePo(readFileSync("src/locales/en-US/messages.po", "utf8"));
  const appIds = catalog
    .filter((entry) => entry.refs.some((ref) => /^src\/apps\/(setup|clock|people|reminders|memory|notifications|home|library|privacy)\//.test(ref)))
    .map((entry) => entry.id);

  test("the app slice has messages", () => { expect(appIds.length).toBeGreaterThan(300); });

  for (const locale of ["en-US", "en-GB", "es"]) {
    test(`${locale} formats ${"each"} id without braces or plural syntax left over`, async () => {
      await activateLocale(locale);
      const bad: string[] = [];
      for (const id of appIds) {
        const pluralArgs = new Set([...id.matchAll(/\{(\w+),\s*(?:plural|select)/g)].map((match) => match[1]!));
        const names = new Set([...id.matchAll(/\{(\w+)[,}]/g)].map((match) => match[1]!));
        for (const count of [1, 2]) {
          const values = Object.fromEntries([...names].map((name) => [name, pluralArgs.has(name) ? count : "x"]));
          const text = i18n._({ id, message: id, values });
          if (/[{}]|plural|undefined/.test(text) || text.trim() === "") bad.push(`${locale}: ${id} -> ${text}`);
        }
      }
      expect(bad).toEqual([]);
    });
  }
});
