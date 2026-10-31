import { describe, expect, test, beforeEach } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { conversationTurns, people } from "@/db/schema";
import { newConversationTurnId, newPersonId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { resetDb } from "./reset-db";

const MIGRATION_SQL = readFileSync(join(import.meta.dir, "../src/db/migrations/0150_conversation_turns_fts_update.sql"), "utf-8");
const MIGRATION_STATEMENTS = MIGRATION_SQL.split("--> statement-breakpoint").map((s) => s.trim());

function runUpdateMigration(): void {
  for (const statement of MIGRATION_STATEMENTS) db.run(statement);
}

function seedTurn(): string {
  const now = new Date().toISOString();
  const personId = newPersonId();
  db.insert(people)
    .values({ id: personId, displayName: "Willow", role: "owner", avatarSeed: personId, source: "hub", createdAt: now, updatedAt: now, hlc: nextHlc() })
    .run();
  const id = newConversationTurnId();
  db.insert(conversationTurns)
    .values({
      id,
      personId,
      surface: "chat",
      userText: "remember the router password is marigold",
      replyText: "I will remember it",
      source: "model",
      safetyAction: "allow",
      createdAt: now,
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
  runUpdateMigration();
});

describe("0150_conversation_turns_fts_update: only reindex text changes", () => {
  test("bookkeeping-only updates do not reindex the turn", () => {
    const id = seedTurn();
    expect(ftsConversationIds("marigold")).toEqual([id]);

    db.update(conversationTurns).set({ safetyAction: "block" }).where(eq(conversationTurns.id, id)).run();

    expect(ftsConversationIds("marigold")).toEqual([id]);
  });

  test("reply_text updates reindex the turn", () => {
    const id = seedTurn();
    db.update(conversationTurns).set({ replyText: "the secret is violet" }).where(eq(conversationTurns.id, id)).run();

    expect(ftsConversationIds("remember")).toEqual([id]);
    expect(ftsConversationIds("violet")).toEqual([id]);
  });

  test("user_text updates reindex the turn", () => {
    const id = seedTurn();
    db.update(conversationTurns).set({ userText: "remember the router password is violet" }).where(eq(conversationTurns.id, id)).run();

    expect(ftsConversationIds("marigold")).toEqual([]);
    expect(ftsConversationIds("violet")).toEqual([id]);
  });
});
