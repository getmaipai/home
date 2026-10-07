import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup } from "@testing-library/react";
import { StatusPage } from "@/shell/pages/StatusPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { Roster, StatusAppsResponse, StatusHistory } from "@/lib/api";

afterEach(cleanup);

function makePerson(role: Roster["role"]): Roster {
  return { id: "person-abc123", display_name: "Nova", nickname: null, role, avatar_seed: "person-abc123", source: "hub", local_only: false, created_at: "2026-09-04T00:00:00.000Z", updated_at: "2026-09-04T00:00:00.000Z", deleted_at: null, enabled: true, guest_expires_at: null, memorialized_at: null, hlc: "1788000000000:0:test", hasSecret: true } as Roster;
}

const apps: StatusAppsResponse = [
  { id: "chat", name: "Chat", state: "down", reason: "Chat isn't working right now.", needs: [{ kind: "engine", id: "chat", name: "Brain", purpose: "Chat model", state: "down", required: true }], history: Array.from({ length: 90 }, (_, index) => ({ date: `2026-07-${String((index % 30) + 1).padStart(2, "0")}`, state: index === 89 ? "down" : "operational", uptime: index === 89 ? 50 : 100, minutes: { operational: index === 89 ? 1439 : 1440, degraded: 0, outage: index === 89 ? 1 : 0, maintenance: 0 } })), uptimePercent: 99.5 },
  ...["Home", "Videos", "Music", "Podcasts"].map((name) => ({ id: name.toLowerCase(), name, state: "operational" as const, reason: null, needs: [{ kind: "engine" as const, id: "chat", name: "Brain", purpose: "Chat model", state: "operational" as const, required: true }], history: Array.from({ length: 90 }, (_, index) => ({ date: `2026-07-${String((index % 30) + 1).padStart(2, "0")}`, state: "operational" as const, uptime: 100, minutes: { operational: 1440, degraded: 0, outage: 0, maintenance: 0 } })), uptimePercent: 100 })),
];

function mockStatus(includeNeeds: boolean, history: StatusHistory = { generated_at: new Date().toISOString(), days: 90, components: [], incidents: [] }) {
  const original = globalThis.fetch;
  const paths: string[] = [];
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    paths.push(url.split("?")[0] ?? "");
    if (url.includes("/api/status/apps")) return Promise.resolve(Response.json(includeNeeds ? apps : apps.map(({ needs: _needs, ...app }) => app)));
    if (url.includes("/api/health")) return Promise.resolve(Response.json({
      brain: "selection", voice: "spawned", ok: true, uptimeSeconds: 60,
      engines: { chat: { kind: "selection", pid: null, alive: true }, embed: { kind: "spawned", pid: null, alive: true }, background: { kind: "spawned", pid: null, alive: true }, voice: { kind: "spawned", pid: null, alive: true } }, sidecars: [],
    }));
    if (url.includes("/api/status/history")) return Promise.resolve(Response.json(history));
    if (url.includes("/api/status/board")) return Promise.resolve(Response.json({ note: null, maintenance: [] }));
    if (url.includes("/api/status/protection")) return Promise.resolve(Response.json({ diskEncryption: "on", swapEncryption: "unknown", https: true, dataDirectoryOwnerOnly: "on", keyFileInsideData: true, profilesWithoutPasscode: 2, minimumPasscodeLength: 4 }));
    return Promise.resolve(Response.json({}));
  }) as unknown as typeof fetch;
  return { paths, restore: () => { globalThis.fetch = original; } };
}

describe("StatusPage app-first view", () => {
  test("members get app rows, reason, and bars without dependency names, controls, or raw-part requests", async () => {
    const { paths, restore } = mockStatus(false);
    try {
      const view = renderWithQueryClient(<StatusPage person={makePerson("adult")} />);
      expect(await view.findByText("Apps")).toBeTruthy();
      expect(view.getAllByText("Chat isn't working right now.").length).toBeGreaterThan(0);
      for (const name of ["Chat", "Home", "Videos", "Music", "Podcasts"]) expect(view.getAllByText(name).length).toBeGreaterThan(0);
      expect(view.getAllByText("Chat isn't working right now.").some((line) => line.closest("[data-status-banner]") !== null)).toBe(true);
      expect(view.queryByText("Needs: Brain (down)")).toBeNull();
      expect(view.queryByText("Behind the scenes")).toBeNull();
      expect(view.queryByText("Brain", { exact: true })).toBeNull();
      expect(view.queryByRole("button", { name: /Restart|Stop|Start/ })).toBeNull();
      expect(paths).toContain("/api/status/apps");
      expect(paths).not.toContain("/api/health");
      expect(paths).not.toContain("/api/status/history");
      expect(paths).not.toContain("/api/status/protection");
    } finally { restore(); }
  });

  test("admins get each app's needs and the original raw parts and controls below them", async () => {
    const { paths, restore } = mockStatus(true);
    try {
      const view = renderWithQueryClient(<StatusPage person={makePerson("admin")} />);
      expect(await view.findByText("Apps")).toBeTruthy();
      expect(await view.findByText("Chat isn't working: Brain isn't running.")).toBeTruthy();
      expect(await view.findByText("Needs attention")).toBeTruthy();
      expect(await view.findByText("Behind the scenes")).toBeTruthy();
      expect((await view.findAllByText("Brain", { exact: true })).length).toBeGreaterThan(0);
      expect(view.getAllByRole("button", { name: "Restart" })).toHaveLength(4);
      expect(paths).toContain("/api/health");
      expect(paths).toContain("/api/status/history");
      expect(paths).toContain("/api/status/protection");
      expect(await view.findByText("Protection on this hub")).toBeTruthy();
      expect(view.getByText("2 profiles have no passcode.")).toBeTruthy();
      expect(view.getByText("Minimum passcode length")).toBeTruthy();
      const appsCard = view.getByText("Apps").closest("[data-slot='card']");
      const scenesHeading = view.getByText("Behind the scenes");
      expect(appsCard !== null && Boolean(appsCard?.compareDocumentPosition(scenesHeading) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    } finally { restore(); }
  });

  test("admin incident timeline uses only the existing status-history response", async () => {
    const history = { generated_at: "2026-09-30T12:00:00.000Z", days: 90, components: [], incidents: [
      { component: "chat", started_at: "2026-09-29T10:00:00.000Z", ended_at: null, minutes: 120, ongoing: true },
      { component: "voice", started_at: "2026-09-27T08:00:00.000Z", ended_at: "2026-09-27T08:35:00.000Z", minutes: 35, ongoing: false },
    ] } satisfies StatusHistory;
    const { paths, restore } = mockStatus(true, history);
    try {
      const view = renderWithQueryClient(<StatusPage person={makePerson("admin")} />);
      expect(await view.findByText("Recent problems")).toBeTruthy();
      expect(view.container.querySelectorAll('[data-slot="timeline"]')).toHaveLength(1);
      const timeline = view.container.querySelector('[data-slot="timeline"]')!;
      expect(timeline.textContent).toContain("Ongoing since");
      expect(timeline.textContent).toContain("2 h");
      expect(timeline.textContent).toContain("Ended");
      expect(timeline.textContent).toContain("35 min");
      expect(timeline.textContent).toContain("Brain");
      expect(timeline.textContent).toContain("Voice");
      expect(paths.filter((path) => path === "/api/status/history")).toHaveLength(1);
    } finally { restore(); }
  });
});
