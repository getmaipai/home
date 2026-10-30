import { describe, expect, test } from "bun:test";
import { getRegistry } from "@/lib/settingsRegistry";
import { CHILD_VISIBLE_SETTING_KEYS, TEEN_VISIBLE_SETTING_KEYS } from "@/lib/settingsMinorSnapshot";
import { getSettingsAreas, placeSetting } from "@/lib/settingsAreas";
import { beforeEach } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { listValues, setValue } from "@/lib/settings";
import { resetDb } from "../../tests/reset-db";
import { TestClient } from "../../tests/client";

beforeEach(() => resetDb());

const keys = [
  { key: "alarms.sound", selector: "select", default: "bell", options: ["none", "bell", "chime", "digital", "rise", "gentle"] },
  { key: "alarms.volume", selector: "select", default: "medium", options: ["low", "medium", "high"] },
  { key: "alarms.snooze_minutes", selector: "select", default: "10", options: ["5", "10", "15", "30", "60"] },
] as const;

describe("alarm settings declarations", () => {
  test("the registry exposes the person choices and defaults", () => {
    for (const expected of keys) {
      const entry = getRegistry().find((key) => key.key === expected.key);
      expect(entry).toMatchObject({ key: expected.key, scope: "person", selector: expected.selector, default: expected.default, level: "basic", lives_in: "person.clock", honoured_by: ["home"] });
      expect(entry?.range?.options).toEqual([...expected.options]);
    }
  });

  test("children and teens see the keys and Clock area lists them", () => {
    for (const { key } of keys) {
      expect(CHILD_VISIBLE_SETTING_KEYS).toContain(key);
      expect(TEEN_VISIBLE_SETTING_KEYS).toContain(key);
    }
    const area = getSettingsAreas().areas.find((item) => item.id === "clock");
    expect(area?.title).toBe("Clock");
    expect(area?.sections.flatMap((section) => section.cards?.flatMap((card) => card.group === "person.clock" ? keys.map((item) => item.key) : []) ?? [])).toEqual(keys.map((item) => item.key));
    const entry = getRegistry().find((key) => key.key === "alarms.sound")!;
    expect(placeSetting(entry, { role: "child", band: "child", capabilities: new Set() })).toMatchObject({ area: "clock" });
  });

  test("a child and teen can change only their own values, and an invalid choice is refused", async () => {
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    for (const [name, role] of [["Nova", "child"], ["Marlow", "teen"], ["Adult", "adult"]]) await client.post("/api/people", { displayName: name, role, ...(role === "adult" ? { secret: "1234" } : {}) });
    const child = db.select().from(people).where(eq(people.displayName, "Nova")).get()!;
    const teen = db.select().from(people).where(eq(people.displayName, "Marlow")).get()!;
    const adult = db.select().from(people).where(eq(people.displayName, "Adult")).get()!;
    for (const person of [child, teen]) {
      expect(setValue(person, `person:${person.id}`, "alarms.sound", "chime").ok).toBe(true);
      const ownValues = listValues(person, `person:${person.id}`);
      expect(ownValues.ok && ownValues.value.find((value) => value.key === "alarms.sound")?.value).toBe("chime");
    }
    const adultsForChild = listValues(child, `person:${adult.id}`);
    expect(adultsForChild.ok).toBe(false);
    expect(setValue(child, `person:${adult.id}`, "alarms.sound", "none").ok).toBe(false);
    expect(setValue(adult, `person:${adult.id}`, "alarms.sound", "megaphone").ok).toBe(false);
  });
});
