import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import { NextMeSettings } from "@/next/pages/settings/NextMeSettings";
import { renderWithQueryClient } from "../../../../tests/renderWithQueryClient";
import type { Roster, ResolvedSetting } from "@/lib/api";
import type { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

afterEach(cleanup);

function makePerson(role: Roster["role"] = "child"): Roster {
  return { id: "person-abc123", display_name: "Nova", nickname: null, role, avatar_seed: "person-abc123", source: "hub", local_only: false, created_at: "2026-09-04T00:00:00.000Z", updated_at: "2026-09-04T00:00:00.000Z", deleted_at: null, enabled: true, guest_expires_at: null, memorialized_at: null, hlc: "1788000000000:0:test", hasSecret: true } as Roster;
}

function makeKey(key: string, lives_in: string, selector: string = "text", level: string = "basic"): SettingsKey {
  return { key, scope: "person", selector, label: key === "ui.enrollment_sounds" ? "Enrollment sounds" : key, level, secret: false, lives_in, honoured_by: ["home"], ...(selector === "boolean" ? { default: true } : {}) } as SettingsKey;
}

function setup(role: Roster["role"], initialUrl = "/settings", telegramChatId = "chat-123") {
  const registry: SettingsKey[] = [
    makeKey("ui.appearance", "profile.appearance", "select"), makeKey("ui.look", "profile.appearance", "select"),
    makeKey("ui.enrollment_sounds", "person.profile", "boolean", "advanced"), makeKey("ui.show_turn_stats", "person.chat", "boolean", "advanced"),
    ...Array.from({ length: 9 }, (_, i) => makeKey(`allowance.${i}.daily_minutes`, "person.allowance", "number")),
    makeKey("notifications.telegram.chat_id", "person.telegram"),
    makeKey("notifications.browser.enabled", "person.notifications", "boolean"),
    { ...makeKey("person.quiet_hours.from", "person.notifications", "time"), default: null }, { ...makeKey("person.quiet_hours.to", "person.notifications", "time"), default: null },
    ...["approvals.requested", "backups.target_failing", "engines.problem", "engines.update_applied", "engines.update_available", "engines.update_failed", "file.shared_with_household", "file.shared_with_you", "memory.judge_failed", "memory.updated", "model.download_failed", "model.download_ready", "person.band_changed", "repairs.new", "updates.available"].map((name) => makeKey(`notifications.${name}.telegram`, "person.telegram", "boolean")),
    makeKey("personality.style", "person.persona"), makeKey("search.safe_search", "person.search", "boolean"), makeKey("chat.photo_uploads", "person.chat", "boolean"), makeKey("tts.voice_id", "person.voice", "select"),
    makeKey("storage.cap", "person.storage", "number"), makeKey("storage.cap_warning", "person.storage", "number"),
  ];
  const values: ResolvedSetting[] = registry.map((key) => ({ key: key.key, value: key.key === "notifications.telegram.chat_id" ? telegramChatId : key.default ?? "sample", source: "default", label: key.label, help: key.help, level: key.level, secret: key.secret }));
  const originalFetch = globalThis.fetch;
  const patches: unknown[] = [];
  const settingWrites: string[] = [];
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/settings") && init?.method && init.method !== "GET") settingWrites.push(`${init.method} ${url}`);
    if (url.endsWith(`/api/people/${makePerson(role).id}`) && init?.method === "PATCH") { const body = JSON.parse(String(init.body)); patches.push(body); return Promise.resolve(Response.json({ ...makePerson(role), display_name: body.displayName ?? "Nova" })); }
    if (url.includes("/api/biometric-prints")) return Promise.resolve(Response.json([]));
    if (url.includes("/api/settings/registry")) return Promise.resolve(Response.json(registry));
    if (url.includes("/api/settings?scope=")) return Promise.resolve(Response.json(values));
    return Promise.resolve(Response.json([]));
  }) as unknown as typeof fetch;
  function Location() { const [params] = useSearchParams(); return <output data-testid="section-param">{params.get("section") ?? ""}</output>; }
  const view = renderWithQueryClient(<MemoryRouter initialEntries={[initialUrl]}><NextMeSettings person={makePerson(role)} /><Location /></MemoryRouter>);
  return { ...view, patches, settingWrites, restore: () => { globalThis.fetch = originalFetch; } };
}

