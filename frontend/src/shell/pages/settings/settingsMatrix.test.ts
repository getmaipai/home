// APP-SET-02, architect conditions C-G3 and C-P2: which sections and keys each
// role and band sees in the Account, Chat and Home areas. Built from a
// snapshot of what each band saw on the old Settings page, so nobody gains a
// key: the old page's keys are listed here as literals (taken from the old Me
// and Household pages and their tests), not read from the code under test.
import { describe, expect, test } from "bun:test";
import {
  cardKeys,
  visibleCards,
  visibleGroups,
  type Role,
  type SettingsViewer,
} from "@maipai/ui/src/settings/settingsAudience";
import { settingsArea } from "@/shell/pages/settings/settingsAreas";
import { visibleRegistry } from "@/shell/pages/settings/settingsViewer";
import { REGISTRY } from "@/shell/pages/settings/settingsTestKit";

const ROLES: Role[] = ["owner", "admin", "adult", "teen", "child", "guest"];
const band = (role: Role) => (role === "child" ? "child" : role === "teen" ? "teen" : "adult");

/** The capabilities a role's page can learn (see useSettingsCapabilities):
 * adults and up learn wake word and robots, adult accounts learn of a child. */
function viewerFor(role: Role, home: { robots: boolean; robotsEnabled?: boolean; wakeword: boolean; child: boolean }): SettingsViewer {
  const adultOrUp = ["owner", "admin", "adult"].includes(role);
  const capabilities: string[] = [];
  if (adultOrUp && home.wakeword) capabilities.push("wakeword.assets");
  if (adultOrUp && home.robots) capabilities.push("robot.paired");
  if (adultOrUp && home.robotsEnabled === true) capabilities.push("robots.enabled");
  if (adultOrUp && home.child) capabilities.push("household.has_child");
  return { role, band: band(role), capabilities, selfId: `person-${role}` };
}

const FULL_HOME = { robots: true, robotsEnabled: true, wakeword: true, child: true };
const EMPTY_HOME = { robots: false, wakeword: false, child: false };

function sectionIds(areaId: string, viewer: SettingsViewer): string[] {
  const area = settingsArea(areaId)!;
  return visibleGroups(area, viewer, visibleRegistry(REGISTRY, viewer.band), "home").flatMap((g) => g.sections.map((s) => s.id));
}

/** Every registry key an area draws for this viewer. */
function keysOf(areaId: string, viewer: SettingsViewer): Set<string> {
  const area = settingsArea(areaId)!;
  const registry = visibleRegistry(REGISTRY, viewer.band);
  const keys = new Set<string>();
  for (const group of visibleGroups(area, viewer, registry, "home")) {
    for (const section of group.sections) {
      for (const card of visibleCards(section, viewer, registry, "home")) for (const def of cardKeys(card, registry, "home")) keys.add(def.key);
    }
  }
  return keys;
}

// What the old Settings page showed a child: personality, safe search, voice,
// the alert switch and muted senders, quiet hours, Telegram, the two
// appearance keys, reply stats (Appearance > Advanced) and enrollment sounds.
const TELEGRAM = ["approvals.requested", "backups.target_failing", "engines.problem", "engines.update_applied", "engines.update_available", "engines.update_failed", "file.shared_with_household", "file.shared_with_you", "memory.judge_failed", "memory.updated", "model.download_failed", "model.download_ready", "person.band_changed", "repairs.new", "updates.available"].map((id) => `notifications.${id}.telegram`);
const OLD_CHILD = new Set([
  "persona.active_id", "search.safe_search", "tts.voice_id", "notifications.browser.enabled", "notifications.file_shared.muted_senders",
  "person.quiet_hours.from", "person.quiet_hours.to", "notifications.telegram.chat_id", ...TELEGRAM,
  "ui.appearance", "ui.look", "ui.show_turn_stats", "ui.enrollment_sounds",
]);
// A teen saw the same, plus the chat photo switch (hidden from a child).
// EASE-OF-USE-01c: ease of use is comfort, not protection, so a child and a teen see the ease keys (one deliberate
// addition to the old snapshot; every other key stays exactly as it was).
const EASE_KEYS = REGISTRY.filter((k) => k.key.startsWith("ease.")).map((k) => k.key);
for (const key of EASE_KEYS) OLD_CHILD.add(key);
const OLD_TEEN = new Set([...OLD_CHILD, "chat.photo_uploads"]);

