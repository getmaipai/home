import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import { NextMeSettings } from "@/next/pages/settings/NextMeSettings";
import { renderWithQueryClient } from "../../../../tests/renderWithQueryClient";
import type { Roster, ResolvedSetting } from "@/lib/api";
import type { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

afterEach(cleanup);

const beforeGroupIds = ["profile.appearance", "person.allowance", "person.notifications", "person.persona", "person.search", "person.voice", "person.storage"];

function makePerson(role: Roster["role"] = "child"): Roster {
  return { id: "person-abc123", display_name: "Nova", nickname: null, role, avatar_seed: "person-abc123", source: "hub", local_only: false, created_at: "2026-09-04T00:00:00.000Z", updated_at: "2026-09-04T00:00:00.000Z", deleted_at: null, enabled: true, guest_expires_at: null, memorialized_at: null, hlc: "1788000000000:0:test", hasSecret: true } as Roster;
}

function makeKey(key: string, lives_in: string, selector: string = "text", level: string = "basic"): SettingsKey {
  return { key, scope: "person", selector, label: key, level, secret: false, lives_in, honoured_by: ["home"], ...(selector === "boolean" ? { default: true } : {}) } as SettingsKey;
}

function setup(role: Roster["role"], initialUrl = "/settings") {
  const registry: SettingsKey[] = [
    makeKey("ui.appearance", "profile.appearance", "select"), makeKey("ui.look", "profile.appearance", "select"),
    makeKey("ui.enrollment_sounds", "profile.appearance", "boolean", "advanced"), makeKey("ui.show_turn_stats", "profile.appearance", "boolean", "advanced"),
    ...Array.from({ length: 9 }, (_, i) => makeKey(`allowance.${i}.daily_minutes`, "person.allowance", "number")),
    makeKey("notifications.telegram.chat_id", "person.notifications"),
    ...["approvals.requested", "backups.target_failing", "engines.problem", "engines.update_applied", "engines.update_available", "engines.update_failed", "file.shared_with_household", "file.shared_with_you", "memory.judge_failed", "memory.updated", "model.download_failed", "model.download_ready", "person.band_changed", "repairs.new", "updates.available"].map((name) => makeKey(`notifications.${name}.telegram`, "person.notifications", "boolean")),
    makeKey("personality.style", "person.persona"), makeKey("search.safe_search", "person.search", "boolean"), makeKey("tts.voice_id", "person.voice", "select"),
    makeKey("storage.cap", "person.storage", "number"), makeKey("storage.cap_warning", "person.storage", "number"),
  ];
  const values: ResolvedSetting[] = registry.map((key) => ({ key: key.key, value: key.key === "notifications.telegram.chat_id" ? "chat-123" : key.default ?? "sample", source: "default", label: key.label, help: key.help, level: key.level, secret: key.secret }));
  const originalFetch = globalThis.fetch;
  const patches: unknown[] = [];
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith(`/api/people/${makePerson(role).id}`) && init?.method === "PATCH") { const body = JSON.parse(String(init.body)); patches.push(body); return Promise.resolve(Response.json({ ...makePerson(role), display_name: body.displayName ?? "Nova" })); }
    if (url.includes("/api/biometric-prints")) return Promise.resolve(Response.json([]));
    if (url.includes("/api/settings/registry")) return Promise.resolve(Response.json(registry));
    if (url.includes("/api/settings?scope=")) return Promise.resolve(Response.json(values));
    return Promise.resolve(Response.json([]));
  }) as unknown as typeof fetch;
  function Location() { const [params] = useSearchParams(); return <output data-testid="section-param">{params.get("section") ?? ""}</output>; }
  const view = renderWithQueryClient(<MemoryRouter initialEntries={[initialUrl]}><NextMeSettings person={makePerson(role)} /><Location /></MemoryRouter>);
  return { ...view, patches, restore: () => { globalThis.fetch = originalFetch; } };
}

describe("NextMeSettings", () => {
  test("a non-admin sees the five personal sections without limits or admin settings", async () => {
    const { restore } = setup("child");
    try {
      await waitFor(() => expect(document.querySelector("input#profile-display-name")).not.toBeNull());
      expect((document.querySelector("input#profile-display-name") as HTMLInputElement).value).toBe("Nova");
      expect(document.body.textContent).toContain("Face recognition");
      for (const name of ["Profile", "Appearance", "Voice and AI", "Notifications", "Privacy and data"]) expect(document.body.textContent).toContain(name);
      expect(document.body.textContent).not.toContain("Limits");
      expect(document.body.textContent).not.toContain("Allowance");
      expect(document.body.textContent).not.toContain("My storage");
    } finally { restore(); }
  });

  test("admins see Limits and every former group remains rendered", async () => {
    const { restore } = setup("admin");
    try {
      await waitFor(() => expect(document.body.textContent).toContain("Limits"));
      fireEvent.click(Array.from(document.querySelectorAll("[role=tab]")).find((tab) => tab.textContent === "Limits")!);
      await waitFor(() => expect(document.body.textContent).toContain("Allowance"));
      expect(document.body.textContent).toContain("My storage");
      for (const id of ["person.allowance", "person.storage"]) expect(document.getElementById(`settings-${id}`)).not.toBeNull();
      const sectionForGroup: Record<string, string> = {
        "profile.appearance": "Appearance", "person.persona": "Voice and AI", "person.search": "Voice and AI",
        "person.voice": "Voice and AI", "person.notifications": "Notifications", "person.allowance": "Limits", "person.storage": "Limits",
      };
      for (const id of beforeGroupIds) {
        const title = sectionForGroup[id]!;
        fireEvent.click(Array.from(document.querySelectorAll("[role=tab]")).find((tab) => tab.textContent === title)!);
        if (title === "Notifications") {
          const disclosure = await waitFor(() => Array.from(document.querySelectorAll('[data-slot="collapsible-trigger"]')).find((trigger) => trigger.textContent?.includes("Advanced")) as HTMLElement);
          fireEvent.click(disclosure);
        }
        await waitFor(() => expect(document.getElementById(`settings-${id}`)).not.toBeNull());
      }
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
      await waitFor(() => expect(document.body.textContent).toContain("Advanced"));
      expect(document.querySelector('[data-slot="switch"]')).toBeNull();
      const triggers = document.querySelectorAll('[data-slot="collapsible-trigger"]');
      fireEvent.click(triggers[triggers.length - 1]!);
      expect(document.querySelectorAll('[data-slot="switch"]').length).toBeGreaterThan(0);
    } finally { restore(); }
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
});
