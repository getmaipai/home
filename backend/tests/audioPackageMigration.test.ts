import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sql = readFileSync(join(import.meta.dir, "../src/db/migrations/0192_audio_package_id.sql"), "utf8")
  .replace(/--> statement-breakpoint/g, "");

describe("0192_audio_package_id", () => {
  test("renames package references, preserves other values, and keeps existing audio package_status", () => {
    const db = new Database(":memory:");
    try {
      db.exec(`
        CREATE TABLE package_status (package_id TEXT PRIMARY KEY, status TEXT, last_smoke_at TEXT);
        CREATE TABLE package_installs (package_id TEXT PRIMARY KEY, version TEXT);
        CREATE TABLE feeds (id TEXT PRIMARY KEY, package_id TEXT, url TEXT);
        CREATE TABLE scheduled_jobs (id TEXT PRIMARY KEY, package_id TEXT, job TEXT);
        CREATE TABLE routing_embeddings (package_id TEXT, example_hash TEXT, space TEXT, example TEXT, dims INTEGER, vector BLOB, hlc TEXT, PRIMARY KEY(package_id, example_hash, space));
        CREATE TABLE conversation_turns (id TEXT PRIMARY KEY, plugin_id TEXT, user_text TEXT);
        INSERT INTO package_status VALUES ('music', 'disabled', 'yesterday'), ('audio', 'enabled', 'today');
        INSERT INTO package_installs VALUES ('music', '0.3.14');
        INSERT INTO feeds VALUES ('f1', 'music', 'https://example.test/feed');
        INSERT INTO scheduled_jobs VALUES ('j1', 'music', 'search');
        INSERT INTO routing_embeddings VALUES ('music', 'hash', 'space', 'example', 1, X'01', 'hlc');
        INSERT INTO conversation_turns VALUES ('t1', 'music', 'hello');
        INSERT INTO feeds VALUES ('f2', 'other', 'https://other.test/feed');
      `);
      db.exec(sql);
      expect(db.query("SELECT * FROM package_status").all()).toEqual([{ package_id: "audio", status: "enabled", last_smoke_at: "today" }]);
      expect(db.query("SELECT * FROM package_installs").all()).toEqual([{ package_id: "audio", version: "0.3.14" }]);
      expect(db.query("SELECT * FROM feeds ORDER BY id").all()).toEqual([
        { id: "f1", package_id: "audio", url: "https://example.test/feed" },
        { id: "f2", package_id: "other", url: "https://other.test/feed" },
      ]);
      expect(db.query("SELECT * FROM scheduled_jobs").all()).toEqual([{ id: "j1", package_id: "audio", job: "search" }]);
      expect(db.query("SELECT package_id, example_hash, space, example, dims, hex(vector) AS vector, hlc FROM routing_embeddings").all()).toEqual([{ package_id: "audio", example_hash: "hash", space: "space", example: "example", dims: 1, vector: "01", hlc: "hlc" }]);
      expect(db.query("SELECT * FROM conversation_turns").all()).toEqual([{ id: "t1", plugin_id: "audio", user_text: "hello" }]);
      db.exec(sql);
      expect(db.query("SELECT count(*) AS n FROM package_installs WHERE package_id = 'audio'").get()).toEqual({ n: 1 });
    } finally {
      db.close();
    }
  });
});
