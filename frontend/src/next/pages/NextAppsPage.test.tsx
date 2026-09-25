import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, waitFor } from "@testing-library/react";
import { NextAppsPage } from "@/next/pages/NextAppsPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { InstalledPackage } from "@/lib/api";

afterEach(() => {
  cleanup();
});

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
      renderWithQueryClient(<NextAppsPage />);
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
      renderWithQueryClient(<NextAppsPage />);
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

  test("a real Apps heading and a read-only table without the demo title or Action column", async () => {
    const restore = mockPluginsFetch([makePackage()]);
    try {
      renderWithQueryClient(<NextAppsPage />);
      await waitFor(() => expect(document.body.textContent).toContain("Weather"));
      expect(document.querySelectorAll('[data-slot="card-title"]')[0]?.textContent).toContain("Apps");
      expect(document.body.textContent).not.toContain("Employee Data Table");
      const table = document.querySelector('[data-slot="table"]');
      expect(table).not.toBeNull();
      expect(Array.from(table!.querySelectorAll('[data-slot="table-head"]')).map((head) => head.textContent?.trim())).toEqual([
        "Name", "Category", "Type", "Version", "Status",
      ]);
    } finally {
      restore();
    }
  });

  test("no packages installed: the shared table's empty message, not a blank grid", async () => {
    const restore = mockPluginsFetch([]);
    try {
      renderWithQueryClient(<NextAppsPage />);
      await waitFor(() => expect(document.body.textContent).toContain("No data available."));
    } finally {
      restore();
    }
  });
});
