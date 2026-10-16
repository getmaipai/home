import { describe, expect, test } from "bun:test";
import { checklistFromFacts, SETUP_CHECKLIST_ITEMS } from "@/lib/setupChecklist";

describe("setup checklist facts", () => {
  test("shows the six requested facts and their current completion", () => {
    const items = checklistFromFacts({
      "backup-key": true,
      voice: false,
      photos: true,
      people: false,
      "web-search": true,
      "remote-engine": false,
    });
    expect(items.map(({ id, done }) => [id, done])).toEqual([
      ["backup-key", true],
      ["voice", false],
      ["photos", true],
      ["people", false],
      ["web-search", true],
      ["remote-engine", false],
    ]);
    expect(SETUP_CHECKLIST_ITEMS).toHaveLength(6);
  });

  test("omits items the signed-in owner or admin hid", () => {
    const items = checklistFromFacts({
      "backup-key": false,
      voice: false,
      photos: false,
      people: false,
      "web-search": false,
      "remote-engine": false,
    }, new Set(["voice"]));
    expect(items.map((item) => item.id)).not.toContain("voice");
  });
});
