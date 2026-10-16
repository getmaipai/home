import { describe, expect, test } from "bun:test";
import { checklistFromFacts, SETUP_CHECKLIST_ITEMS } from "@/lib/setupChecklist";

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
});
