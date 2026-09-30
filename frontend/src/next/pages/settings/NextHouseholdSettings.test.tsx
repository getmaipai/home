import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import { NextHouseholdSettings } from "@/next/pages/settings/NextHouseholdSettings";
import { renderWithQueryClient } from "../../../../tests/renderWithQueryClient";
import type { ResolvedSetting } from "@/lib/api";
import type { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

afterEach(cleanup);

const groups = ["household.system", "household.ai", "household.integrations", "household.notifications", "household.reference", "household.storage"];

function run(initialUrl = "/settings?tab=household") {
  const registry: SettingsKey[] = [
    ["household.name", "household.system"], ["household.location", "household.system"], ["household.locale", "household.system"],
    ["ai.temperature", "household.ai"], ["integration.example", "household.integrations"], ["notifications.telegram.bot_token", "household.notifications"],
    ["reference.library_dir", "household.reference"], ["storage.household.cap_bytes", "household.storage"],
  ].map(([key, lives_in]) => ({ key, scope: "household", selector: "text", label: key, level: "basic", secret: false, lives_in, honoured_by: ["home"] } as SettingsKey));
  const values: ResolvedSetting[] = registry.map((item) => ({ key: item.key, value: "sample", source: "default", label: item.label, help: item.help, level: item.level, secret: item.secret }));
  const before = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/settings/registry")) return Promise.resolve(Response.json(registry));
    if (url.includes("/api/settings?scope=")) return Promise.resolve(Response.json(values));
    return Promise.resolve(Response.json([]));
  }) as unknown as typeof fetch;
  function Location() { const [params] = useSearchParams(); return <output data-testid="section-param">{params.get("section") ?? ""}</output>; }
  const view = renderWithQueryClient(<MemoryRouter initialEntries={[initialUrl]}><NextHouseholdSettings /><Location /></MemoryRouter>);
  return { ...view, restore: () => { globalThis.fetch = before; } };
}

describe("NextHouseholdSettings", () => {
  test("section query selects Maintenance and unknown values fall back to General", async () => {
    const first = run("/settings?tab=household&section=maintenance");
    try { await waitFor(() => expect(first.getByRole("tab", { name: "Maintenance" }).getAttribute("aria-selected")).toBe("true")); }
    finally { first.restore(); }
    cleanup();
    const second = run("/settings?tab=household&section=unknown");
    try { await waitFor(() => expect(second.getByRole("tab", { name: "General" }).getAttribute("aria-selected")).toBe("true")); }
    finally { second.restore(); }
  });

  test("renders every old group and Manage destination under one section", async () => {
    const view = run();
    try {
      await waitFor(() => expect(view.getByRole("tab", { name: "General" })).toBeTruthy());
      for (const group of groups) {
        const owningSection = group === "household.ai" ? "AI" : group === "household.integrations" || group === "household.notifications" || group === "household.reference" ? "Integrations" : group === "household.storage" ? "Storage and backups" : "General";
        fireEvent.click(view.getByRole("tab", { name: owningSection }));
        if (group === "household.ai") fireEvent.click(await view.findByRole("button", { name: /Advanced AI settings/ }));
        await waitFor(() => expect(document.getElementById(`settings-${group}`)).not.toBeNull());
      }
      for (const [title, href, section] of [["Users", "/users", "People"], ["Family", "/people", "People"], ["AI models", "/models", "AI"], ["Status", "/status", "AI"], ["Backups", "/backups", "Storage and backups"], ["Storage", "/storage", "Storage and backups"], ["Updates", "/updates", "Maintenance"], ["Repairs", "/repairs", "Maintenance"], ["Performance", "/performance", "Maintenance"]] as const) {
        fireEvent.click(view.getByRole("tab", { name: section }));
        expect(Array.from(document.querySelectorAll("a")).some((link) => link.textContent?.includes(title) && link.getAttribute("href") === href)).toBe(true);
      }
      expect(Array.from(document.querySelectorAll("a")).some((link) => link.getAttribute("href") === "/engines")).toBe(false);
    } finally { view.restore(); }
  });

  test("phone section control is a select", async () => {
    const view = run();
    try { await waitFor(() => expect(document.querySelector('[data-slot="native-select"]')).not.toBeNull()); }
    finally { view.restore(); }
  });
});
