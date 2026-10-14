import type { Database } from "bun:sqlite";

export const TOUR_AUTOSTART_SETTING = "tours.autostart.enabled";

/** Keep guided tours out of every browser capture made with the demo people. */
export function seedToursDisabledForCapture(db: Database, personIds: string[]): void {
  const statement = db.query(`
    INSERT INTO settings_values (scope, key, value, hlc, source, set_by, updated_at)
    VALUES (?, ?, 'false', ?, 'user', NULL, ?)
    ON CONFLICT(scope, key) DO UPDATE SET
      value = excluded.value,
      hlc = excluded.hlc,
      source = excluded.source,
      set_by = excluded.set_by,
      updated_at = excluded.updated_at
  `);
  const now = new Date().toISOString();
  for (const [index, personId] of personIds.entries()) {
    statement.run(`person:${personId}`, TOUR_AUTOSTART_SETTING, `${Date.now()}:${index}:screenshot-tour-seed`, now);
  }
}
