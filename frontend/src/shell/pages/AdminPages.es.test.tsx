// I18N-F4a: the admin and system pages render in Spanish. Each page opens with `es` active and must show a heading or button
// whose Spanish text differs from its English id (an id with no es entry stays English and fails here). Every id used here
// also has to format in en-US, en-GB and es.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { i18n } from "@lingui/core";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { activateLocale } from "@/i18n";
import type { Performance, Roster } from "@/lib/api";
import { PerformancePage } from "@/shell/pages/PerformancePage";
import { PrivacyPage } from "@/shell/pages/PrivacyPage";
import { HousePage } from "@/shell/pages/HousePage";
import { TrashPage } from "@/shell/pages/TrashPage";
import { StatusPage } from "@/shell/pages/StatusPage";
import { MicTestPage } from "@/shell/pages/MicTestPage";
import { UsersPage } from "@/shell/pages/UsersPage";
import { UpdatesPage } from "@/shell/pages/UpdatesPage";
import { RepairsPage } from "@/shell/pages/RepairsPage";
import { EnginesConsole } from "@/shell/pages/EnginesPage";
import { FamilyPage } from "@/shell/pages/FamilyPage";
import { StoragePage } from "@/shell/pages/StoragePage";
import { severityLabel } from "@/shell/pages/severityLabel";
import { formatUptime } from "@/shell/pages/status/StatusComponents";
import { durationWords, statusStripSummary } from "@/shell/pages/status/statusHistoryFormat";
import { agoText } from "@/shell/pages/status/statusChecksFormat";

const originalFetch = globalThis.fetch;
beforeEach(async () => { await activateLocale("es"); });
afterEach(async () => {
  cleanup();
  globalThis.fetch = originalFetch;
  await activateLocale("en-US");
});

function person(role: Roster["role"]): Roster {
  return { id: "person-abc123", display_name: "Nova", nickname: null, role, avatar_seed: "person-abc123", source: "hub", local_only: false, created_at: "2026-09-04T00:00:00.000Z", updated_at: "2026-09-04T00:00:00.000Z", deleted_at: null, enabled: true, guest_expires_at: null, memorialized_at: null, hlc: "1788000000000:0:test", hasSecret: true } as Roster;
}

const performance = {
  turns: { window_days: 30, by_day: [], by_engine: [], by_route: [], tools_offered: { turns: 0, median_count: null, median_chars: null, p95_chars: null, max_chars: null } },
  queues: { judge: { pending: 0, oldest_created_at: null }, embedding: { pending: 0 }, ingestion: { pending: 0, by_reason: [] } },
  labels: { window_days: 30, turns: 1, guard_hits: [], rule_hits: [], rungs: [], retire_eligible: [] },
  layers: { window_days: 30, turns_with_trace: 0, nodes: [] },
  engines: { configured: false, roles: [], engines: [], budget: null, recent_issues: [] },
  hardware: { configured: false, hardware: null },
  disk: { total_bytes: 100, free_bytes: 50, areas: [] },
  retention_days: 90,
} as unknown as Performance;

const trashRow = { kind: "media_item", id: "media-nova001", title: "nova", deleted_at: "2026-10-17T00:00:00.000Z", trash_until: "2026-11-16T00:00:00.000Z", can_restore: true, can_purge: true };

function route(url: string): unknown {
  if (url.includes("/api/performance")) return performance;
  if (url.includes("/api/privacy")) return { connections: [], offlinePlugins: [] };
  if (url.includes("/api/house/rooms")) return { rooms: [], status: "not_configured" };
  if (url.includes("/api/trash")) return { rows: [trashRow] };
  if (url.includes("/api/status/apps")) return [{ id: "home", name: "Home", state: "operational", reason: null, needs: [], uptimePercent: 100, history: [] }];
  if (url.includes("/api/health-checks")) return { running: false, last_checked_at: null, groups: [], checks: [] };
  if (url.includes("/api/health")) return { brain: "selection", voice: "spawned", ok: true, uptimeSeconds: 60, engines: { chat: { kind: "selection", pid: null, alive: true }, embed: { kind: "spawned", pid: null, alive: true }, background: { kind: "spawned", pid: null, alive: true }, voice: { kind: "spawned", pid: null, alive: true } }, sidecars: [] };
  if (url.includes("/api/status/history")) return { generated_at: new Date().toISOString(), days: 90, components: [], incidents: [] };
  if (url.includes("/api/status/board")) return { note: null, maintenance: [] };
  if (url.includes("/api/status/engine-computer")) return { configured: false, state: "not_reachable", reason: null };
  if (url.includes("/api/storage/usage")) return { people: [{ personId: "person-abc123", displayName: "Nova", role: "owner", usageBytes: 1024, capBytes: 0, byKind: [] }], household: { usageBytes: 1024, capBytes: 0, inherited: { files: 0, bytes: 0 } } };
  if (url.includes("/api/settings")) return [];
  return [];
}

