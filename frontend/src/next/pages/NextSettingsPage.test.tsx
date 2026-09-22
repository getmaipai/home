import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NextSettingsPage } from "@/next/pages/NextSettingsPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { Roster, ResolvedSetting } from "@/lib/api";
import type { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

afterEach(() => {
  cleanup();
});

function makePerson(overrides: Partial<Roster> = {}): Roster {
  return {
    id: "person-abc123",
    display_name: "Nova",
    nickname: null,
    role: "owner",
    avatar_seed: "person-abc123",
    source: "hub",
    local_only: false,
    created_at: "2026-09-04T00:00:00.000Z",
    updated_at: "2026-09-04T00:00:00.000Z",
    deleted_at: null,
    enabled: true,
    guest_expires_at: null,
    memorialized_at: null,
    hlc: "1788000000000:0:test",
    hasSecret: true,
    ...overrides,
  } as Roster;
}

function makeKey(overrides: Partial<SettingsKey> = {}): SettingsKey {
  return {
    key: "test.key",
    scope: "person",
    selector: "text",
    label: "Test key",
    level: "basic",
    secret: false,
    lives_in: "test.section",
    honoured_by: ["home"],
    ...overrides,
  } as SettingsKey;
}

function makeValue(key: SettingsKey, value: unknown): ResolvedSetting {
  return { key: key.key, value, source: "default", label: key.label, help: key.help, level: key.level, secret: key.secret };
}

function mockSettingsFetch(registry: SettingsKey[], valuesByScope: Record<string, ResolvedSetting[]>) {
  const originalFetch = globalThis.fetch;
  const puts: Array<{ scope: string; key: string; value: unknown }> = [];
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/settings/registry")) return Promise.resolve(Response.json(registry));
    if (url.includes("/api/settings?scope=")) {
      const scope = decodeURIComponent(url.split("scope=")[1] ?? "");
      return Promise.resolve(Response.json(valuesByScope[scope] ?? []));
    }
    if (url.includes("/api/settings") && init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      puts.push(body);
      const key = registry.find((k) => k.key === body.key)!;
      return Promise.resolve(Response.json(makeValue({ ...key }, body.value)));
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as unknown as typeof fetch;
  return { restore: () => { globalThis.fetch = originalFetch; }, puts };
}

describe("NextSettingsPage", () => {
  test("an owner sees both tabs; a basic person-scope select key changes live", async () => {
    const appearance = makeKey({ key: "ui.appearance", scope: "person", selector: "select", range: { options: ["system", "light", "dark"] }, label: "Appearance", level: "basic", lives_in: "profile.appearance" });
    const { restore, puts } = mockSettingsFetch([appearance], {
      household: [],
      "person:person-abc123": [makeValue(appearance, "system")],
    });
    try {
      // NextManageSection (the Household tab's own bottom section,
      // ui-v0.5.23) renders real react-router-dom Links - a router
      // context is needed the moment this renders, not just when a
      // link is clicked.
      renderWithQueryClient(
        <MemoryRouter>
          <NextSettingsPage person={makePerson()} />
        </MemoryRouter>,
      );
      await waitFor(() => expect(document.body.textContent).toContain("Household"));
      expect(document.body.textContent).toContain("Me");
      const meTab = Array.from(document.querySelectorAll('[role="tab"]')).find((el) => el.textContent === "Me");
      expect(meTab).toBeDefined();
      fireEvent.click(meTab!);
      await waitFor(() => expect(document.body.textContent).toContain("Appearance"));
      const trigger = document.querySelector('[data-slot="select-trigger"]') as HTMLElement | null;
      expect(trigger).not.toBeNull();
      fireEvent.click(trigger!);
      await waitFor(() => expect(document.body.textContent).toContain("Light"));
      const option = Array.from(document.querySelectorAll('[data-slot="select-item"]')).find((el) => el.textContent === "Light");
      expect(option).toBeDefined();
      fireEvent.pointerDown(option!, { pointerId: 1, pointerType: "mouse", button: 0 });
      fireEvent.pointerUp(option!, { pointerId: 1, pointerType: "mouse", button: 0 });
      fireEvent.click(option!);
      await waitFor(() => expect(puts.some((p) => p.key === "ui.appearance" && p.value === "light")).toBe(true));
    } finally {
      restore();
    }
  });

  // ui-v0.5.23's rail restructuring dropped the permanent Engines/
  // Updates/Repairs/Backups nav entries - this is their real way back,
  // so a real href to each real route is the acceptance, not just that
  // the section renders.
  test("the Household tab's own Manage section links to all four routes", async () => {
    const { restore } = mockSettingsFetch([], { household: [], "person:person-abc123": [] });
    try {
      renderWithQueryClient(
        <MemoryRouter>
          <NextSettingsPage person={makePerson()} />
        </MemoryRouter>,
      );
      await waitFor(() => expect(document.body.textContent).toContain("Manage"));
      for (const [title, href] of [
        ["Engines", "/next/engines"],
        ["Updates", "/next/updates"],
        ["Repairs", "/next/repairs"],
        ["Backups", "/next/backups"],
      ] as const) {
        const link = Array.from(document.querySelectorAll("a")).find((a) => a.textContent?.includes(title));
        expect(link).toBeDefined();
        expect(link!.getAttribute("href")).toBe(href);
      }
    } finally {
      restore();
    }
  });

  test("a household boolean key folded under advanced toggles once expanded", async () => {
    const b1 = makeKey({ key: "household.adv1", label: "Advanced One", level: "advanced", scope: "household", lives_in: "household.system" });
    const b2 = makeKey({ key: "household.adv2", label: "Advanced Two", level: "advanced", scope: "household", lives_in: "household.system" });
    const shellNext = makeKey({ key: "ui.shell.next", scope: "household", selector: "boolean", label: "New shell (preview)", level: "advanced", lives_in: "household.system" });
    const { restore, puts } = mockSettingsFetch([b1, b2, shellNext], {
      household: [makeValue(b1, "x"), makeValue(b2, "y"), makeValue(shellNext, false)],
      "person:person-abc123": [],
    });
    try {
      renderWithQueryClient(
        <MemoryRouter>
          <NextSettingsPage person={makePerson()} />
        </MemoryRouter>,
      );
      await waitFor(() => expect(document.body.textContent).toContain("Show 3 advanced settings"));
      expect(document.body.textContent).not.toContain("New shell (preview)");
      const showAdvanced = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("Show 3 advanced settings"));
      expect(showAdvanced).toBeDefined();
      fireEvent.click(showAdvanced!);
      await waitFor(() => expect(document.body.textContent).toContain("New shell (preview)"));
      const toggle = document.querySelector('[role="switch"]') as HTMLElement | null;
      expect(toggle).not.toBeNull();
      fireEvent.click(toggle!);
      await waitFor(() => expect(puts.some((p) => p.key === "ui.shell.next" && p.value === true)).toBe(true));
    } finally {
      restore();
    }
  });

  test("a non-admin sees no tab bar, only their own settings", async () => {
    const appearance = makeKey({ key: "ui.appearance", scope: "person", selector: "select", range: { options: ["system", "light", "dark"] }, label: "Appearance", level: "basic" });
    const { restore } = mockSettingsFetch([appearance], { household: [], "person:person-abc123": [makeValue(appearance, "system")] });
    try {
      renderWithQueryClient(<NextSettingsPage person={makePerson({ role: "adult" })} />);
      await waitFor(() => expect(document.body.textContent).toContain("Appearance"));
      expect(document.querySelector('[data-slot="tabs-list"]')).toBeNull();
    } finally {
      restore();
    }
  });

  test("an unsupported selector renders the registry's own fallback, never crashes", async () => {
    const media = makeKey({ key: "test.media_key", selector: "media", label: "Media Key", level: "basic" });
    const { restore } = mockSettingsFetch([media], { household: [], "person:person-abc123": [makeValue(media, null)] });
    try {
      renderWithQueryClient(<NextSettingsPage person={makePerson({ role: "adult" })} />);
      await waitFor(() => expect(document.body.textContent).toContain("Media Key"));
      expect(document.body.textContent).toContain("Not supported in this hub version yet.");
    } finally {
      restore();
    }
  });

  test("a failed settings fetch shows an error and a retry button, never a stuck loading state", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify({ error: "Something broke" }), { status: 500 }))) as unknown as typeof fetch;
    try {
      renderWithQueryClient(<NextSettingsPage person={makePerson({ role: "adult" })} />);
      await waitFor(() => expect(document.body.textContent).toContain("Could not load settings."));
      expect(document.body.textContent).toContain("Try again");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
