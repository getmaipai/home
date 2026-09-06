import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { db } from "@/db";
import { people, memoryRecords, conversations, conversationTurns } from "@/db/schema";
import { runLegacyImport, LegacyImportError, ORPHANED_REPLY_TEXT } from "@/lib/legacyImport";
import { runBackup } from "@/lib/backup";
import type { PersonRow } from "@/types";

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
});

// A minimal, real legacy-shaped sqlite database (home-legacy.git's own
// backend/src/db/schema.ts, the exact columns lib/legacyImport.ts reads)
// - never a mock of the reader, a real file the same importer code would
// open against Jesse's actual app.db. Timestamps are unix SECONDS
// (legacy's own `integer(..., {mode:'timestamp'})` convention), not
// milliseconds.
function buildLegacyFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "maipai-legacy-fixture-"));
  const path = join(dir, "app.db");
  const legacy = new Database(path);
  legacy.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      nickname TEXT NOT NULL,
      birthdate TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      dicebear_seed TEXT
    );
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER,
      deleted_at INTEGER,
      temporary INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      character_id TEXT,
      text TEXT NOT NULL,
      category TEXT NOT NULL,
      tier TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      importance INTEGER NOT NULL DEFAULT 5,
      pinned INTEGER NOT NULL DEFAULT 0,
      sensitive INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
  `);

  const now = Math.floor(Date.now() / 1000);

  // user-willow: an adult who already has a matching profile on the new
  // hub (created in each test below) - "matched by display name."
  legacy
    .query("INSERT INTO users (id, first_name, last_name, nickname, birthdate, role, dicebear_seed) VALUES (?,?,?,?,?,?,?)")
    .run("user-willow", "Willow", "Sage", "Will", "1985-06-15", "user", "legacy-seed-1");
  // user-bramble: an adult with NO existing match - legacy role 'admin'
  // on purpose, to prove this never auto-promotes to hub role "admin".
  legacy
    .query("INSERT INTO users (id, first_name, last_name, nickname, birthdate, role, dicebear_seed) VALUES (?,?,?,?,?,?,?)")
    .run("user-bramble", "Bramble", "Rivet", "Bramble", "1990-02-20", "admin", null);
  // user-clover: a child with no existing match - never auto-created.
  legacy
    .query("INSERT INTO users (id, first_name, last_name, nickname, birthdate, role, dicebear_seed) VALUES (?,?,?,?,?,?,?)")
    .run("user-clover", "Clover", "Marsh", "", "2018-03-01", "user", null);

  // conv-normal: a plain user/assistant/user/assistant exchange for Bramble.
  legacy
    .query("INSERT INTO conversations (id, user_id, title, created_at, updated_at, deleted_at, temporary) VALUES (?,?,?,?,?,?,0)")
    .run("conv-normal", "user-bramble", "Chatting", now - 1000, now - 900, null);
  const msgs: [string, string, string, number][] = [
    ["msg-1", "user", "Hi there", now - 1000],
    ["msg-2", "assistant", "Hello, Bramble!", now - 990],
    ["msg-3", "user", "How are you?", now - 980],
    ["msg-4", "assistant", "I'm doing well, thanks.", now - 970],
  ];
  for (const [id, role, content, createdAt] of msgs) {
    legacy.query("INSERT INTO messages (id, conversation_id, role, content, active, created_at) VALUES (?,?,?,?,1,?)").run(id, "conv-normal", role, content, createdAt);
  }
  // An inactive (discarded regenerate) reply that must never surface.
  legacy
    .query("INSERT INTO messages (id, conversation_id, role, content, active, created_at) VALUES (?,?,?,?,0,?)")
    .run("msg-discarded", "conv-normal", "assistant", "a discarded regenerate branch", now - 985);

  // conv-orphaned: a trailing user message with no reply.
  legacy
    .query("INSERT INTO conversations (id, user_id, title, created_at, updated_at, deleted_at, temporary) VALUES (?,?,?,?,?,?,0)")
    .run("conv-orphaned", "user-bramble", null, now - 500, null, null);
  legacy
    .query("INSERT INTO messages (id, conversation_id, role, content, active, created_at) VALUES (?,?,?,?,1,?)")
    .run("msg-orphan", "conv-orphaned", "user", "Are you still there?", now - 500);

  // An incognito conversation - must never be imported at all.
  legacy
    .query("INSERT INTO conversations (id, user_id, title, created_at, updated_at, deleted_at, temporary) VALUES (?,?,?,?,?,?,1)")
    .run("conv-incognito", "user-bramble", "secret", now - 400, null, null);
  legacy
    .query("INSERT INTO messages (id, conversation_id, role, content, active, created_at) VALUES (?,?,?,?,1,?)")
    .run("msg-incognito", "conv-incognito", "user", "never import me", now - 400);

  // Memories: person-scope (Willow, matched), household-scope (character-
  // global, no user_id), an entity-shaped category (Bramble, created),
  // an archived one that must be skipped, and one for the skipped child.
  legacy
    .query("INSERT INTO memories (id, user_id, character_id, text, category, tier, status, importance, pinned, sensitive, created_at) VALUES (?,?,?,?,?,?,?,?,0,0,?)")
    .run("mem-willow-pref", "user-willow", null, "Willow loves gardening", "preference", "durable", "active", 8, now - 2000);
  legacy
    .query("INSERT INTO memories (id, user_id, character_id, text, category, tier, status, importance, pinned, sensitive, created_at) VALUES (?,?,?,?,?,?,?,?,0,0,?)")
    .run("mem-household-wifi", null, "char-1", "The wifi password is Juniper2026", "fact", "episodic", "active", 6, now - 3000);
  legacy
    .query("INSERT INTO memories (id, user_id, character_id, text, category, tier, status, importance, pinned, sensitive, created_at) VALUES (?,?,?,?,?,?,?,?,0,0,?)")
    .run("mem-bramble-entity", "user-bramble", null, "Rivet: Bramble's brother", "person", "durable", "active", 9, now - 1500);
  legacy
    .query("INSERT INTO memories (id, user_id, character_id, text, category, tier, status, importance, pinned, sensitive, created_at) VALUES (?,?,?,?,?,?,?,?,0,0,?)")
    .run("mem-archived", "user-willow", null, "an old, superseded fact", "fact", "episodic", "archived", 5, now - 5000);
  legacy
    .query("INSERT INTO memories (id, user_id, character_id, text, category, tier, status, importance, pinned, sensitive, created_at) VALUES (?,?,?,?,?,?,?,?,0,0,?)")
    .run("mem-clover-orphaned", "user-clover", null, "Clover likes dinosaurs", "preference", "durable", "active", 7, now - 1200);

  legacy.close();
  return path;
}

async function ownerAndMatch(): Promise<{ ownerRow: PersonRow; willowId: string }> {
  const owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const created = await owner.post("/api/people", { displayName: "Willow Sage", role: "adult" });
  const willow = (await created.json()) as { id: string };
  const ownerRow = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  return { ownerRow, willowId: willow.id };
}

describe("runLegacyImport()", () => {
  test("refuses a path that doesn't exist", async () => {
    const { ownerRow } = await ownerAndMatch();
    expect(() => runLegacyImport(ownerRow, { dbPath: "/no/such/file.db" })).toThrow(LegacyImportError);
  });

  test("a real (non-dry-run) import refuses without a backup on file", async () => {
    const { ownerRow } = await ownerAndMatch();
    const dbPath = buildLegacyFixture();
    expect(() => runLegacyImport(ownerRow, { dbPath, dryRun: false })).toThrow(/no backup/);
  });

  test("dry run reports counts and makes no writes", async () => {
    const { ownerRow, willowId } = await ownerAndMatch();
    const dbPath = buildLegacyFixture();

    const result = runLegacyImport(ownerRow, { dbPath, dryRun: true });
    expect(result.dryRun).toBe(true);

    const willow = result.people.find((p) => p.legacyId === "user-willow")!;
    expect(willow.outcome).toBe("matched_existing");
    expect(willow.personId).toBe(willowId);

    const bramble = result.people.find((p) => p.legacyId === "user-bramble")!;
    expect(bramble.outcome).toBe("created");
    expect(bramble.personId).toBeTruthy();

    const clover = result.people.find((p) => p.legacyId === "user-clover")!;
    expect(clover.outcome).toBe("skipped_needs_parent_pick");
    expect(clover.personId).toBeNull();

    expect(result.counts.peopleMatched).toBe(1);
    expect(result.counts.peopleCreated).toBe(1);
    expect(result.counts.peopleSkippedMinor).toBe(1);
    // 5 memories total: 1 archived is never counted, 1 belongs to the
    // skipped child - 3 real candidates.
    expect(result.counts.memoriesImported).toBe(3);
    expect(result.counts.memoriesSkippedNoPerson).toBe(1);
    // 2 real conversations (incognito excluded entirely by the query
    // itself, never even counted as skipped).
    expect(result.counts.conversationsImported).toBe(2);
    // conv-normal: 2 paired turns + 1 discarded-branch exclusion (active=0
    // is filtered by the SQL itself, not paired at all).
    // conv-orphaned: 1 orphaned turn.
    expect(result.counts.turnsImported).toBe(3);

    // Nothing was actually written.
    expect(db.select().from(people).all().length).toBe(2); // owner + Willow only
    expect(db.select().from(memoryRecords).all().length).toBe(0);
    expect(db.select().from(conversations).all().length).toBe(0);
  });

  test("a real import writes people, memories, and paired conversation turns", async () => {
    const { ownerRow, willowId } = await ownerAndMatch();
    const dbPath = buildLegacyFixture();
    runBackup();

    const result = runLegacyImport(ownerRow, { dbPath, dryRun: false });
    expect(result.dryRun).toBe(false);
    expect(result.errors).toEqual([]);

    const bramble = result.people.find((p) => p.legacyId === "user-bramble")!;
    expect(bramble.outcome).toBe("created");
    const brambleRow = db.select().from(people).where(eq(people.id, bramble.personId!)).get()!;
    expect(brambleRow.displayName).toBe("Bramble Rivet");
    // Legacy role 'admin' never auto-promotes to hub role "admin".
    expect(brambleRow.role).toBe("adult");

    // Willow's memory: person-scoped under her EXISTING id, not a new one.
    const willowMem = db.select().from(memoryRecords).where(eq(memoryRecords.source, "import:legacy:memory:mem-willow-pref")).get()!;
    expect(willowMem.scope).toBe("person");
    expect(willowMem.person).toBe(willowId);
    expect(willowMem.text).toBe("Willow loves gardening");
    expect(willowMem.importance).toBeCloseTo(0.8);
    expect(willowMem.recordKind).toBe("memory");

    // The character-global memory (no user_id) lands household-scoped.
    const householdMem = db.select().from(memoryRecords).where(eq(memoryRecords.source, "import:legacy:memory:mem-household-wifi")).get()!;
    expect(householdMem.scope).toBe("household");
    expect(householdMem.person).toBeNull();

    // An entity-shaped category ("person") imports as record_kind "entity".
    const entityMem = db.select().from(memoryRecords).where(eq(memoryRecords.source, "import:legacy:memory:mem-bramble-entity")).get()!;
    expect(entityMem.recordKind).toBe("entity");
    expect(entityMem.person).toBe(bramble.personId);

    // The archived legacy memory and the skipped child's memory never land.
    expect(db.select().from(memoryRecords).where(eq(memoryRecords.source, "import:legacy:memory:mem-archived")).get()).toBeUndefined();
    expect(db.select().from(memoryRecords).where(eq(memoryRecords.source, "import:legacy:memory:mem-clover-orphaned")).get()).toBeUndefined();

    // Conversations: 2 real threads, both closed (a historical archive,
    // never the person's live "chat" conversation).
    const convRows = db.select().from(conversations).where(eq(conversations.personId, bramble.personId!)).all();
    expect(convRows.length).toBe(2);
    for (const c of convRows) expect(c.status).toBe("closed");
    const normalConv = convRows.find((c) => c.title === "Chatting")!;
    expect(normalConv).toBeTruthy();

    // The incognito conversation never imports.
    expect(convRows.some((c) => c.title === "secret")).toBe(false);

    const normalTurns = db.select().from(conversationTurns).where(eq(conversationTurns.conversationId, normalConv.id)).all();
    normalTurns.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    expect(normalTurns.length).toBe(2);
    expect(normalTurns[0]!.userText).toBe("Hi there");
    expect(normalTurns[0]!.replyText).toBe("Hello, Bramble!");
    expect(normalTurns[1]!.userText).toBe("How are you?");
    expect(normalTurns[1]!.replyText).toBe("I'm doing well, thanks.");
    for (const t of normalTurns) {
      expect(t.judgeStatus).toBe("done");
      expect(t.source).toBe("import");
    }

    const orphanedConv = convRows.find((c) => c.title !== "Chatting")!;
    const orphanedTurns = db.select().from(conversationTurns).where(eq(conversationTurns.conversationId, orphanedConv.id)).all();
    expect(orphanedTurns.length).toBe(1);
    expect(orphanedTurns[0]!.userText).toBe("Are you still there?");
    expect(orphanedTurns[0]!.replyText).toBe(ORPHANED_REPLY_TEXT);
  });

  test("running the same import twice is idempotent: nothing doubles", async () => {
    const { ownerRow } = await ownerAndMatch();
    const dbPath = buildLegacyFixture();
    runBackup();

    const first = runLegacyImport(ownerRow, { dbPath, dryRun: false });
    expect(first.counts.peopleCreated).toBe(1);
    expect(first.counts.memoriesImported).toBe(3);
    expect(first.counts.conversationsImported).toBe(2);
    expect(first.counts.turnsImported).toBe(3);

    const peopleCountAfterFirst = db.select().from(people).all().length;
    const memoryCountAfterFirst = db.select().from(memoryRecords).all().length;
    const turnCountAfterFirst = db.select().from(conversationTurns).all().length;

    const second = runLegacyImport(ownerRow, { dbPath, dryRun: false });
    expect(second.counts.peopleCreated).toBe(0);
    expect(second.counts.peopleMatched).toBe(2); // Willow (real match) + Bramble (now exists too)
    expect(second.counts.peopleSkippedMinor).toBe(1); // Clover, still no parent pick
    expect(second.counts.memoriesImported).toBe(0);
    expect(second.counts.memoriesAlreadyPresent).toBe(3);
    expect(second.counts.conversationsImported).toBe(0);
    expect(second.counts.conversationsAlreadyPresent).toBe(2);
    expect(second.counts.turnsImported).toBe(0);
    expect(second.counts.turnsAlreadyPresent).toBe(3);

    expect(db.select().from(people).all().length).toBe(peopleCountAfterFirst);
    expect(db.select().from(memoryRecords).all().length).toBe(memoryCountAfterFirst);
    expect(db.select().from(conversationTurns).all().length).toBe(turnCountAfterFirst);
  });
});
