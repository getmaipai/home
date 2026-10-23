import { describe, expect, test } from "bun:test";
import { checklistFromFacts, SETUP_CHECKLIST_ITEMS } from "@/lib/setupChecklist";
import { getSettingsAreas } from "@/lib/settingsAreas";

describe("setup checklist facts", () => {
  test("keeps the existing facts and adds the new facts", () => {
    const items = checklistFromFacts({
      "face-sign-in": false,
      family: true,
      "backup-target": false,
      "phone-or-tablet": true,
      "web-search": true,
      apps: false,
      "away-access": true,
      "backup-key": true,
      voice: false,
      photos: true,
      "remote-engine": false,
    });
    expect(items.map(({ id, done }) => [id, done])).toEqual([
      ["face-sign-in", false],
      ["family", true],
      ["backup-target", false],
      ["phone-or-tablet", true],
      ["web-search", true],
      ["apps", false],
      ["away-access", true],
      ["backup-key", true],
      ["voice", false],
      ["photos", true],
      ["remote-engine", false],
    ]);
    expect(SETUP_CHECKLIST_ITEMS).toHaveLength(11);
  });

  test("omits items the signed-in owner or admin hid", () => {
    const items = checklistFromFacts({
      "face-sign-in": false,
      family: false,
      "backup-target": false,
      "phone-or-tablet": false,
      "web-search": false,
      apps: false,
      "away-access": false,
      "backup-key": false,
      voice: false,
      photos: false,
      "remote-engine": false,
    }, new Set(["voice"]));
    expect(items.map((item) => item.id)).not.toContain("voice");
  });

  test("every setup checklist link names a real Settings page and tab", () => {
    const settings = getSettingsAreas().areas.find((area) => area.id === "settings");
    expect(settings).toBeTruthy();
    const pages = new Map(settings!.sections.map((section) => [section.id, section]));
    for (const item of SETUP_CHECKLIST_ITEMS) {
      const url = new URL(item.open.href, "http://home");
      const pageId = url.pathname.split("/")[2];
      expect(pages.has(pageId!), `${item.id} links to missing Settings page ${pageId}`).toBe(true);
      const tab = url.searchParams.get("tab");
      if (tab) expect(pages.get(pageId!)!.tabs?.some((entry) => entry.id === tab), `${item.id} links to missing Settings tab ${tab}`).toBe(true);
    }
  });
});
