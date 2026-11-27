// STACK-LORAS-01 slice 6: the step that archives and drops Home's old LoRA tables (lib/loras/legacyDrop.ts). It runs on throwaway databases built from the
// real migration file 0161 and the old preference tables, never on a hub's data.
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ARCHIVE_TABLE, dropLegacyLoraTables } from "@/lib/loras/legacyDrop";

const MIGRATIONS = join(import.meta.dir, "../src/db/migrations");
const NOW = new Date("2026-11-27T12:00:00.000Z");

function fixture(): { sqlite: Database; dir: string; done: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "loras-legacy-drop-"));
  const sqlite = new Database(":memory:");
  for (const statement of readFileSync(join(MIGRATIONS, "0161_loras.sql"), "utf8").split("--> statement-breakpoint")) sqlite.exec(statement);
  sqlite.exec("CREATE TABLE video_adapter_prefs (adapter_id text PRIMARY KEY NOT NULL, enabled integer NOT NULL DEFAULT 1, updated_at text NOT NULL, updated_by text)");
  sqlite.exec("CREATE TABLE picture_adapter_prefs (adapter_id text PRIMARY KEY NOT NULL, enabled integer NOT NULL DEFAULT 1, updated_at text NOT NULL, updated_by text)");
  sqlite.exec("CREATE TABLE lora_people (lora_id text PRIMARY KEY NOT NULL, people text NOT NULL, updated_at text NOT NULL, hlc text NOT NULL, provenance text NOT NULL)");
  return { sqlite, dir, done: () => { sqlite.close(); rmSync(dir, { recursive: true, force: true }); } };
}

function addLora(sqlite: Database, id: string, people: string[] = []): void {
  const record = JSON.stringify({ id, name: `Style ${id}`, availability: { who: people.length ? "people" : "adults", people } });
  sqlite.query("INSERT INTO loras (id, record, media, kind, base_model, audience, availability_who, sha256, added_at, created_at, updated_at, hlc, provenance) VALUES (?, ?, 'video', 'style', 'ltx-2.3', 'all-ages', 'adults', ?, 'a', 'a', 'a', 'h', 'p')")
    .run(id, record, id.padEnd(64, "0"));
}

