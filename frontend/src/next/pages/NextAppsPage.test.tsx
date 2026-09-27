import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { NextAppsPage } from "@/next/pages/NextAppsPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { InstalledPackage, Roster } from "@/lib/api";

afterEach(() => {
  cleanup();
});

function makePerson(role: string = "owner"): Roster {
  return {
    id: "person-abc123", display_name: "Nova", nickname: null, role: role as Roster["role"],
    avatar_seed: "person-abc123", source: "hub", local_only: false,
    created_at: "2026-09-04T00:00:00.000Z", updated_at: "2026-09-04T00:00:00.000Z",
    deleted_at: null, enabled: true, guest_expires_at: null, memorialized_at: null,
    hlc: "1788000000000:0:test", hasSecret: true,
  } as Roster;
}

function makePackage(overrides: Partial<InstalledPackage> = {}): InstalledPackage {
  return {
    id: "weather",
    version: "0.1.0",
    kind: "plugin",
    category: "Utilities",
    display: "Weather",
    description: "Reads the local forecast.",
    author: "MaiPai",
    license: "AGPL-3.0",
    routing: { examples: ["what's the weather"], patterns: ["weather"] },
    args: { type: "object", required: [], properties: {} },
    requires: [],
    optional: [],
    platforms: ["home"],
    min_role: "child",
    consequential: false,
    offline: "full",
    config: [],
    data_sources: [],
    permissions: [],
    notifications: [],
    backup: "hot",
    background: false,
    contributes: {},
    min_app: "0.1.0",
    tier: 0,
    quality_scale: "bronze",
    installed_version: "0.1.0",
    latest_version: "0.1.0",
    channel: "stable",
    status: "enabled",
    smoke: { last_run_at: null, ok: true, message: null },
    ...overrides,
  } as InstalledPackage;
}

function mockPluginsFetch(packages: InstalledPackage[]) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/plugins")) return Promise.resolve(Response.json(packages));
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

describe("NextAppsPage", () => {
  test("a failed fetch shows an error and a retry button, never a stuck loading state", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify({ error: "Something broke" }), { status: 500 }))) as unknown as typeof fetch;
    try {
      renderWithQueryClient(<NextAppsPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("Something broke"));
      expect(document.body.textContent).toContain("Try again");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("real rows: name, category, type, version and a real Ready/Attention status, not the vendored demo data", async () => {
    const restore = mockPluginsFetch([
      makePackage({ id: "weather", display: "Weather", category: "Info", kind: "plugin", installed_version: "1.2.0", status: "enabled", smoke: { last_run_at: null, ok: true, message: null } }),
      makePackage({ id: "sleepy-bot", display: "Sleepy", category: "Family", kind: "companion", installed_version: "0.3.0", status: "disabled", smoke: { last_run_at: null, ok: false, message: "boom" } }),
    ]);
    try {
      renderWithQueryClient(<NextAppsPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("Weather"));
      expect(document.body.textContent).toContain("Info");
      expect(document.body.textContent).toContain("Plugin");
      expect(document.body.textContent).toContain("1.2.0");
      expect(document.body.textContent).toContain("Ready");
      expect(document.body.textContent).toContain("Sleepy");
      expect(document.body.textContent).toContain("Companion");
      expect(document.body.textContent).toContain("Attention");
    } finally {
      restore();
    }
  });

  test("a real Tools heading and an Actions column without the demo title", async () => {
    const restore = mockPluginsFetch([makePackage()]);
    try {
      renderWithQueryClient(<NextAppsPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("Weather"));
      expect(document.querySelectorAll('[data-slot="card-title"]')[0]?.textContent).toContain("Tools");
      expect(document.title).toBe("Tools · MaiPai Home");
      expect(document.body.textContent).not.toContain("Employee Data Table");
      const table = document.querySelector('[data-slot="table"]');
      expect(table).not.toBeNull();
      expect(Array.from(table!.querySelectorAll('[data-slot="table-head"]')).map((head) => head.textContent?.trim())).toEqual([
        "Name", "Category", "Type", "Version", "Status", "Actions",
      ]);
    } finally {
      restore();
    }
  });

  test("no packages installed: the shared table's empty message, not a blank grid", async () => {
    const restore = mockPluginsFetch([]);
    try {
      renderWithQueryClient(<NextAppsPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("No data available."));
    } finally {
      restore();
    }
  });

  test("Remove requires confirmation and uninstalls the correct package", async () => {
    const restore = mockPluginsFetch([makePackage({ id: "weather" })]);
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;
    try {
      renderWithQueryClient(<NextAppsPage person={makePerson("owner")} />);
      await waitFor(() => expect(document.body.textContent).toContain("Weather"));
      const row = Array.from(document.querySelectorAll('[data-slot="table-row"]')).find((item) => item.textContent?.includes("Weather"))!;
      fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "More actions" }));
      fireEvent.click(await within(document.body).findByRole("menuitem", { name: "Remove" }));
      expect(document.body.textContent).toContain("Remove Weather? This uninstalls it from the hub.");
      expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/uninstall"), expect.anything());
      fireEvent.click(within(document.body).getByRole("button", { name: "Confirm" }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/store/installs/weather/uninstall"), expect.objectContaining({ method: "POST" })));
    } finally {
      restore();
    }
  });

  test("Remove is disabled for a non-owner", async () => {
    const restore = mockPluginsFetch([makePackage()]);
    try {
      renderWithQueryClient(<NextAppsPage person={makePerson("child")} />);
      await waitFor(() => expect(document.body.textContent).toContain("Weather"));
      const row = Array.from(document.querySelectorAll('[data-slot="table-row"]')).find((item) => item.textContent?.includes("Weather"))!;
      fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "More actions" }));
      expect(await within(document.body).findByRole("menuitem", { name: "Remove" })).toHaveAttribute("aria-disabled", "true");
    } finally {
      restore();
    }
  });
});