describe("NextMeSettings", () => {
  test("a non-admin sees the five personal sections without limits or admin settings", async () => {
    const { restore } = setup("child");
    try {
      await waitFor(() => expect(document.querySelector("input#profile-display-name")).not.toBeNull());
      expect((document.querySelector("input#profile-display-name") as HTMLInputElement).value).toBe("Nova");
      expect(document.body.textContent).toContain("Face recognition");
      for (const name of ["Profile", "Appearance", "Chat", "Voice and AI", "Notifications", "Privacy and data"]) expect(document.body.textContent).toContain(name);
      // SKILLS-PAGE-01: a child has no Chat skills section.
      expect(document.body.textContent).not.toContain("Chat skills");
      expect(document.body.textContent).not.toContain("Limits");
      expect(document.body.textContent).not.toContain("Allowance");
      expect(document.body.textContent).not.toContain("My storage");
    } finally { restore(); }
  });

  test("admins no longer see Limits or its allowance and storage groups in Me", async () => {
    const { restore } = setup("admin");
    try {
      await waitFor(() => expect(document.querySelector("input#profile-display-name")).not.toBeNull());
      expect(document.body.textContent).not.toContain("Limits");
      expect(document.body.textContent).not.toContain("Allowance");
      expect(document.body.textContent).not.toContain("My storage");
      expect(document.getElementById("settings-person.allowance")).toBeNull();
      expect(document.getElementById("settings-person.storage")).toBeNull();
      const sectionsToCheck = [
        { group: "profile.appearance", title: "Appearance" },
        { group: "person.chat", title: "Chat" },
        { group: "person.voice", title: "Voice and AI" },
        { group: "person.notifications", title: "Notifications" },
      ];
      for (const { group, title } of sectionsToCheck) {
        const sectionTab = Array.from(document.querySelectorAll("[role=tab]")).find((tab) => tab.textContent === title)!;
        fireEvent.click(sectionTab);
        await waitFor(() => expect(sectionTab.getAttribute("aria-selected")).toBe("true"));
        if (title === "Notifications") {
          const disclosure = await waitFor(() => Array.from(document.querySelectorAll('[data-slot="collapsible-trigger"]')).find((trigger) => trigger.textContent?.includes("Telegram options")) as HTMLElement);
          fireEvent.click(disclosure);
        }
        await waitFor(() => expect([group, document.getElementById(`settings-${group}`) !== null]).toEqual([group, true]));
      }
    } finally { restore(); }
  });

  test("Appearance offers a device-only override and reset without writing the setting", async () => {
    const { restore, getByRole, getByText, settingWrites } = setup("adult", "/settings?section=appearance");
    try {
      await waitFor(() => expect(getByText("On this device only")).toBeTruthy());
      fireEvent.click(getByRole("button", { name: "Reset device appearance" }));
      expect(settingWrites).toEqual([]);
    } finally { restore(); }
  });

  test("section query selects Appearance and unknown values fall back to Profile", async () => {
    const first = setup("child", "/settings?section=appearance");
    try { await waitFor(() => expect(first.getByTestId("section-param").textContent).toBe("appearance")); expect(first.getByRole("tab", { name: "Appearance" }).getAttribute("aria-selected")).toBe("true"); } finally { first.restore(); }
    cleanup();
    const second = setup("child", "/settings?section=unknown");
    try { await waitFor(() => expect(second.getByRole("tab", { name: "Profile" }).getAttribute("aria-selected")).toBe("true")); } finally { second.restore(); }
  });

  test("phone section control is a select and desktop tabs hide below md", async () => {
    const { restore } = setup("child");
    try { await waitFor(() => expect(document.querySelector('[data-slot="native-select"]') || document.querySelector('[data-slot="select-trigger"]')).not.toBeNull()); expect(document.querySelector('[role="tablist"].hidden, [role="tablist"].md\\:flex')).not.toBeNull(); } finally { restore(); }
  });

  test("Telegram rows stay inside the closed Advanced disclosure until opened", async () => {
    const { restore } = setup("child", "/settings?section=notifications");
    try {
      await waitFor(() => expect(document.body.textContent).toContain("Telegram options"));
      expect(document.querySelectorAll('[data-slot="switch"]')).toHaveLength(1); // the device alert setting stays visible above the advanced Telegram rows
      const triggers = document.querySelectorAll('[data-slot="collapsible-trigger"]');
      fireEvent.click(triggers[triggers.length - 1]!);
      expect(document.querySelectorAll('[data-slot="switch"]').length).toBeGreaterThan(0);
    } finally { restore(); }
  });

  test("unconfigured Telegram shows its setup helper under Telegram options", async () => {
    const { restore } = setup("owner", "/settings?section=notifications", "");
    try {
      await waitFor(() => expect(document.body.textContent).toContain("Telegram options"));
      expect(document.body.textContent).toContain("Set up Telegram first to use these.");
      expect(Array.from(document.querySelectorAll('[data-slot="collapsible-trigger"]')).find((trigger) => trigger.textContent?.includes("Telegram options"))).toBeTruthy();
    } finally { restore(); }
  });

  test("enrollment sounds is a plain row inside Face recognition", async () => {
    const { restore, getByText } = setup("owner", "/settings?section=profile");
    try {
      await waitFor(() => expect(getByText("Enrollment sounds")).toBeTruthy());
      const row = getByText("Enrollment sounds");
      const faceCard = row.closest('[data-slot="card"]');
      expect(faceCard?.textContent).toContain("Face recognition");
      expect(faceCard?.textContent).not.toContain("Appearance");
      expect(faceCard?.querySelectorAll('[data-slot="card"]')).toHaveLength(0);
    } finally { restore(); }
  });

  test("Voice and AI keeps only the voice setting", async () => {
    const { restore, getByRole } = setup("owner", "/settings?section=voice-ai");
    try {
      await waitFor(() => expect(getByRole("tab", { name: "Voice and AI" }).getAttribute("aria-selected")).toBe("true"));
      await waitFor(() => expect(document.querySelectorAll("[id^='settings-person.']").length).toBe(1));
      expect(document.querySelectorAll("[id^='settings-person.']")[0]?.textContent).toContain("tts.voice_id");
      expect(document.body.textContent).not.toContain("personality.style");
    } finally { restore(); }
  });

  test("Chat holds personality, safe search and photo uploads in one card for an adult", async () => {
    const { restore, getByRole } = setup("owner", "/settings?section=chat");
    try {
      await waitFor(() => expect(getByRole("tab", { name: "Chat" }).getAttribute("aria-selected")).toBe("true"));
      await waitFor(() => expect(document.querySelectorAll("[id^='settings-person.']").length).toBe(1));
      const card = document.querySelectorAll("[id^='settings-person.']")[0]!.textContent ?? "";
      for (const label of ["personality.style", "search.safe_search", "chat.photo_uploads"]) expect(card).toContain(label);
    } finally { restore(); }
  });

  test("a child's Chat section has no photo uploads switch (a parent's setting)", async () => {
    const { restore, getByRole } = setup("child", "/settings?section=chat");
    try {
      await waitFor(() => expect(getByRole("tab", { name: "Chat" }).getAttribute("aria-selected")).toBe("true"));
      await waitFor(() => expect(document.querySelectorAll("[id^='settings-person.']").length).toBe(1));
      const card = document.querySelectorAll("[id^='settings-person.']")[0]!.textContent ?? "";
      expect(card).toContain("search.safe_search");
      expect(card).not.toContain("chat.photo_uploads");
    } finally { restore(); }
  });

  test("SKILLS-PAGE-01: an adult has a Chat skills section; a child does not", async () => {
    const adult = setup("owner", "/settings?section=skills");
    try {
      await waitFor(() => expect(adult.getByRole("tab", { name: "Chat skills" }).getAttribute("aria-selected")).toBe("true"));
    } finally { adult.restore(); }
    cleanup();
    const kid = setup("child", "/settings?section=skills");
    try {
      await waitFor(() => expect(kid.getByRole("tab", { name: "Profile" }).getAttribute("aria-selected")).toBe("true"));
      expect(kid.queryByRole("tab", { name: "Chat skills" })).toBeNull();
    } finally { kid.restore(); }
  });

  test("profile form saves the person's name and Appearance keeps only reply stats", async () => {
    const { restore, patches, getByRole, findByRole } = setup("owner");
    try {
      const name = document.querySelector("input#profile-display-name") as HTMLInputElement;
      fireEvent.change(name, { target: { value: "Nova Two" } });
      fireEvent.click(getByRole("button", { name: "Save" }));
      await waitFor(() => expect(patches).toContainEqual({ displayName: "Nova Two" }));
      fireEvent.click(getByRole("tab", { name: "Appearance" }));
      const advanced = await findByRole("button", { name: /Advanced/ });
      fireEvent.click(advanced);
      await waitFor(() => expect(document.body.textContent).toContain("ui.show_turn_stats"));
      expect(document.body.textContent).not.toContain("Enrollment sounds");
    } finally { restore(); }
  });

  test("personal notification section exposes quiet-hours inheritance controls", async () => {
    const view = setup("adult", "/settings?section=notifications");
    try {
      await waitFor(() => expect(view.container.querySelector('input[aria-label="person.quiet_hours.from"]')).not.toBeNull());
      expect(view.container.querySelectorAll('input[aria-label^="person.quiet_hours."]')).toHaveLength(2);
    } finally { view.restore(); }
  });
});
