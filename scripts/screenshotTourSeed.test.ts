import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { seedToursDisabledForCapture, TOUR_AUTOSTART_SETTING } from "./screenshotTourSeed";

describe("screenshot tour seed", () => {
  test("the seeded capture household has autostart off for every person", () => {
    const db = new Database(":memory:");
    try {
      db.exec(`CREATE TABLE settings_values (
        scope TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        hlc TEXT NOT NULL,
        source TEXT NOT NULL,
        set_by TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (scope, key)
      )`);
      const people = ["sage-capture", "marlow-capture", "nova-capture"];
      seedToursDisabledForCapture(db, people);

      const rows = db.query("SELECT scope, value FROM settings_values WHERE key = ? ORDER BY scope").all(TOUR_AUTOSTART_SETTING) as Array<{ scope: string; value: string }>;
      expect(rows).toEqual(people.map((id) => ({ scope: `person:${id}`, value: "false" })).sort((a, b) => a.scope.localeCompare(b.scope)));
    } finally {
      db.close();
    }
  });
});