const names = (sqlite: Database): string[] => (sqlite.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
const run = (f: ReturnType<typeof fixture>, listStackIds: () => Promise<string[]>) =>
  dropLegacyLoraTables({ sqlite: f.sqlite, listStackIds, archiveDir: join(f.dir, "archive"), now: () => NOW, hlc: () => "1:0:test00" });

describe("the old LoRA tables are dropped only when the Stack holds every style", () => {
  test("refuses and keeps everything when the Stack lacks one id", async () => {
    const f = fixture();
    try {
      addLora(f.sqlite, "lora-aaaaaaaaaaaaaaaa"); addLora(f.sqlite, "lora-bbbbbbbbbbbbbbbb");
      const result = await run(f, async () => ["lora-aaaaaaaaaaaaaaaa", "lora-cccccccccccccccc"]);
      expect(result).toMatchObject({ state: "refused", reason: "missing_ids", missing: ["lora-bbbbbbbbbbbbbbbb"] });
      expect(names(f.sqlite)).toEqual(expect.arrayContaining(["loras", "video_adapter_prefs", "picture_adapter_prefs"]));
      expect(names(f.sqlite)).not.toContain(ARCHIVE_TABLE);
      expect(existsSync(join(f.dir, "archive"))).toBe(false);
      expect(f.sqlite.query("SELECT count(*) AS n FROM loras").get()).toEqual({ n: 2 });
    } finally { f.done(); }
  });

  test("refuses and keeps everything when the Stack cannot be read", async () => {
    const f = fixture();
    try {
      addLora(f.sqlite, "lora-aaaaaaaaaaaaaaaa");
      const result = await run(f, async () => { throw new Error("connection refused"); });
      expect(result).toMatchObject({ state: "refused", reason: "stack_unreachable" });
      expect(names(f.sqlite)).toContain("loras");
      expect(names(f.sqlite)).not.toContain(ARCHIVE_TABLE);
    } finally { f.done(); }
  });

  test("archives to a file and a table, copies the named adults, then drops; the Stack's extra ids do not matter", async () => {
    const f = fixture();
    try {
      addLora(f.sqlite, "lora-aaaaaaaaaaaaaaaa", ["person-aaaaaa1", "person-bbbbbb2"]);
      addLora(f.sqlite, "lora-bbbbbbbbbbbbbbbb", ["person-cccccc3"]);
      addLora(f.sqlite, "lora-dddddddddddddddd");
      f.sqlite.exec("INSERT INTO video_adapter_prefs VALUES ('lora-aaaaaaaaaaaaaaaa', 0, 't', 'person-aaaaaa1')");
      // A row already in Home's people table is kept as it is.
      f.sqlite.exec("INSERT INTO lora_people VALUES ('lora-bbbbbbbbbbbbbbbb', '[\"person-existing1\"]', 't', 'h', 'kept')");
      const result = await run(f, async () => ["lora-aaaaaaaaaaaaaaaa", "lora-bbbbbbbbbbbbbbbb", "lora-dddddddddddddddd", "lora-extra0000000000"]);
      expect(result).toMatchObject({ state: "dropped", rows: { loras: 3, video_adapter_prefs: 1, picture_adapter_prefs: 0 }, peopleCopied: 1 });
      expect(names(f.sqlite)).not.toContain("loras");
      expect(names(f.sqlite)).not.toContain("video_adapter_prefs");
      expect(names(f.sqlite)).not.toContain("picture_adapter_prefs");
      expect(f.sqlite.query(`SELECT source_table, count(*) AS n FROM ${ARCHIVE_TABLE} GROUP BY source_table ORDER BY source_table`).all()).toEqual([{ source_table: "loras", n: 3 }, { source_table: "video_adapter_prefs", n: 1 }]);
      const archived = JSON.parse((f.sqlite.query(`SELECT row_json FROM ${ARCHIVE_TABLE} WHERE row_key = 'lora-aaaaaaaaaaaaaaaa' AND source_table = 'loras'`).get() as { row_json: string }).row_json);
      expect(archived.sha256).toBe("lora-aaaaaaaaaaaaaaaa".padEnd(64, "0"));
      expect(JSON.parse(archived.record).availability.people).toEqual(["person-aaaaaa1", "person-bbbbbb2"]);
      const files = readdirSync(join(f.dir, "archive"));
      expect(files).toHaveLength(1);
      const body = readFileSync(join(f.dir, "archive", files[0]!));
      expect(createHash("sha256").update(body).digest("hex")).toBe((result as { fileSha256: string }).fileSha256);
      expect(JSON.parse(body.toString()).tables.loras).toHaveLength(3);
      expect(f.sqlite.query("SELECT lora_id, people, provenance FROM lora_people ORDER BY lora_id").all()).toEqual([
        { lora_id: "lora-aaaaaaaaaaaaaaaa", people: JSON.stringify(["person-aaaaaa1", "person-bbbbbb2"]), provenance: "migration:stack-loras-slice6" },
        { lora_id: "lora-bbbbbbbbbbbbbbbb", people: "[\"person-existing1\"]", provenance: "kept" },
      ]);
    } finally { f.done(); }
  });

  test("a second run does nothing and leaves the archive as it was", async () => {
    const f = fixture();
    try {
      addLora(f.sqlite, "lora-aaaaaaaaaaaaaaaa");
      const ids = async () => ["lora-aaaaaaaaaaaaaaaa"];
      expect((await run(f, ids)).state).toBe("dropped");
      const before = f.sqlite.query(`SELECT * FROM ${ARCHIVE_TABLE}`).all();
      let asked = 0;
      expect(await run(f, async () => { asked += 1; return []; })).toEqual({ state: "nothing" });
      expect(asked).toBe(0);
      expect(f.sqlite.query(`SELECT * FROM ${ARCHIVE_TABLE}`).all()).toEqual(before);
      expect(readdirSync(join(f.dir, "archive"))).toHaveLength(1);
    } finally { f.done(); }
  });

  test("empty tables drop without asking the Stack and write no archive file", async () => {
    const f = fixture();
    try {
      let asked = 0;
      const result = await run(f, async () => { asked += 1; throw new Error("down"); });
      expect(result).toMatchObject({ state: "dropped", file: null, peopleCopied: 0 });
      expect(asked).toBe(0);
      expect(names(f.sqlite)).not.toContain("loras");
      expect(existsSync(join(f.dir, "archive"))).toBe(false);
    } finally { f.done(); }
  });

  test("an archive that cannot be written keeps the tables", async () => {
    const f = fixture();
    try {
      addLora(f.sqlite, "lora-aaaaaaaaaaaaaaaa");
      writeFileSync(join(f.dir, "archive"), "a file where the folder should be");
      const result = await run(f, async () => ["lora-aaaaaaaaaaaaaaaa"]);
      expect(result).toMatchObject({ state: "refused", reason: "archive_failed" });
      expect(names(f.sqlite)).toContain("loras");
    } finally { f.done(); }
  });

  test("a failure inside the transaction rolls the archive and the drop back", async () => {
    const f = fixture();
    try {
      addLora(f.sqlite, "lora-aaaaaaaaaaaaaaaa", ["person-aaaaaa1"]);
      f.sqlite.exec("CREATE TRIGGER stop_people BEFORE INSERT ON lora_people BEGIN SELECT RAISE(ABORT, 'no'); END");
      const result = await run(f, async () => ["lora-aaaaaaaaaaaaaaaa"]);
      expect(result).toMatchObject({ state: "refused", reason: "archive_failed" });
      expect(names(f.sqlite)).toContain("loras");
      expect(names(f.sqlite)).not.toContain(ARCHIVE_TABLE);
    } finally { f.done(); }
  });
});

describe("Home keeps no LoRA table (guard)", () => {
  const src = join(import.meta.dir, "../src");
  const all = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? all(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []);

  test("the schema declares no `loras`, `video_adapter_prefs` or `picture_adapter_prefs` table and the old writer files are gone", () => {
    const schema = readFileSync(join(src, "db/schema.ts"), "utf8");
    for (const name of ["loras", "video_adapter_prefs", "picture_adapter_prefs"]) expect(schema).not.toContain(`sqliteTable("${name}"`);
    for (const gone of ["store", "sync", "admin", "install", "source", "adultCheck"]) expect(existsSync(join(src, `lib/loras/${gone}.ts`))).toBe(false);
  });

  test("only the drop step reads those tables by name", () => {
    const offenders = all(src).filter((file) => !/lib\/loras\/legacyDrop\.ts$/.test(file) && /\b(from|join|into|update|table|exists)\s+[`"]?(loras|video_adapter_prefs|picture_adapter_prefs)\b/i.test(readFileSync(file, "utf8")) && !file.includes("/db/migrations/"));
    expect(offenders).toEqual([]);
  });
});
