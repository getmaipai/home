// SHELL-SEARCH-03: 0063_conversation_turns_fts.sql, run against a copy
// of a populated database - a fresh install (resetDb()'s own migration
// chain) never has this problem, since conversation_turns is empty the
// moment 0063 creates the FTS5 table; a real household upgrading has
// real history already in it, and that's what this file actually
// proves. Runs the migration file's own SQL text directly, the same
// pattern lookMigration.test.ts already uses for 0057 - except this
// migration creates objects that would already exist after resetDb()'s
// own chain applies it once, so the "populated database" this test
// builds is resetDb()'s own schema with just this one migration's
// effects undone first (the virtual table and its three triggers
// dropped), real rows inserted the ordinary way with no FTS5 trigger
// listening, then the migration's own SQL re-run - a faithful stand-in
// for "an existing household's data directory, migrated forward."
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { conversationTurns, people } from "@/db/schema";
import { newConversationTurnId, newPersonId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { resetDb } from "./reset-db";

const MIGRATION_SQL = readFileSync(join(import.meta.dir, "../src/db/migrations/0063_conversation_turns_fts.sql"), "utf-8");
const MIGRATION_STATEMENTS = MIGRATION_SQL.split("--> statement-breakpoint").map((s) => s.trim());

// The real database connection is shared across every test file in one
// `bun test` run (resetDb() only ever clears rows, never re-runs the
// migration chain) - undoMigration() has to be safe to call whether
// its objects currently exist or not (IF EXISTS both ways), and
// runMigration() is always called again, unconditionally, once this
// file is done with them (afterEach below), so a test that fails
// midway can never leave a later file's own conversation_turns_fts
// missing.
function runMigration(): void {
  for (const statement of MIGRATION_STATEMENTS) db.run(statement);
}

function undoMigration(): void {
  db.run("DROP TRIGGER IF EXISTS conversation_turns_ai");
  db.run("DROP TRIGGER IF EXISTS conversation_turns_ad");
  db.run("DROP TRIGGER IF EXISTS conversation_turns_au");
  db.run("DROP TABLE IF EXISTS conversation_turns_fts");
}

function insertPerson(): string {
  const now = new Date().toISOString();
  const personId = newPersonId();
  db.insert(people)
    .values({ id: personId, displayName: "Willow", role: "owner", avatarSeed: personId, source: "hub", createdAt: now, updatedAt: now, hlc: nextHlc() })
    .run();
  return personId;
}

function seedPreMigrationTurn(personId: string, userText: string, replyText: string): string {
  const id = newConversationTurnId();
  db.insert(conversationTurns)
    .values({
      id,
      personId,
      surface: "chat",
      userText,
      replyText,
      source: "model",
      safetyAction: "allow",
      createdAt: new Date().toISOString(),
      hlc: nextHlc(),
    })
    .run();
  return id;
}

function ftsConversationIds(term: string): string[] {
  return (
    db.all(
      `SELECT ct.id AS id FROM conversation_turns_fts f JOIN conversation_turns ct ON ct.rowid = f.rowid WHERE conversation_turns_fts MATCH '${term}'`,
    ) as Array<{ id: string }>
  ).map((r) => r.id);
}

beforeEach(() => {
  resetDb();
  undoMigration();
});

afterEach(() => {
  undoMigration();
  runMigration();
});

describe("0063_conversation_turns_fts: run against a copy of a populated database", () => {
  test("backfills rows that already existed before the migration ran", () => {
    const personId = insertPerson();
    const preExisting = seedPreMigrationTurn(personId, "what's the wifi password", "it's on the fridge");
    // Undo left the table genuinely unindexed - no trigger existed to
    // catch this insert, the honest state a real pre-migration row is in.
    expect(() => ftsConversationIds("fridge")).toThrow();

    runMigration();

    expect(ftsConversationIds("fridge")).toEqual([preExisting]);
    expect(ftsConversationIds("wifi")).toEqual([preExisting]);
  });

  test("the sync triggers work on ordinary writes made after the migration runs", () => {
    const personId = insertPerson();
    runMigration();
    const after = seedPreMigrationTurn(personId, "remind me to water the plants", "reminder set for six pm");
    expect(ftsConversationIds("plants")).toEqual([after]);
  });

  test("a turn that existed before AND one written after are both findable together", () => {
    const personId = insertPerson();
    const before = seedPreMigrationTurn(personId, "garden notes from spring", "compost by the fence");
    runMigration();
    const after = seedPreMigrationTurn(personId, "garden notes from fall", "leaves need raking");

    const results = ftsConversationIds("garden").sort();
    expect(results).toEqual([after, before].sort());
  });

  // The AU trigger's own delete-then-reinsert (a turn's own text is
  // never actually edited by any real write path today - an edit-and-
  // resend supersedes with a new row, #88 - but the trigger is
  // written to handle it correctly regardless, the same shape
  // episodes_au already has, and this proves that SQL actually does
  // what it's meant to rather than trusting it by inspection alone).
  test("editing a turn's own text makes the old words unfindable and the new ones findable", () => {
    const personId = insertPerson();
    runMigration();
    const id = seedPreMigrationTurn(personId, "the wifi password is sunflower", "got it, thanks");

    expect(ftsConversationIds("sunflower")).toEqual([id]);

    db.update(conversationTurns).set({ userText: "the wifi password is daffodil" }).where(eq(conversationTurns.id, id)).run();

    expect(ftsConversationIds("sunflower")).toEqual([]);
    expect(ftsConversationIds("daffodil")).toEqual([id]);
  });

  // The AD trigger: runRetention()'s own real deletion path (fixed in
  // this same change, see conversationHistory.ts) relies on this
  // firing correctly - a leftover index entry for a genuinely deleted
  // turn would be a real privacy gap (a household's own 90-day
  // retention promise, "gone after N days," would keep the words
  // findable even after the row itself was gone), so this is proven
  // directly rather than only through the retention tests that happen
  // to exercise it as a side effect.
  test("a deleted turn's text is gone from the index", () => {
    const personId = insertPerson();
    runMigration();
    const survivor = seedPreMigrationTurn(personId, "the router password never changes", "good to know");
    const id = seedPreMigrationTurn(personId, "the router password is bluebell", "got it, thanks");
    expect(ftsConversationIds("bluebell")).toEqual([id]);

    db.delete(conversationTurns).where(eq(conversationTurns.id, id)).run();

    expect(ftsConversationIds("bluebell")).toEqual([]);
    // The sibling row (a genuinely different word, "router" shared by
    // both) still finds only the survivor - the delete removed exactly
    // its own entry, not the whole index.
    expect(ftsConversationIds("router")).toEqual([survivor]);
  });
});
