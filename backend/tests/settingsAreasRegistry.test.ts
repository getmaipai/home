// APP-SET-01: Home's key declarations and the spec's settings areas agree.
// keys.json is generated from Home's declarations, so a `lives_in` here that
// the pinned spec does not carry would be reverted by the next gen:settings.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getRegistry } from "@/lib/settingsRegistry";
import { getSettingsAreas } from "@/lib/settingsAreas";
import { SPEC_DIR } from "@/lib/specDir";

describe("settings registry and the spec's areas", () => {
  test("every key's group is the one the pinned spec's keys.json carries", () => {
    const spec = JSON.parse(readFileSync(join(SPEC_DIR, "settings", "keys.json"), "utf-8")) as { key: string; scope: string; lives_in: string }[];
    const home = new Map(getRegistry().map((k) => [`${k.scope}:${k.key}`, k.lives_in]));
    for (const entry of spec) {
      if (entry.key === "voice.wakeword.enabled") continue; // hidden until its assets are installed
      expect(home.get(`${entry.scope}:${entry.key}`)).toBe(entry.lives_in);
    }
  });

  test("every basic or advanced key Home serves sits in exactly one card of one area, or is declared not placed", () => {
    const { areas, not_placed } = getSettingsAreas();
    const notPlaced = new Set(not_placed.map((n) => `${n.scope}:${n.group}`));
    const cards = new Map<string, number>();
    for (const area of areas) for (const s of area.sections as { cards?: { group?: string; scope?: string; levels?: string[] }[] }[]) {
      for (const c of s.cards ?? []) if (c.group && !c.levels) cards.set(`${c.scope}:${c.group}`, (cards.get(`${c.scope}:${c.group}`) ?? 0) + 1);
    }
    for (const key of getRegistry()) {
      if (key.level === "expert" || !key.honoured_by.includes("home")) continue;
      const id = `${key.scope}:${key.lives_in}`;
      if (notPlaced.has(id)) continue;
      expect({ id, cards: cards.get(id) ?? 0 }).toEqual({ id, cards: 1 });
    }
  });
});