function stubFetch() {
  globalThis.fetch = ((input: RequestInfo | URL) => Promise.resolve(Response.json(route(String(input))))) as unknown as typeof fetch;
}

const spanish = (id: string): string => {
  const text = i18n._({ id, message: id });
  expect(text).not.toBe(id);
  return text;
};

describe("admin and system pages in Spanish", () => {
  const cases: Array<[string, () => ReactElement, string]> = [
    ["Performance", () => <MemoryRouter><PerformancePage /></MemoryRouter>, "Reply time per day"],
    ["Privacy", () => <PrivacyPage />, "What we never do"],
    ["House", () => <HousePage />, "Home Assistant is not set up yet. Connect it in Settings to control your lights, locks and scenes here."],
    ["Trash", () => <MemoryRouter><TrashPage person={person("owner")} /></MemoryRouter>, "Restore"],
    ["Status", () => <MemoryRouter><StatusPage person={person("owner")} /></MemoryRouter>, "Parts"],
    ["Microphone test", () => <MicTestPage />, "Run microphone test"],
    ["Users", () => <UsersPage person={person("adult")} />, "Only an owner or admin can manage users."],
    ["Updates", () => <UpdatesPage person={person("adult")} />, "Only an owner or admin can manage updates."],
    ["Repairs", () => <RepairsPage person={person("adult")} />, "Only an owner or admin can manage repairs."],
    ["Engines", () => <EnginesConsole person={person("adult")} />, "Only an owner or admin can manage engines."],
    ["Family", () => <MemoryRouter><FamilyPage person={person("owner")} /></MemoryRouter>, "Pets"],
    ["Storage", () => <MemoryRouter><StoragePage person={person("adult")} /></MemoryRouter>, "Household total"],
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
});

describe("status and table words format in every locale", () => {
  for (const locale of ["en-US", "en-GB", "es"]) {
    test(`${locale} formats durations, plurals and labels without braces`, async () => {
      await activateLocale(locale);
      const samples = [
        formatUptime(86_400 * 2 + 3_600), formatUptime(300), durationWords(95), durationWords(2000),
        statusStripSummary(99.5, [{ minutes: 5 } as never]), statusStripSummary(100, []), statusStripSummary(null, []),
        agoText(new Date(Date.now() - 5 * 60_000).toISOString()), agoText(new Date(Date.now() - 2 * 3_600_000).toISOString()),
        severityLabel("critical"), severityLabel("warning"), severityLabel("info"),
        i18n._({ id: "Label harvest ({turns, plural, one {# turn} other {# turns}})", message: "Label harvest ({turns, plural, one {# turn} other {# turns}})", values: { turns: 1 } }),
        i18n._({ id: "{roles, plural, one {# role} other {# roles}}, {engines, plural, one {# engine} other {# engines}} -", message: "{roles, plural, one {# role} other {# roles}}, {engines, plural, one {# engine} other {# engines}} -", values: { roles: 1, engines: 3 } }),
        i18n._({ id: "Cleared {count, plural, one {# saved copy} other {# saved copies}} ({size}) from all sources.", message: "Cleared {count, plural, one {# saved copy} other {# saved copies}} ({size}) from all sources.", values: { count: 2, size: "1 MB" } }),
        i18n._({ id: "{names} {count, plural, one {needs attention} other {need attention}}", message: "{names} {count, plural, one {needs attention} other {need attention}}", values: { names: "Brain", count: 2 } }),
        i18n._({ id: "No recent use: {count, plural, one {# service} other {# services}}", message: "No recent use: {count, plural, one {# service} other {# services}}", values: { count: 3 } }),
      ];
      for (const text of samples) {
        expect(text).not.toMatch(/[{}]|plural|undefined/);
        expect(text.length).toBeGreaterThan(0);
      }
      if (locale === "es") expect(severityLabel("critical")).not.toBe("Critical");
    });
  }
});
