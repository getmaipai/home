// Helpers for the one leak that crosses test files: a prepared statement left open on the hub's connection.
//
// bun 1.4.3 does not reset a statement that ran EXPLAIN (even after .all()), or one whose .iterate() loop was left early. The
// connection then keeps a read transaction open. Nothing fails while no other process writes, but a later test that waits out
// another writer's lock gets "database is locked" at once (SQLite never calls the busy handler for a connection already
// reading), and every write after another connection has committed fails too. bun runs every file of a shard in one process
// and one hub.db, so one such test broke attachments, people, places and dozens of other files after it, and the engine
// tests that came later failed on a `fetch` the broken files had not restored.
import type { Database } from "bun:sqlite";
import { dbPath } from "@/db";

/** EXPLAIN QUERY PLAN for `sql`, one line per plan step. The statement is finalized, so the connection stays free. */
export function explainPlan(sqlite: Database, sql: string, ...params: Array<string | number | null>): string[] {
  const statement = sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`);
  try {
    return (statement.all(...params) as Array<{ detail: string }>).map((row) => row.detail);
  } finally {
    statement.finalize();
  }
}

/** Starts a child process that holds hub.db's write lock for `ms`; resolves when the lock is held. `done` resolves when it let go. */
export async function holdWriteLock(ms: number): Promise<{ done: Promise<number> }> {
  const holder = Bun.spawn({
    cmd: ["bun", "-e", `const { Database } = require("bun:sqlite"); const d = new Database(process.argv[1]); d.exec("PRAGMA busy_timeout = 5000"); d.exec("BEGIN IMMEDIATE"); d.exec("UPDATE people SET display_name = display_name"); console.log("held"); await Bun.sleep(${Math.floor(ms)}); d.exec("COMMIT");`, dbPath],
    stdout: "pipe", stderr: "inherit",
  });
  await holder.stdout.getReader().read();
  return { done: holder.exited };
}

/** Milliseconds `sqlite` waited for `BEGIN IMMEDIATE` while another process held the write lock. Throws "database is locked"
 * at once (about 0 ms) when the connection has a statement left open. */
export async function waitForForeignWriteLock(sqlite: Database, ms = 300): Promise<number> {
  sqlite.exec("UPDATE people SET display_name = display_name"); // a write first, as the next test's resetDb() does: a statement left open turns it into a stale read snapshot
  const lock = await holdWriteLock(ms);
  const started = performance.now();
  try {
    sqlite.exec("BEGIN IMMEDIATE");
    sqlite.exec("COMMIT");
  } finally {
    await lock.done;
  }
  return performance.now() - started;
}