describe("which Settings pages and keys each role sees", () => {
  test.each(ROLES)("the column groups pages by audience for %s", (role) => {
    const personal = ["profile", "appearance", "chat", "voice", "notifications"];
    const expected = role === "owner" || role === "admin"
      ? [...personal, "pictures", "data", "household", "privacy", "ai", "media", "home-voice", "search", "offline-data", "apps", "backups", "advanced"]
      : [...personal, ...(role === "adult" ? ["pictures"] : []), "data"];
    expect(sectionIds("settings", viewerFor(role, EMPTY_HOME))).toEqual(expected);
    expect(sectionIds("settings", viewerFor(role, FULL_HOME))).toEqual(expected);
  });

  test("a fresh home's Apps page exposes only the Robots card; enabling it reveals the other robot cards", () => {
    const fresh = keysOf("settings", viewerFor("admin", EMPTY_HOME));
    expect([...fresh].filter((key) => key.startsWith("home.robots.")).sort()).toEqual(["home.robots.enabled"]);
    expect([...fresh].some((key) => key.startsWith("robot."))).toBe(false);
    const enabled = keysOf("settings", viewerFor("admin", FULL_HOME));
    expect([...enabled].some((key) => key.startsWith("robot."))).toBe(true);
  });

  test("a teen sees no Robot card and no household or expert card; a child neither", () => {
    for (const role of ["teen", "child"] as Role[]) {
      const viewer = viewerFor(role, FULL_HOME);
      expect(sectionIds("settings", viewer)).not.toContain("apps");
      expect(sectionIds("settings", viewer)).not.toContain("advanced");
      expect(sectionIds("settings", viewer)).not.toContain("household");
      const all = [...keysOf("settings", viewer)];
      const byKey = new Map(REGISTRY.map((k) => [k.key, k]));
      for (const key of all) {
        expect(byKey.get(key)?.scope).toBe("person");
        expect(byKey.get(key)?.level).not.toBe("expert");
      expect(byKey.get(key)?.lives_in).not.toBe("robot.settings");
      }
    }
  });
});

describe("nobody gains a key (a snapshot of what each band saw before)", () => {
  test("a child sees no key the old page did not show a child", () => {
    const viewer = viewerFor("child", FULL_HOME);
    const seen = [...keysOf("settings", viewer)];
    expect(seen.filter((key) => !OLD_CHILD.has(key))).toEqual([]);
    // and keeps what matters: personality, safe search, voice, alerts
    for (const key of ["persona.active_id", "search.safe_search", "tts.voice_id", "notifications.browser.enabled", "ui.appearance"]) expect(seen).toContain(key);
  });

  test("a teen sees no key the old page did not show a teen, and a teen keeps the chat photo switch", () => {
    const viewer = viewerFor("teen", FULL_HOME);
    const seen = [...keysOf("settings", viewer)];
    expect(seen.filter((key) => !OLD_TEEN.has(key))).toEqual([]);
    expect(seen).toContain("chat.photo_uploads");
  });

  test("a child never sees the chat photo switch, which is a parent's to set", () => {
    expect([...keysOf("settings", viewerFor("child", FULL_HOME))]).not.toContain("chat.photo_uploads");
  });

  test("no band but an admin sees a household key", () => {
    const byKey = new Map(REGISTRY.map((k) => [k.key, k]));
    for (const role of ROLES) {
      const viewer = viewerFor(role, FULL_HOME);
      const household = [...keysOf("settings", viewer)].filter((key) => byKey.get(key)?.scope === "household");
      expect(household.length > 0).toBe(role === "owner" || role === "admin");
    }
  });

  test("Account and Chat settings never draw a key at a person scope other than the viewer's own: no area card names a person id", () => {
    for (const section of settingsArea("settings")!.sections) {
      for (const card of section.cards ?? []) expect(["household", "person", "device", undefined]).toContain(card.scope);
      expect(JSON.stringify(section)).not.toMatch(/person:|:id\b|\{person\}/);
    }
  });
});
