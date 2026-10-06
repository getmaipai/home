// getmaipai/home#214: a row that names a turn or a conversation through a
// foreign key blocks deleting it, and the whole delete rolls back. Three
// paths delete turns: a person removed, a chat deleted, history past
// retention. This walks the live schema for every table with a foreign key
// to `conversation_turns` or `conversations`, puts one real row in each,
// and drives each path, so a table added later that no path clears fails
// here by name instead of in a household's delete.
import { beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { sqlite } from "@/db";
import { createBenchPeople, type BenchPeople } from "../scripts/bench/conversationRunner";
import { deleteConversationById, logTurn, resolveOrCreateConversation, runRetention } from "@/lib/conversationHistory";
import { deletePerson } from "@/lib/personLifecycle";
import type { PersonRow } from "@/types";

const SAFE = { flagged: false, categories: [], action: "allow" as const, notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() };

type Column = { name: string; type: string; notnull: number; dflt_value: string | null; pk: number };
type ForeignKey = { table: string; from: string; to: string };

let people: BenchPeople;

beforeEach(() => {
  resetDb();
  people = createBenchPeople();
});

/** Every table (but the turns themselves) holding a foreign key to a turn
 * or a conversation. */
function referencingTables(): string[] {
  const tables = sqlite.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>;
  return tables
    .map((t) => t.name)
    .filter((name) => name !== "conversation_turns" && (sqlite.query(`PRAGMA foreign_key_list("${name}")`).all() as ForeignKey[]).some((key) => key.table === "conversation_turns" || key.table === "conversations"))
    .sort();
}

/** One row in `table` pointing at `turnId` and `conversationId`: every
 * foreign key filled with a real row, every other required column with a
 * plain value of its type. */
function seedReferencing(table: string, ids: { turnId: string; conversationId: string; personId: string }): void {
  const columns = sqlite.query(`PRAGMA table_info("${table}")`).all() as Column[];
  const keys = sqlite.query(`PRAGMA foreign_key_list("${table}")`).all() as ForeignKey[];
  const row: Record<string, string | number> = {};
  for (const column of columns) {
    const key = keys.find((k) => k.from === column.name);
    if (key) {
      if (key.table === "conversation_turns") row[column.name] = ids.turnId;
      else if (key.table === "conversations") row[column.name] = ids.conversationId;
      else if (key.table === "people") row[column.name] = ids.personId;
      else throw new Error(`${table}.${column.name} points at ${key.table}; teach this seeder that table`);
    } else if (column.pk) {
      row[column.name] = `${table}-seeded-${ids.turnId}`;
    } else if (column.notnull && column.dflt_value === null) {
      row[column.name] = /INT|REAL|NUM/i.test(column.type) ? 1 : "{}";
    }
  }
  const names = Object.keys(row);
  sqlite.query(`INSERT INTO "${table}" (${names.map((n) => `"${n}"`).join(", ")}) VALUES (${names.map(() => "?").join(", ")})`).run(...names.map((n) => row[n]!));
}

function chatWithEveryDependent(actor: PersonRow, createdAt?: string): { conversationId: string; turnId: string; tables: string[] } {
  const conversation = resolveOrCreateConversation(actor, "chat");
  if (!conversation.ok) throw new Error(conversation.error);
  const turnId = `turn-dependents${Math.random().toString(36).slice(2, 10)}`;
  logTurn(actor, "chat", "write me a packing list", { reply: { text: "Here it is." }, source: "model", safety: SAFE, conversation_id: conversation.value.id, turn_id: turnId });
  if (createdAt) sqlite.query("UPDATE conversation_turns SET created_at = ? WHERE id = ?").run(createdAt, turnId);
  const tables = referencingTables();
  for (const table of tables) seedReferencing(table, { turnId, conversationId: conversation.value.id, personId: actor.id });
  return { conversationId: conversation.value.id, turnId, tables };
}

function rowsNaming(tables: readonly string[], turnId: string): Record<string, number> {
  const left: Record<string, number> = {};
  for (const table of tables) {
    const keys = (sqlite.query(`PRAGMA foreign_key_list("${table}")`).all() as ForeignKey[]).filter((k) => k.table === "conversation_turns");
    if (keys.length === 0) continue;
    left[table] = keys.reduce((n, key) => n + (sqlite.query(`SELECT count(*) AS n FROM "${table}" WHERE "${key.from}" = ?`).get(turnId) as { n: number }).n, 0);
  }
  return left;
}

describe("every row that names a turn goes before the turn (#214)", () => {
  test("the schema's referencing tables are the ones this test seeds", () => {
    // Not a list to keep in step by hand: printed so a failure below names
    // the table that blocked the delete.
    expect(referencingTables().length).toBeGreaterThan(0);
  });

  test("removing a person succeeds with a row in every table that names their turns or conversations", () => {
    const { turnId, tables } = chatWithEveryDependent(people.child);
    const result = deletePerson(people.owner, people.child.id);
    expect(result.ok).toBe(true);
    expect(sqlite.query("SELECT count(*) AS n FROM conversation_turns WHERE id = ?").get(turnId)).toEqual({ n: 0 });
    expect(rowsNaming(tables, turnId)).toEqual(Object.fromEntries(Object.keys(rowsNaming(tables, turnId)).map((t) => [t, 0])));
  });

  test("deleting a chat succeeds with a row in every table that names its turns", () => {
    const { conversationId, turnId, tables } = chatWithEveryDependent(people.owner);
    expect(deleteConversationById(people.owner, conversationId).ok).toBe(true);
    expect(sqlite.query("SELECT count(*) AS n FROM conversation_turns WHERE id = ?").get(turnId)).toEqual({ n: 0 });
    expect(Object.values(rowsNaming(tables, turnId)).every((n) => n === 0)).toBe(true);
  });

  test("retention prunes an old turn with a row in every table that names it", () => {
    const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    const { turnId, tables } = chatWithEveryDependent(people.owner, old);
    expect(runRetention().deleted).toBe(1);
    expect(sqlite.query("SELECT count(*) AS n FROM conversation_turns WHERE id = ?").get(turnId)).toEqual({ n: 0 });
    expect(Object.values(rowsNaming(tables, turnId)).every((n) => n === 0)).toBe(true);
  });
});
