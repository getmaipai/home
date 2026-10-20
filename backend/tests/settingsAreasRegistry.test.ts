// APP-SET-01: Home's key declarations and the spec's settings areas agree.
// keys.json is generated from Home's declarations, so a `lives_in` here that
// the pinned spec does not carry would be reverted by the next gen:settings.
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getRegistry } from "@/lib/settingsRegistry";
import { getSettingsAreas } from "@/lib/settingsAreas";
import { SPEC_DIR } from "@/lib/specDir";

describe("settings registry and the spec's areas", () => {
  test("the emergency key completion fact is household-scoped and contains no key material", () => {
    const key = getRegistry().find((entry) => entry.key === "backups.emergency_kit_saved_at");
    expect(key).toMatchObject({ scope: "household", selector: "text", default: null, secret: false });
    expect(key?.help).toContain("key itself is never stored");
  });

  test("every key's group is the one the pinned spec's keys.json carries", () => {
    const spec = JSON.parse(readFileSync(join(SPEC_DIR, "settings", "keys.json"), "utf-8")) as { key: string; scope: string; lives_in: string }[];
    const home = new Map(getRegistry().map((k) => [`${k.scope}:${k.key}`, k.lives_in]));
    for (const entry of spec) {
      if (entry.key === "voice.wakeword.enabled") continue; // hidden until its assets are installed
      if (entry.key === "search.wikipedia_fallback") continue; // retired, still listed in spec-v0.1.116 until the next spec tag
      expect(home.get(`${entry.scope}:${entry.key}`)).toBe(entry.lives_in);
    }
  });

  test("every basic or advanced key Home serves sits in exactly one card of one area, or is declared not placed", () => {
    const { areas, not_placed } = getSettingsAreas();
    const notPlaced = new Set(not_placed.map((n) => `${n.scope}:${n.group}`));
    const cards = new Map<string, number>();
    // WEATHER-APP-01: a bundled package declares its own settings area (contributes.settings_area); its cards place keys too.
    type Card = { group?: string; scope?: string; levels?: string[] };
    const packageAreas = readdirSync(join(import.meta.dir, "../packages"), { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(import.meta.dir, "../packages", d.name, "manifest.json")))
      .flatMap((d) => {
        const manifest = JSON.parse(readFileSync(join(import.meta.dir, "../packages", d.name, "manifest.json"), "utf-8")) as { contributes?: { settings_area?: { sections?: { cards?: Card[] }[] } } };
        return manifest.contributes?.settings_area ? [manifest.contributes.settings_area] : [];
      });
    for (const area of [...areas, ...packageAreas]) for (const s of area.sections as { cards?: Card[] }[]) {
      for (const c of s.cards ?? []) if (c.group) {
        const levels = c.levels ?? ["*"];
        for (const level of levels) {
          const id = `${c.scope}:${c.group}:${level}`;
          cards.set(id, (cards.get(id) ?? 0) + 1);
        }
      }
    }
    // SPEC-ROBOT-TEST-01: a device's own card (areas.json device_cards) places its group on that device's page.
    for (const c of (getSettingsAreas() as { device_cards?: Card[] }).device_cards ?? []) if (c.group) {
      const id = `${c.scope}:${c.group}:*`;
      cards.set(id, (cards.get(id) ?? 0) + 1);
    }
    for (const key of getRegistry()) {
      // Location keys are drawn by the kit's LocationField, not counted as cards here.
      if (key.level === "expert" || key.selector === "location" || !key.honoured_by.includes("home")) continue;
      const id = `${key.scope}:${key.lives_in}`;
      if (notPlaced.has(id)) continue;
      expect({ id, cards: cards.get(`${id}:${key.level}`) ?? cards.get(`${id}:*`) ?? 0 }).toEqual({ id, cards: 1 });
    }
  });
});
