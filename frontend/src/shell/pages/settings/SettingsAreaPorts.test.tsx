// APP-SET-02: the old settings page's behaviours, re-pointed at the new route
// and never weakened (SettingsPage, MeSettings and
// HouseholdSettings tests, deleted with those files).
import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { renderWithQueryClient } from "../../../../tests/renderWithQueryClient";
import { SettingsAreaPage } from "@/shell/pages/settings/SettingsAreaPage";
import { ComposerWakeWordControl } from "@/apps/chat/ComposerWakeWordControl";
import { CHAT_SHORTCUTS } from "@/shell/pages/chatShortcuts";
import { getDeviceSettingsScope } from "@/lib/deviceSettingsScope";
import { makePerson, mockHome, type HomeFixture } from "@/shell/pages/settings/settingsTestKit";
import type { Roster } from "@/lib/api";

let fixture: HomeFixture | null = null;
afterEach(() => {
  cleanup();
  fixture?.restore();
  fixture = null;
  localStorage.removeItem("maipai.device-settings-id.v1");
  localStorage.removeItem("maipai.device-appearance.v1");
});

function open(person: Roster, url: string, home: Parameters<typeof mockHome>[0] = {}, extra?: React.ReactNode) {
  fixture = mockHome(home);
  return renderWithQueryClient(
    <MemoryRouter initialEntries={[url]}>
      {extra}
      <Routes>
        <Route path="settings/:area/:section?" element={<SettingsAreaPage person={person} onPersonChange={() => {}} />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ported from the old settings page", () => {
  test("an adult's composer and This device settings control write the same wake-word value", async () => {
    localStorage.setItem("maipai.device-settings-id.v1", "browser-1234567890ab");
    const deviceScope = getDeviceSettingsScope();
    const adult = makePerson("adult");
    const view = open(adult, "/settings/account/device", { wakeword: true }, <ComposerWakeWordControl person={adult} />);
    fireEvent.click(await view.findByRole("button", { name: "Turn on wake word listening" }));
    await waitFor(() => expect(fixture!.puts).toContainEqual({ scope: deviceScope, key: "voice.wakeword.enabled", value: true }));
    const toggle = await view.findByRole("switch", { name: "Wake word listening" });
    await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("true"));
    expect(fixture!.puts.every((put) => put.scope === deviceScope && put.key === "voice.wakeword.enabled")).toBe(true);
  });

  test("the enrollment sounds switch is on the Profile face card and writes false", async () => {
    const owner = makePerson("owner");
    const view = open(owner, "/settings/account/profile");
    const sounds = await view.findByRole("switch", { name: "Enrollment sounds" });
    expect(view.getAllByRole("switch", { name: "Enrollment sounds" })).toHaveLength(1);
    fireEvent.click(sounds);
    await waitFor(() => expect(fixture!.puts).toContainEqual({ scope: "person:person-owner", key: "ui.enrollment_sounds", value: false }));
  });

  test("Profile draws the profile form", async () => {
    open(makePerson("adult"), "/settings/account/profile");
    await waitFor(() => expect(document.body.querySelector("input#profile-display-name")).not.toBeNull());
  });

  test("Appearance offers a device-only override and reset without writing the setting", async () => {
    const view = open(makePerson("adult"), "/settings/account/appearance");
    const choose = await view.findByRole("combobox", { name: "On this device only" });
    expect(choose).toBeTruthy();
    fireEvent.click(await view.findByRole("button", { name: "Reset device appearance" }));
    expect(fixture!.puts.filter((put) => put.key === "ui.appearance")).toEqual([]);
    expect(view.getByText("Choose a look for this browser. It does not change your personal setting.")).toBeTruthy();
  });

  test("Notifications has the alert switch, muted senders and quiet hours rows", async () => {
    const view = open(makePerson("adult"), "/settings/account/notifications");
    await waitFor(() => expect(view.getByText("Show alerts on this device")).toBeTruthy());
    expect(view.getByText("Personal quiet hours start")).toBeTruthy();
    expect(view.getByText("Personal quiet hours end")).toBeTruthy();
    expect(view.getByText("Don't notify me about shares from")).toBeTruthy();
  });

  test("the Telegram card stays folded until opened, then holds its rows", async () => {
    const view = open(makePerson("adult"), "/settings/account/notifications");
    await waitFor(() => expect(view.getByText("Show alerts on this device")).toBeTruthy());
    expect(view.queryByText("Telegram chat id")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Telegram" }));
    await waitFor(() => expect(document.body.querySelector('[data-setting-key="notifications.telegram.chat_id"]')).not.toBeNull());
  });

  test("turning browser alerts on asks the browser for permission first, and a refusal writes nothing", async () => {
    const original = { notification: Object.getOwnPropertyDescriptor(globalThis, "Notification"), sw: Object.getOwnPropertyDescriptor(navigator, "serviceWorker") };
    const ask = mock(async () => "denied");
    Object.defineProperty(globalThis, "Notification", { configurable: true, writable: true, value: { requestPermission: ask } });
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: {} });
    try {
      const view = open(makePerson("adult"), "/settings/account/notifications");
      fireEvent.click(await view.findByRole("switch", { name: "Show alerts on this device" }));
      await waitFor(() => expect(view.getByText("Browser permission was not granted, so alerts are off.")).toBeTruthy());
      expect(ask).toHaveBeenCalled();
      expect(fixture!.puts.filter((put) => put.key === "notifications.browser.enabled")).toEqual([]);
    } finally {
      if (original.notification) Object.defineProperty(globalThis, "Notification", original.notification); else delete (globalThis as { Notification?: unknown }).Notification;
      if (original.sw) Object.defineProperty(navigator, "serviceWorker", original.sw); else delete (navigator as { serviceWorker?: unknown }).serviceWorker;
    }
  });

  test("Voice keeps personal controls and links adults to command creation", async () => {
    const view = open(makePerson("adult"), "/settings/account/voice");
    await waitFor(() => expect(view.getByText("Speaking voice", { selector: "h2" })).toBeTruthy());
    const links = view.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(links).toContain("/commands");
    expect(links).not.toContain("/voices");
  });

  test("Data and privacy links to devices, storage and the privacy page", async () => {
    const view = open(makePerson("adult"), "/settings/account/data");
    await waitFor(() => expect(view.getAllByRole("link").map((a) => a.getAttribute("href"))).toContain("/devices"));
    const links = view.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(links).toEqual(expect.arrayContaining(["/storage", "/privacy"]));
  });

  test("Home settings ports engine credentials and the voice token into Engines and AI", async () => {
    const view = open(makePerson("owner"), "/settings/home/ai");
    await waitFor(() => expect(view.getByText("Chat", { selector: "h2" })).toBeTruthy());
    expect(await view.findByText("Engine computer link", { selector: "h2" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Pair engine computer" })).toBeTruthy();
    expect(await view.findByText("Hugging Face token (for voice cloning)", { selector: "h2" })).toBeTruthy();
  });

  test("Home Devices keeps Add a robot available before pairing", async () => {
    const view = open(makePerson("admin"), "/settings/home/robot");
    expect(await view.findByText("Add a robot", { selector: "h2" })).toBeTruthy();
    expect(fixture!.requests.some((r) => r.includes("/api/devices/discover-robots"))).toBe(true);
  });

  test("Home Developer tools shows plugin routing stats", async () => {
    const view = open(makePerson("owner"), "/settings/home/developer");
    expect(await view.findByText("Plugin routing", { selector: "h2" })).toBeTruthy();
    expect(await view.findByText("No chat turns yet.")).toBeTruthy();
  });

  test("Home settings links to every page it used to: users, family, models, engines, backups, storage, updates, repairs, performance, status, privacy", async () => {
    const owner = makePerson("owner");
    const view = open(owner, "/settings/home/people");
    const hrefs = new Set<string>();
    for (const section of ["people", "ai", "storage", "maintenance", "privacy"]) {
      cleanup();
      fixture!.restore();
      open(owner, `/settings/home/${section}`);
      await waitFor(() => expect(within(document.body).getAllByRole("link").length).toBeGreaterThan(8));
      within(document.body).getAllByRole("link").forEach((a) => hrefs.add(a.getAttribute("href") ?? ""));
    }
    void view;
    for (const href of ["/users", "/people", "/models", "/engines", "/backups", "/storage", "/updates", "/repairs", "/performance", "/status", "/privacy"]) expect(hrefs).toContain(href);
  });

  test("Chat settings > Skills draws the registered Skills view, and Keyboard shortcuts the chat's own list", async () => {
    const adult = makePerson("adult");
    const skills = open(adult, "/settings/chat/skills");
    await waitFor(() => expect(fixture!.requests.some((r) => r.includes("/api/plugins/skills"))).toBe(true));
    cleanup();
    fixture!.restore();
    const shortcuts = open(adult, "/settings/chat/shortcuts");
    for (const [label, shortcut] of CHAT_SHORTCUTS) {
      await waitFor(() => expect(shortcuts.getByText(label)).toBeTruthy());
      expect(shortcuts.getAllByText(shortcut).length).toBeGreaterThan(0);
    }
    void skills;
  });

  test("Chat settings > General holds the chat card and the search card for an adult", async () => {
    const view = open(makePerson("adult"), "/settings/chat/general");
    await waitFor(() => expect(view.getByText("Send photos in chat")).toBeTruthy());
    expect(view.getByText("Show pictures in answers")).toBeTruthy();
    expect(view.getByText("Safe search level")).toBeTruthy();
    expect(view.getByText("Chat", { selector: "h2" })).toBeTruthy();
    expect(view.getByText("Search", { selector: "h2" })).toBeTruthy();
  });
});
