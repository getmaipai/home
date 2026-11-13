import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sql = readFileSync(join(import.meta.dir, "../src/db/migrations/0193_video_package_id.sql"), "utf8")
  .replace(/--> statement-breakpoint/g, "");

describe("0193_video_package_id", () => {
  test("renames package references, preserves other values, and keeps existing video package_status", () => {
    const db = new Database(":memory:");
    try {
      db.exec(`
        CREATE TABLE package_status (package_id TEXT PRIMARY KEY, status TEXT, last_smoke_at TEXT);
        CREATE TABLE package_installs (package_id TEXT PRIMARY KEY, version TEXT);
        CREATE TABLE feeds (id TEXT PRIMARY KEY, package_id TEXT, url TEXT);
        CREATE TABLE scheduled_jobs (id TEXT PRIMARY KEY, package_id TEXT, job TEXT);
        CREATE TABLE routing_embeddings (package_id TEXT, example_hash TEXT, space TEXT, example TEXT, dims INTEGER, vector BLOB, hlc TEXT, PRIMARY KEY(package_id, example_hash, space));
        CREATE TABLE conversation_turns (id TEXT PRIMARY KEY, plugin_id TEXT, user_text TEXT);
        CREATE TABLE notification_deliveries (id TEXT PRIMARY KEY, type_id TEXT, text TEXT);
        CREATE TABLE notification_holds (id TEXT PRIMARY KEY, type_id TEXT, text TEXT);
        CREATE TABLE settings_values (scope TEXT, key TEXT, value TEXT, PRIMARY KEY(scope, key));
        INSERT INTO package_status VALUES ('videos', 'disabled', 'yesterday'), ('video', 'enabled', 'today');
        INSERT INTO package_installs VALUES ('videos', '0.3.14');
        INSERT INTO feeds VALUES ('f1', 'videos', 'https://example.test/feed');
        INSERT INTO scheduled_jobs VALUES ('j1', 'videos', 'search');
        INSERT INTO routing_embeddings VALUES ('videos', 'hash', 'space', 'example', 1, X'01', 'hlc');
        INSERT INTO conversation_turns VALUES ('t1', 'videos', 'hello');
        INSERT INTO notification_deliveries VALUES ('n1', 'videos.clip_ready', 'A video is ready');
        INSERT INTO notification_holds VALUES ('h1', 'videos.clip_ready', 'A video is ready');
        INSERT INTO settings_values VALUES ('person:p1', 'ui.pinned_apps', '["/apps/videos","/apps/audio"]');
        INSERT INTO settings_values VALUES ('person:p1', 'videos.library_sort', '"az"');
        INSERT INTO feeds VALUES ('f2', 'other', 'https://other.test/feed');
      `);
      db.exec(sql);
      expect(db.query("SELECT * FROM package_status").all()).toEqual([{ package_id: "video", status: "enabled", last_smoke_at: "today" }]);
      expect(db.query("SELECT * FROM package_installs").all()).toEqual([{ package_id: "video", version: "0.3.14" }]);
      expect(db.query("SELECT * FROM feeds ORDER BY id").all()).toEqual([
        { id: "f1", package_id: "video", url: "https://example.test/feed" },
        { id: "f2", package_id: "other", url: "https://other.test/feed" },
      ]);
      expect(db.query("SELECT * FROM scheduled_jobs").all()).toEqual([{ id: "j1", package_id: "video", job: "search" }]);
      expect(db.query("SELECT package_id, example_hash, space, example, dims, hex(vector) AS vector, hlc FROM routing_embeddings").all()).toEqual([{ package_id: "video", example_hash: "hash", space: "space", example: "example", dims: 1, vector: "01", hlc: "hlc" }]);
      expect(db.query("SELECT * FROM conversation_turns").all()).toEqual([{ id: "t1", plugin_id: "video", user_text: "hello" }]);
      expect(db.query("SELECT * FROM notification_deliveries").all()).toEqual([{ id: "n1", type_id: "video.clip_ready", text: "A video is ready" }]);
      expect(db.query("SELECT * FROM notification_holds").all()).toEqual([{ id: "h1", type_id: "video.clip_ready", text: "A video is ready" }]);
      expect(db.query("SELECT * FROM settings_values ORDER BY key").all()).toEqual([
        { scope: "person:p1", key: "ui.pinned_apps", value: '["/apps/video","/apps/audio"]' },
        { scope: "person:p1", key: "videos.library_sort", value: '"az"' },
      ]);
      db.exec(sql);
      expect(db.query("SELECT count(*) AS n FROM package_installs WHERE package_id = 'video'").get()).toEqual({ n: 1 });
    } finally {
      db.close();
    }
  });
});
