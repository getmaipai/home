import { describe, expect, test } from "bun:test";
import { getRegistry } from "@/lib/settingsRegistry";
import { AUDIO_SPEED_KINDS } from "@/settings/audioKeys";
import { lintSettingCopy } from "@maipai/spec/interpreters/ts/describeSetting.js";
import { placeSetting } from "@/lib/settingsAreas";

// AUDIO-SESSION-01: one person speed setting per kind of audio.
describe("audio.speed.<kind> settings", () => {
  const keys = getRegistry().filter((key) => key.key.startsWith("audio.speed."));

  test("one person key per kind, default normal speed, a sane range", () => {
    expect(keys.map((k) => k.key).sort()).toEqual(AUDIO_SPEED_KINDS.map((kind) => `audio.speed.${kind}`).sort());
    for (const key of keys) {
      expect(key.scope).toBe("person");
      expect(key.selector).toBe("number");
      expect(key.default).toBe(1);
      expect(key.range).toEqual({ min: 0.5, max: 3 });
    }
  });

  test("the copy passes the copy lint and says what the setting does (rule S5)", () => {
    expect(lintSettingCopy(keys, [])).toEqual([]);
    for (const key of keys) expect(key.copy?.does?.length).toBeGreaterThan(10);
  });

  test("each key sits in a card of the person's own pages (Yours) (rule S4)", () => {
    for (const key of keys) {
      const place = placeSetting(key, { role: "adult", band: "adult", capabilities: new Set() });
      expect(place?.area).toBe("settings");
      // Rule S4: a person-scope key sits on one of "Yours" (the personal pages), never on a household page.
      expect(["profile", "appearance", "chat", "voice", "notifications", "pictures", "data"]).toContain(place?.section);
    }
  });
});
