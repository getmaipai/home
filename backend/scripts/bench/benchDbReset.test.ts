// MEMORY-RECALL-01: a repeat starts from the same database state as the first one.
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { fingerprintDb, restoreDb, snapshotDb } from "./benchDbReset";

function freshDb(): Database {
  const d = new Database(":memory:");
  d.exec("PRAGMA foreign_keys = ON");
  d.exec(`CREATE TABLE people (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE memory_records (id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES people(id), text TEXT, source TEXT);
    CREATE TABLE settings (k TEXT PRIMARY KEY, v TEXT);
    CREATE VIRTUAL TABLE notes USING fts5(body);
    INSERT INTO settings VALUES ('engines.stack.url', 'http://127.0.0.1:1');`);
  return d;
}
function seedRep(d: Database, rep: number): number {
  // What a repeat leaves behind: a person, a memory that would trip a duplicate check, a note.
  d.query("INSERT INTO people VALUES (?, 'astro')").run(`p${rep}`);
  d.query("INSERT INTO memory_records VALUES (?, ?, 'works at the library', 'turn-x')").run(`m${rep}`, `p${rep}`);
  d.query("INSERT INTO notes (body) VALUES ('hello')").run();
  return (d.query("SELECT COUNT(*) AS c FROM memory_records WHERE text = 'works at the library'").get() as { c: number }).c;
}

describe("bench database reset", () => {
  test("rep 2 starts with the same state and sees the same duplicate-check view as rep 0", () => {
    const d = freshDb();
    const snap = snapshotDb(d);
    const start = fingerprintDb(d, snap);
    const seen: number[] = [];
    for (let rep = 0; rep < 3; rep++) {
      expect(fingerprintDb(d, snap)).toBe(start);
      expect((d.query("SELECT COUNT(*) AS c FROM memory_records").get() as { c: number }).c).toBe(0);
      seen.push(seedRep(d, rep));
      restoreDb(d, snap);
    }
    expect(seen).toEqual([1, 1, 1]);
    expect(fingerprintDb(d, snap)).toBe(start);
  });
  test("rows that existed before the snapshot survive, and foreign keys are back on after a restore", () => {
    const d = freshDb();
    const snap = snapshotDb(d);
    seedRep(d, 0);
    restoreDb(d, snap);
    expect(d.query("SELECT v FROM settings WHERE k = 'engines.stack.url'").get()).toEqual({ v: "http://127.0.0.1:1" });
    expect((d.query("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys).toBe(1);
    expect(() => d.query("INSERT INTO memory_records VALUES ('z', 'nobody', 't', 's')").run()).toThrow();
  });
});
