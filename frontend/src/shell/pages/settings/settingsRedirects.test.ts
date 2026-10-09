// APP-SET-02: every old settings URL lands on its new page (design section 5).
// One test per row of the redirect table.
import { describe, expect, test } from "bun:test";
import type { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";
import { customizeTarget, legacySettingsTarget, retiredManagePageTarget } from "@/shell/pages/settings/settingsRedirects";

const admin = { canManageHousehold: true };
const member = { canManageHousehold: false };
const key = (k: string, lives_in: string, scope: SettingsKey["scope"] = "person", level: SettingsKey["level"] = "basic") => ({ key: k, lives_in, scope, level }) as SettingsKey;
const registry = [
  key("search.safe_search", "person.search"),
  key("search.searxng_url", "household.search", "household"),
  key("chat.teen_gate_grain", "household.ai", "household"),
  key("notifications.browser.enabled", "person.notifications"),
  key("ui.show_turn_stats", "person.chat", "person", "advanced"),
];

describe("legacySettingsTarget", () => {
  test("/settings with no query goes to Account", () => {
    expect(legacySettingsTarget("", "", member, registry)).toBe("/settings/account");
    expect(legacySettingsTarget("", "", admin, registry)).toBe("/settings/account");
  });
  test("?tab=me goes to Account", () => expect(legacySettingsTarget("?tab=me", "", member, registry)).toBe("/settings/account"));
  test.each([
    ["profile", "/settings/account/profile"],
    ["appearance", "/settings/account/appearance"],
    ["chat", "/settings/chat/general"],
    ["skills", "/settings/chat/skills"],
    ["voice-ai", "/settings/account/voice"],
    ["notifications", "/settings/account/notifications"],
    ["privacy-data", "/settings/account/data"],
  ])("?tab=me&section=%s goes to %s", (section, to) => {
    expect(legacySettingsTarget(`?tab=me&section=${section}`, "", member, registry)).toBe(to);
  });
  test("?tab=household as an admin goes to Home settings General", () => {
    expect(legacySettingsTarget("?tab=household", "", admin, registry)).toBe("/settings/home/general");
  });
  test.each(["general", "people", "ai", "integrations", "storage", "maintenance"])("?tab=household&section=%s as an admin goes to Home settings %s", (section) => {
    expect(legacySettingsTarget(`?tab=household&section=${section}`, "", admin, registry)).toBe(`/settings/home/${section}`);
  });
  test("?tab=household as a non-admin goes to Account, with no household section named", () => {
    expect(legacySettingsTarget("?tab=household", "", member, registry)).toBe("/settings/account");
    expect(legacySettingsTarget("?tab=household&section=ai", "", member, registry)).toBe("/settings/account");
  });
  test("?tab=device goes to This device", () => expect(legacySettingsTarget("?tab=device", "", member, registry)).toBe("/settings/account/device"));
  test("an old search link (?section=<lives_in>) lands on the area and section that hold the group, at its first key", () => {
    expect(legacySettingsTarget("?tab=household&section=household.ai", "", admin, registry)).toBe("/settings/home/ai#chat.teen_gate_grain");
    expect(legacySettingsTarget("?tab=household&section=household.search", "", admin, registry)).toBe("/settings/home/search#search.searxng_url");
    expect(legacySettingsTarget("?tab=me&section=person.search", "", member, registry)).toBe("/settings/chat/general#search.safe_search");
    expect(legacySettingsTarget("?tab=me&section=person.notifications", "", member, registry)).toBe("/settings/account/notifications#notifications.browser.enabled");
  });
  test("an old household search link for a non-admin never names a Home settings page", () => {
    expect(legacySettingsTarget("?tab=household&section=household.ai", "", member, registry)).toBe("/settings/account");
  });
  test("a group no card draws lands on the area's start, not on an error", () => {
    expect(legacySettingsTarget("?tab=me&section=person.nothing", "", member, registry)).toBe("/settings/account");
  });
  test("a hash is kept", () => {
    expect(legacySettingsTarget("?tab=me&section=chat", "#chat.photo_uploads", member, registry)).toBe("/settings/chat/general#chat.photo_uploads");
  });
  test("an unknown section falls back to the tab's start", () => {
    expect(legacySettingsTarget("?tab=household&section=not-a-section", "", admin, registry)).toBe("/settings/home/general");
    expect(legacySettingsTarget("?tab=me&section=not-a-section", "", member, registry)).toBe("/settings/account");
  });
});

// ENGINES-AI-01: the Manage pages that moved into Home settings keep working as links.
describe("retiredManagePageTarget", () => {
  test.each([
    ["/engines", "/settings/home/ai"],
    ["/models", "/settings/home/ai"],
    ["/voices", "/settings/home/voices"],
    ["/engines/", "/settings/home/ai"],
  ])("%s lands on %s for someone who manages the household", (from, to) => {
    expect(retiredManagePageTarget(from, admin)).toBe(to);
  });
  test("a viewer who may not manage the household lands on Account (their voice, for /voices)", () => {
    expect(retiredManagePageTarget("/engines", member)).toBe("/settings/account");
    expect(retiredManagePageTarget("/models", member)).toBe("/settings/account");
    expect(retiredManagePageTarget("/voices", member)).toBe("/settings/account/voice");
  });
  test("a page that has not moved is not redirected", () => {
    expect(retiredManagePageTarget("/users", admin)).toBeUndefined();
    expect(retiredManagePageTarget("/backups", admin)).toBeUndefined();
  });
});

describe("customizeTarget", () => {
  test("/customize lands on Skills for an adult and a teen", () => {
    expect(customizeTarget("adult")).toBe("/settings/chat/skills");
    expect(customizeTarget("teen")).toBe("/settings/chat/skills");
  });
  test("/customize lands on Chat settings for a child, who has no Skills", () => {
    expect(customizeTarget("child")).toBe("/settings/chat");
  });
});
