import { describe, expect, test } from "bun:test";
import type { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";
import legacyMap from "@maipai/spec/settings/legacy-sections.json";
import { customizeTarget, legacySettingsSectionTarget, legacySettingsTarget, retiredManagePageTarget } from "@/shell/pages/settings/settingsRedirects";
import { settingsPath } from "@/shell/pages/settings/settingsAreas";

const admin = { canManageHousehold: true };
const member = { canManageHousehold: false };
const key = (k: string, lives_in: string, scope: SettingsKey["scope"] = "person", level: SettingsKey["level"] = "basic") => ({ key: k, lives_in, scope, level }) as SettingsKey;
const registry = [
  key("search.safe_search", "person.search"),
  key("search.searxng_url", "household.search", "household"),
  key("chat.teen_gate_grain", "household.ai_advanced", "household"),
  key("notifications.browser.enabled", "person.notifications"),
];

describe("legacy route map", () => {
  test.each(legacyMap.mappings.map((entry) => [entry.old.area, entry.old.section, "new" in entry && entry.new ? settingsPath(entry.new.section, entry.new.tab) : settingsPath(entry.replacement!.section)] as const))("/%s/%s maps to its pinned destination", (area, section, expected) => {
    expect(legacySettingsSectionTarget(area, section, admin)).toBe(expected);
  });
  test.each([
    ["home", "/settings/household"],
    ["account", "/settings/profile"],
    ["chat", "/settings/chat"],
  ])("/settings/%s base route redirects to %s", (area, expected) => {
    expect(area === "home" ? settingsPath("household") : area === "account" ? settingsPath("profile") : settingsPath("chat")).toBe(expected);
  });
  test("old robot query and path forms preserve the detail identity", () => {
    const query = new URLSearchParams("device=robot-1&tab=access&addRobot=1");
    expect(`/settings/apps/${query.get("device")}?tab=${query.get("tab")}&addRobot=1`).toBe("/settings/apps/robot-1?tab=access&addRobot=1");
    expect("/settings/apps/robot-1?tab=overview").toBe("/settings/apps/robot-1?tab=overview");
  });
});

describe("legacy settings search links", () => {
  test("no query and ?tab=me open the first personal page", () => {
    expect(legacySettingsTarget("", "", member, registry)).toBe("/settings/profile?tab=profile");
    expect(legacySettingsTarget("?tab=me", "", member, registry)).toBe("/settings/profile?tab=profile");
  });
  test.each([
    ["?tab=me&section=profile", "/settings/profile?tab=profile"],
    ["?tab=me&section=appearance", "/settings/appearance?tab=appearance"],
    ["?tab=me&section=chat", "/settings/chat"],
    ["?tab=household&section=ai", "/settings/ai?tab=overview"],
    ["?tab=household&section=household.ai", "/settings/ai?tab=advanced#chat.teen_gate_grain"],
    ["?tab=household&section=household.search", "/settings/search?tab=search#search.searxng_url"],
    ["?tab=me&section=person.search", "/settings/chat?tab=general#search.safe_search"],
    ["?tab=device", "/settings/voice?tab=device"],
  ])("%s redirects to %s", (search, expected) => {
    expect(legacySettingsTarget(search, "", admin, registry)).toBe(expected);
  });
  test("household search links remain on their page so non-admins see the access explanation", () => {
    expect(legacySettingsTarget("?tab=household&section=household.ai", "", member, registry)).toBe("/settings/ai?tab=advanced#chat.teen_gate_grain");
  });
  test("hash deep links survive the legacy chat section", () => {
    expect(legacySettingsTarget("?tab=me&section=chat", "#chat.photo_uploads", member, registry)).toBe("/settings/chat#chat.photo_uploads");
  });
});

describe("other moved routes", () => {
  test.each([
    ["/engines", "/settings/ai?tab=overview"], ["/models", "/settings/ai?tab=overview"], ["/voices", "/settings/home-voice?tab=voices"],
  ])("%s points to the household page", (path, expected) => expect(retiredManagePageTarget(path, admin)).toBe(expected));
  test("voice remains personal to a non-admin and devices reaches profile", () => {
    expect(retiredManagePageTarget("/voices", member)).toBe("/settings/voice?tab=voice");
    expect(retiredManagePageTarget("/devices", member)).toBe("/settings/profile?tab=profile");
  });
  test("customize keeps the audience gate", () => {
    expect(customizeTarget("adult")).toBe("/settings/chat?tab=skills");
    expect(customizeTarget("child")).toBe("/settings/chat");
  });
});
