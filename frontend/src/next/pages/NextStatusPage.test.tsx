import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup } from "@testing-library/react";
import { NextStatusPage } from "@/next/pages/NextStatusPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { Roster, StatusAppsResponse } from "@/lib/api";

afterEach(cleanup);

function makePerson(role: Roster["role"]): Roster {
  return { id: "person-abc123", display_name: "Nova", nickname: null, role, avatar_seed: "person-abc123", source: "hub", local_only: false, created_at: "2026-09-04T00:00:00.000Z", updated_at: "2026-09-04T00:00:00.000Z", deleted_at: null, enabled: true, guest_expires_at: null, memorialized_at: null, hlc: "1788000000000:0:test", hasSecret: true } as Roster;
}

const apps: StatusAppsResponse = [
  { id: "chat", name: "Chat", state: "down", reason: "Chat is not working because Brain is down.", needs: [{ kind: "engine", id: "chat", name: "Brain", purpose: "Chat model", state: "down", required: true }], history: Array.from({ length: 90 }, (_, index) => ({ date: `2026-07-${String((index % 30) + 1).padStart(2, "0")}`, state: index === 89 ? "down" : "operational", uptime: index === 89 ? 50 : 100 })), uptimePercent: 99.5 },
  ...["Home", "Videos", "Music", "Podcasts"].map((name) => ({ id: name.toLowerCase(), name, state: "operational" as const, reason: null, needs: [{ kind: "engine" as const, id: "chat", name: "Brain", purpose: "Chat model", state: "operational" as const, required: true }], history: Array.from({ length: 90 }, (_, index) => ({ date: `2026-07-${String((index % 30) + 1).padStart(2, "0")}`, state: "operational" as const, uptime: 100 })), uptimePercent: 100 })),
];

function mockStatus() {
  const original = globalThis.fetch;
  const paths: string[] = [];
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    paths.push(url.split("?")[0] ?? "");
    if (url.includes("/api/status/apps")) return Promise.resolve(Response.json(apps));
    if (url.includes("/api/health")) return Promise.resolve(Response.json({
      brain: "selection", voice: "spawned", ok: true, uptimeSeconds: 60,
      engines: { chat: { kind: "selection", pid: null, alive: true }, embed: { kind: "spawned", pid: null, alive: true }, background: { kind: "spawned", pid: null, alive: true }, voice: { kind: "spawned", pid: null, alive: true } }, sidecars: [],
    }));
    if (url.includes("/api/status/history")) return Promise.resolve(Response.json({ generated_at: new Date().toISOString(), days: 90, components: [], incidents: [] }));
    if (url.includes("/api/status/board")) return Promise.resolve(Response.json({ note: null, maintenance: [] }));
    return Promise.resolve(Response.json({}));
  }) as unknown as typeof fetch;
  return { paths, restore: () => { globalThis.fetch = original; } };
}

describe("NextStatusPage app-first view", () => {
  test("members get app rows, reason, and bars without dependency names, controls, or raw-part requests", async () => {
    const { paths, restore } = mockStatus();
    try {
      const view = renderWithQueryClient(<NextStatusPage person={makePerson("adult")} />);
      expect(await view.findByText("Apps")).toBeTruthy();
      expect(view.getAllByText("Chat is not working because Brain is down.").length).toBeGreaterThan(0);
      for (const name of ["Chat", "Home", "Videos", "Music", "Podcasts"]) expect(view.getAllByText(name).length).toBeGreaterThan(0);
      expect(view.getAllByText("Chat is not working because Brain is down.").some((line) => line.closest("[data-status-banner]") !== null)).toBe(true);
      expect(view.queryByText("Needs: Brain (down)")).toBeNull();
      expect(view.queryByText("Behind the scenes")).toBeNull();
      expect(view.queryByText("Brain", { exact: true })).toBeNull();
      expect(view.queryByRole("button", { name: /Restart|Stop|Start/ })).toBeNull();
      expect(paths).toContain("/api/status/apps");
      expect(paths).not.toContain("/api/health");
      expect(paths).not.toContain("/api/status/history");
    } finally { restore(); }
  });

  test("admins get each app's needs and the original raw parts and controls below them", async () => {
    const { paths, restore } = mockStatus();
    try {
      const view = renderWithQueryClient(<NextStatusPage person={makePerson("admin")} />);
      expect(await view.findByText("Apps")).toBeTruthy();
      expect(await view.findByText("Needs: Brain (down)")).toBeTruthy();
      expect(await view.findByText("Behind the scenes")).toBeTruthy();
      expect(await view.findByText("Brain", { exact: true })).toBeTruthy();
      expect(view.getAllByRole("button", { name: "Restart" })).toHaveLength(4);
      expect(paths).toContain("/api/health");
      expect(paths).toContain("/api/status/history");
      const appsCard = view.getByText("Apps").closest("[data-slot='card']");
      const scenesHeading = view.getByText("Behind the scenes");
      expect(appsCard !== null && Boolean(appsCard?.compareDocumentPosition(scenesHeading) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    } finally { restore(); }
  });
});
