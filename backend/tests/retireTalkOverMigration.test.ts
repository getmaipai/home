import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../src/db/migrations/0203_retire_talk_over.sql", import.meta.url), "utf8");

test("retiring Talk before I finish deletes its stored settings only", () => {
  const fixture = new Database(":memory:");
  try {
    fixture.exec("CREATE TABLE settings_values (scope text NOT NULL, key text NOT NULL, value text NOT NULL, PRIMARY KEY(scope,key));");
    const insert = fixture.query("INSERT INTO settings_values VALUES (?, ?, ?)");
    insert.run("household", "voice.talk_over", '"gentle"');
    insert.run("household", "voice.talk_over_window_ms", "800");
    insert.run("household", "voice.hesitations", '"light"');
    fixture.exec(migration.replaceAll("--> statement-breakpoint", ""));
    expect(fixture.query("SELECT key, value FROM settings_values ORDER BY key").all()).toEqual([{ key: "voice.hesitations", value: '"light"' }]);
  } finally { fixture.close(); }
});
