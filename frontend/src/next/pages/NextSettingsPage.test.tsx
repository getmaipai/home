import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { TooltipProvider } from "@maipai/ui/src/ui/tooltip";
import { NextSettingsPage } from "@/next/pages/NextSettingsPage";
import { ComposerWakeWordControl } from "@/apps/chat/ComposerWakeWordControl";
import { getDeviceSettingsScope } from "@/lib/deviceSettingsScope";
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

function mockSettingsFetch(registry: SettingsKey[], valuesByScope: Record<string, ResolvedSetting[]>, roster: Roster[] = []) {
  const originalFetch = globalThis.fetch;
  const puts: Array<{ scope: string; key: string; value: unknown }> = [];
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/voice/wakewords")) return Promise.resolve(Response.json({ detectors: [], installed: true }));
    if (url.includes("/api/settings/registry")) return Promise.resolve(Response.json(registry));
    if (url.includes("/api/biometric-prints")) return Promise.resolve(Response.json([]));
    if (url.includes("/api/settings?scope=")) {
      const scope = decodeURIComponent(url.split("scope=")[1] ?? "");
      return Promise.resolve(Response.json(valuesByScope[scope] ?? []));
    }
    if (url.includes("/api/settings") && init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      puts.push(body);
      const key = registry.find((k) => k.key === body.key)!;
      const updated = makeValue({ ...key }, body.value);
      const current = valuesByScope[body.scope] ?? [];
      valuesByScope[body.scope] = current.some((item) => item.key === body.key)
        ? current.map((item) => item.key === body.key ? updated : item)
        : [...current, updated];
      return Promise.resolve(Response.json(updated));
    }
    // NOTIFY-SHARE-02: PersonMultiSelect's own roster fetch (api.people()).
    if (url.includes("/api/people") && (!init?.method || init.method === "GET")) {
      return Promise.resolve(Response.json(roster));
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as unknown as typeof fetch;
  return { restore: () => { globalThis.fetch = originalFetch; }, puts };
}

describe("NextSettingsPage", () => {
  test("Household and Me tabs have fitting width and even horizontal padding", async () => {
    const { restore } = mockSettingsFetch([], { household: [], "person:person-abc123": [] });
    try {
      renderWithQueryClient(<MemoryRouter><NextSettingsPage person={makePerson()} /></MemoryRouter>);
      const household = await waitFor(() => {
        const found = Array.from(document.querySelectorAll('[role="tab"]')).find((tab) => tab.textContent === "Household");
        expect(found).not.toBeNull();
        return found as HTMLElement;
      });
      const me = Array.from(document.querySelectorAll('[role="tab"]')).find((tab) => tab.textContent === "Me") as HTMLElement;
      const list = household.closest('[role="tablist"]') as HTMLElement;
      expect(list.className).toContain("w-auto");
      expect(list.className).toContain("self-start");
      for (const trigger of [household, me]) {
        expect(trigger.className).toContain("min-w-fit");
        expect(trigger.className).toContain("flex-none");
        expect(trigger.className).toContain("px-4");
      }
    } finally { restore(); }
  });

  test.each(["owner", "child"] as const)("the %s can reach Status from Privacy and data", async (role) => {
    const { restore } = mockSettingsFetch([], { household: [], "person:person-abc123": [] });
    try {
      renderWithQueryClient(
        <MemoryRouter>
          <NextSettingsPage person={makePerson({ role })} />
        </MemoryRouter>,
      );
      const meTab = Array.from(document.querySelectorAll('[role="tab"]')).find((el) => el.textContent === "Me");
      if (meTab) fireEvent.click(meTab);
      const privacy = await waitFor(() => Array.from(document.querySelectorAll('[role="tab"]')).find((el) => el.textContent === "Privacy and data") as HTMLElement);
      fireEvent.click(privacy);
      const link = await waitFor(() => Array.from(document.querySelectorAll("a")).find((anchor) => anchor.textContent?.includes("Status")) as HTMLAnchorElement);
      expect(link.getAttribute("href")).toBe("/status");
    } finally {
      restore();
    }
  });

  test("an adult's composer and This device settings control write the same wake-word value", async () => {
    const wakeword = makeKey({ key: "voice.wakeword.enabled", scope: "device", selector: "boolean", default: false, label: "Wake word listening", lives_in: "device.voice" });
    localStorage.setItem("maipai.device-settings-id.v1", "browser-1234567890ab");
    const deviceScope = getDeviceSettingsScope();
    const adult = makePerson({ id: "person-adult123", avatar_seed: "person-adult123", role: "adult" });
    const { restore, puts } = mockSettingsFetch([wakeword], {
      household: [],
      [`person:${adult.id}`]: [],
      [deviceScope]: [makeValue(wakeword, false)],
    });
    try {
      const view = renderWithQueryClient(
        <MemoryRouter>
          <TooltipProvider>
            <NextSettingsPage person={adult} />
            <ComposerWakeWordControl person={adult} />
          </TooltipProvider>
        </MemoryRouter>,
      );
      const composerToggle = await view.findByRole("button", { name: "Turn on wake word listening" });
      fireEvent.click(composerToggle);
      await waitFor(() => expect(puts).toContainEqual({ scope: deviceScope, key: wakeword.key, value: true }));
      await waitFor(() => expect(view.getByRole("button", { name: "Turn off wake word listening" }).getAttribute("aria-pressed")).toBe("true"));

      fireEvent.click(await view.findByRole("tab", { name: "This device" }));
      const settingsToggle = await view.findByRole("switch", { name: "Wake word listening" });
      await waitFor(() => expect(settingsToggle.getAttribute("aria-checked")).toBe("true"));
      fireEvent.click(settingsToggle);
      await waitFor(() => expect(puts).toContainEqual({ scope: deviceScope, key: wakeword.key, value: false }));
      await waitFor(() => expect(view.getByRole("button", { name: "Turn on wake word listening" }).getAttribute("aria-pressed")).toBe("false"));
      expect(puts.every((put) => put.scope === deviceScope && put.key === wakeword.key)).toBe(true);
    } finally {
      restore();
    }
  });

  test("an owner can choose the Appearance section from Me", async () => {
    const appearance = makeKey({ key: "ui.appearance", scope: "person", selector: "select", range: { options: ["system", "light", "dark"] }, label: "Appearance", level: "basic", lives_in: "profile.appearance" });
    const { restore } = mockSettingsFetch([appearance], { household: [], "person:person-abc123": [makeValue(appearance, "system")] });
    try {
      renderWithQueryClient(<MemoryRouter><NextSettingsPage person={makePerson()} /></MemoryRouter>);
      const meTab = await waitFor(() => Array.from(document.querySelectorAll('[role="tab"]')).find((el) => el.textContent === "Me") as HTMLElement);
      fireEvent.click(meTab);
      const appearanceTab = await waitFor(() => Array.from(document.querySelectorAll('[role="tab"]')).find((el) => el.textContent === "Appearance") as HTMLElement);
      fireEvent.click(appearanceTab);
      await waitFor(() => expect(appearanceTab.getAttribute("aria-selected")).toBe("true"));
      expect(document.body.textContent).toContain("Choose how MaiPai looks.");
    } finally { restore(); }
  });

  // SETTINGS-S3 keeps enrollment sounds on the face card's shared settings path.
  test("ui.enrollment_sounds is on the Profile face card and writes false", async () => {
    const sounds = makeKey({ key: "ui.enrollment_sounds", scope: "person", selector: "boolean", default: true, label: "Enrollment sounds", level: "basic", lives_in: "profile.appearance" });
    const stats = makeKey({ key: "ui.show_turn_stats", scope: "person", selector: "boolean", default: true, label: "Show reply stats", level: "advanced", lives_in: "profile.appearance" });
    const { restore, puts } = mockSettingsFetch([sounds, stats], { household: [], "person:person-abc123": [makeValue(sounds, true), makeValue(stats, true)] });
    try {
      const prints = Promise.resolve(Response.json([]));
      const previous = globalThis.fetch;
      globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/api/biometric-prints")) return prints;
        if (url.includes("/api/settings/registry")) return Promise.resolve(Response.json([sounds, stats]));
        if (url.includes("/api/settings?scope=")) return Promise.resolve(Response.json([makeValue(sounds, true), makeValue(stats, true)]));
        if (url.includes("/api/settings") && init?.method === "PUT") { const body = JSON.parse(String(init.body)); puts.push(body); return Promise.resolve(Response.json(makeValue(sounds, body.value))); }
        return Promise.resolve(Response.json([]));
      }) as unknown as typeof fetch;
      renderWithQueryClient(
        <MemoryRouter>
          <NextSettingsPage person={makePerson()} />
        </MemoryRouter>,
      );
      const meTab = await waitFor(() => {
        const found = Array.from(document.querySelectorAll('[role="tab"]')).find((el) => el.textContent === "Me");
        expect(found).toBeDefined();
        return found as HTMLElement;
      });
      fireEvent.click(meTab);
      const toggle = await waitFor(() => { const found = document.querySelector('[role="switch"][aria-label="Enrollment sounds"]'); expect(found).not.toBeNull(); return found as HTMLElement; });
      expect(toggle.getAttribute("aria-checked")).toBe("true");
      fireEvent.click(toggle);
      await waitFor(() => expect(puts).toContainEqual({ scope: "person:person-abc123", key: "ui.enrollment_sounds", value: false }));
      fireEvent.click(await waitFor(() => Array.from(document.querySelectorAll('[role="tab"]')).find((el) => el.textContent === "Appearance") as HTMLElement));
      fireEvent.click(await waitFor(() => Array.from(document.querySelectorAll('[data-slot="collapsible-trigger"]')).find((el) => el.textContent?.includes("Advanced")) as HTMLElement));
      await waitFor(() => expect(document.body.textContent).toContain("Show reply stats"));
      expect(document.body.textContent).not.toContain("Enrollment sounds");
      globalThis.fetch = previous;
    } finally {
      restore();
    }
  });

  // Every former Manage route remains reachable from its new section.
  test("the Household sections link to all former Manage routes or their replacement", async () => {
    const { restore } = mockSettingsFetch([], { household: [], "person:person-abc123": [] });
    try {
      renderWithQueryClient(
        <MemoryRouter>
          <NextSettingsPage person={makePerson()} />
        </MemoryRouter>,
      );
      const statusTab = await waitFor(() => Array.from(document.querySelectorAll('[role="tab"]')).find((el) => el.textContent === "AI") as HTMLElement);
      fireEvent.click(statusTab);
      await waitFor(() => expect(Array.from(document.querySelectorAll("a")).some((a) => a.textContent?.includes("Status") && a.getAttribute("href") === "/status")).toBe(true));
      for (const [title, href, section] of [["Updates", "/updates", "Maintenance"], ["Repairs", "/repairs", "Maintenance"], ["Performance", "/performance", "Maintenance"], ["Backups", "/backups", "Storage and backups"], ["Users", "/users", "People"], ["AI models", "/models", "AI"]] as const) {
        fireEvent.click(Array.from(document.querySelectorAll('[role="tab"]')).find((el) => el.textContent === section) as HTMLElement);
        await waitFor(() => expect(Array.from(document.querySelectorAll("a")).some((a) => a.textContent?.includes(title) && a.getAttribute("href") === href)).toBe(true));
      }
      expect(Array.from(document.querySelectorAll("a")).some((a) => a.getAttribute("href") === "/engines")).toBe(false);
    } finally {
      restore();
    }
  });

  test("Household has six grouped sections and hides the tab from non-admins", async () => {
    const { restore } = mockSettingsFetch([], { household: [], "person:person-abc123": [] });
    try {
      renderWithQueryClient(<MemoryRouter><NextSettingsPage person={makePerson()} /></MemoryRouter>);
      const tabs = await waitFor(() => {
        const names = Array.from(document.querySelectorAll('[role="tab"]')).map((tab) => tab.textContent);
        expect(names).toContain("General");
        return names;
      });
      expect(tabs.filter((name) => ["General", "People", "AI", "Integrations", "Storage and backups", "Maintenance"].includes(name ?? ""))).toEqual(["General", "People", "AI", "Integrations", "Storage and backups", "Maintenance"]);
    } finally { restore(); }
    cleanup();
    const second = mockSettingsFetch([], { household: [], "person:person-abc123": [] });
    try {
      renderWithQueryClient(<MemoryRouter><NextSettingsPage person={makePerson({ role: "child" })} /></MemoryRouter>);
      await waitFor(() => expect(Array.from(document.querySelectorAll('[role="tab"]')).some((tab) => tab.textContent === "Household")).toBe(false));
    } finally { second.restore(); }
  });

  // A review caught this: `tab` was seeded from `?tab=` only inside a
  // lazy useState initializer, which React runs once at mount - a
  // person already on Settings (react-router never remounts this
  // component for a search-params-only URL change) who then clicked a
  // SECOND search result naming the other tab never saw it switch.
  test("a later navigation to a different ?tab= switches the active tab - not just the URL", async () => {
    const appearance = makeKey({ key: "ui.appearance", scope: "person", selector: "select", range: { options: ["system", "light", "dark"] }, label: "Appearance", level: "basic" });
    const householdKey = makeKey({ key: "household.test_key", scope: "household", selector: "boolean", label: "Household Test Setting", level: "basic", lives_in: "household.system" });
    const { restore } = mockSettingsFetch([appearance, householdKey], { household: [makeValue(householdKey, false)], "person:person-abc123": [makeValue(appearance, "system")] });
    function GoToHouseholdTab() {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => navigate("/settings?tab=household")}>
          simulate a search result to the household tab
        </button>
      );
    }
    try {
      const { getByText } = renderWithQueryClient(
        <MemoryRouter initialEntries={["/settings?tab=me"]}>
          <GoToHouseholdTab />
          <NextSettingsPage person={makePerson()} />
        </MemoryRouter>,
      );
      await waitFor(() => expect(document.body.textContent).toContain("Appearance"));
      expect(document.body.textContent).not.toContain("Household Test Setting");
      fireEvent.click(getByText("simulate a search result to the household tab"));
      await waitFor(() => expect(Array.from(document.querySelectorAll('[role="tab"]')).find((tab) => tab.textContent === "Household")?.getAttribute("aria-selected")).toBe("true"));
      expect(document.body.textContent).toContain("Household Test Setting");
    } finally {
      restore();
    }
  });

  test("unknown Household section values fall back to General", async () => {
    const system = makeKey({ key: "household.test_key", scope: "household", selector: "boolean", label: "Household Test Setting", level: "basic", lives_in: "household.system" });
    const { restore } = mockSettingsFetch([system], { household: [makeValue(system, false)], "person:person-abc123": [] });
    try {
      renderWithQueryClient(<MemoryRouter initialEntries={["/settings?tab=household&section=not-a-section"]}><NextSettingsPage person={makePerson()} /></MemoryRouter>);
      await waitFor(() => expect(document.body.textContent).toContain("Household Test Setting"));
      expect(Array.from(document.querySelectorAll('[role="tab"]')).find((tab) => tab.textContent === "General")?.getAttribute("aria-selected")).toBe("true");
    } finally { restore(); }
  });

  test("a non-admin sees no tab bar, only their own settings", async () => {
    const appearance = makeKey({ key: "ui.appearance", scope: "person", selector: "select", range: { options: ["system", "light", "dark"] }, label: "Appearance", level: "basic" });
    const { restore } = mockSettingsFetch([appearance], { household: [], "person:person-abc123": [makeValue(appearance, "system")] });
    try {
      renderWithQueryClient(
        <MemoryRouter>
          <NextSettingsPage person={makePerson({ role: "adult" })} />
        </MemoryRouter>,
      );
      await waitFor(() => expect(document.body.textContent).toContain("Appearance"));
      expect(document.querySelector('[data-slot="native-select"]')).not.toBeNull();
      expect(document.querySelector('[role="tablist"]')?.className).toContain("hidden");
    } finally {
      restore();
    }
  });

  // NOTIFY-SHARE-02: the settings renderer's first `selector: "person"`
  // + `range.multiple` key - the generic fallback above ("Not supported")
  // is what every OTHER unimplemented selector still gets, so this key
  // renders PersonMultiSelect instead and proves the actual round trip.
  test("a person-selector-with-multiple key shows an existing pick as a chip, excludes the viewer, and saves a new pick", async () => {
    const mutedSenders = makeKey({
      key: "notifications.file_shared.muted_senders",
      scope: "person",
      selector: "person",
      range: { multiple: true },
      label: "Don't notify me about shares from",
      level: "basic",
      lives_in: "person.notifications",
    });
    const marlow = makePerson({ id: "person-marlow1", display_name: "Marlow" });
    const iris = makePerson({ id: "person-iris1", display_name: "Iris" });
    const { restore, puts } = mockSettingsFetch(
      [mutedSenders],
      { household: [], "person:person-abc123": [makeValue(mutedSenders, ["person-marlow1"])] },
      [makePerson(), marlow, iris], // the viewer (Nova) is in the roster too, and must never be pickable
    );
    try {
      renderWithQueryClient(
        <MemoryRouter>
          <NextSettingsPage person={makePerson()} />
        </MemoryRouter>,
      );
      await waitFor(() => expect(document.body.textContent).toContain("Household"));
      const meTab = Array.from(document.querySelectorAll('[role="tab"]')).find((el) => el.textContent === "Me");
      expect(meTab).toBeDefined();
      fireEvent.click(meTab!);
      const notificationsTab = await waitFor(() => Array.from(document.querySelectorAll('[role="tab"]')).find((el) => el.textContent === "Notifications") as HTMLElement);
      fireEvent.click(notificationsTab);
      await waitFor(() => expect(document.body.textContent).toContain("Don't notify me about shares from"));
      // The existing pick renders as a chip with a real name, not the raw id.
      await waitFor(() => expect(document.body.textContent).toContain("Marlow"));
      expect(document.body.textContent).not.toContain("person-marlow1");

      const input = document.querySelector('[data-slot="combobox-chip-input"]') as HTMLInputElement | null;
      expect(input).not.toBeNull();
      // ArrowDown is what actually opens this popup under jsdom/happy-dom
      // (a plain click/focus does not - Base UI's pointer-open path needs
      // real layout this test environment doesn't have); the real app
      // still opens on a pointer click too, this is a test-only substitute
      // for driving the identical keyboard-accessible path.
      input!.focus();
      fireEvent.keyDown(input!, { key: "ArrowDown" });
      await waitFor(() => expect(document.querySelectorAll('[data-slot="combobox-item"]').length).toBeGreaterThan(0));
      const options = Array.from(document.querySelectorAll('[data-slot="combobox-item"]'));
      // Nova is the signed-in viewer (person-abc123): never offered as a
      // sender to mute, even though she's a real roster entry.
      expect(options.some((el) => el.textContent === "Nova")).toBe(false);
      const irisOption = options.find((el) => el.textContent === "Iris");
      expect(irisOption).toBeDefined();
      fireEvent.click(irisOption!);
      await waitFor(() =>
        expect(
          puts.some(
            (p) =>
              p.key === "notifications.file_shared.muted_senders" &&
              Array.isArray(p.value) &&
              (p.value as string[]).includes("person-iris1") &&
              (p.value as string[]).includes("person-marlow1"),
          ),
        ).toBe(true),
      );
    } finally {
      restore();
    }
  });

  test("an unsupported selector renders the registry's own fallback, never crashes", async () => {
    const media = makeKey({ key: "test.media_key", selector: "media", label: "Media Key", level: "basic", lives_in: "person.persona" });
    const { restore } = mockSettingsFetch([media], { household: [], "person:person-abc123": [makeValue(media, null)] });
    try {
      renderWithQueryClient(
        <MemoryRouter>
          <NextSettingsPage person={makePerson({ role: "adult" })} />
        </MemoryRouter>,
      );
      const voiceTab = await waitFor(() => Array.from(document.querySelectorAll('[role="tab"]')).find((el) => el.textContent === "Voice and AI") as HTMLElement);
      fireEvent.click(voiceTab);
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
      renderWithQueryClient(
        <MemoryRouter initialEntries={["/settings?section=appearance"]}>
          <NextSettingsPage person={makePerson({ role: "adult" })} />
        </MemoryRouter>,
      );
      await waitFor(() => expect(document.body.textContent).toContain("Could not load settings."));
      expect(document.body.textContent).toContain("Try again");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
