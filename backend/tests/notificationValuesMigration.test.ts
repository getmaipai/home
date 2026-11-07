import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";

// I18N-B1: 0181 adds the typed values to deliveries and holds. Additive: rows written before it keep their English text and read back null.
const migration = readFileSync(new URL("../src/db/migrations/0181_notification_values.sql", import.meta.url), "utf8");

test("the migration keeps old rows readable and new rows round-trip their values", () => {
  const fixture = new Database(":memory:");
  try {
    fixture.exec("CREATE TABLE notification_deliveries (id text PRIMARY KEY, type_id text NOT NULL, text text NOT NULL); CREATE TABLE notification_holds (id text PRIMARY KEY, type_id text NOT NULL, text text NOT NULL, options text NOT NULL);");
    fixture.query("INSERT INTO notification_deliveries VALUES (?, ?, ?)").run("old", "model.download_ready", "Qwen finished downloading and is ready to use.");
    fixture.query("INSERT INTO notification_holds VALUES (?, ?, ?, ?)").run("oldhold", "alarm.due", "Alarm: gym", "{}");
    fixture.exec(migration.replaceAll("--> statement-breakpoint", ""));
    expect(fixture.query("SELECT text, values_json FROM notification_deliveries WHERE id = 'old'").get()).toEqual({ text: "Qwen finished downloading and is ready to use.", values_json: null });
    expect(fixture.query("SELECT values_json FROM notification_holds WHERE id = 'oldhold'").get()).toEqual({ values_json: null });
    fixture.query("INSERT INTO notification_deliveries (id, type_id, text, values_json) VALUES (?, ?, ?, ?)").run("new", "alarm.due", "Alarm: gym", JSON.stringify({ task: "gym" }));
    expect(JSON.parse((fixture.query("SELECT values_json AS v FROM notification_deliveries WHERE id = 'new'").get() as { v: string }).v)).toEqual({ task: "gym" });
  } finally { fixture.close(); }
});
