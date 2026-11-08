// Shard pollution (the lander's safety shard, 2026-11-07): scheduler.test.ts's EXPLAIN QUERY PLAN left a statement open on the
// hub's connection, and every later file that waited out a foreign write lock (attachments) or wrote after another connection
// had (people, places, ...) failed "database is locked", then the files that had not restored `fetch` failed too.
// tests/openStatements.ts says why. This file proves the helper leaves the connection free and that no test or source file
// goes back to the two leaking shapes.
import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sqlite } from "@/db";
import { explainPlan, waitForForeignWriteLock } from "./openStatements";

describe("open statements on the hub connection", () => {
  test("the connection waits out another process's write lock", async () => {
    expect(await waitForForeignWriteLock(sqlite, 250)).toBeGreaterThanOrEqual(150);
  });

  test("explainPlan leaves nothing open", async () => {
    const plan = explainPlan(sqlite, "SELECT * FROM scheduled_jobs WHERE status = 'pending' AND next_run_at <= ?", "z");
    expect(plan.join(" ")).toContain("scheduled_jobs_status_next_run_idx");
    expect(await waitForForeignWriteLock(sqlite, 250)).toBeGreaterThanOrEqual(150);
  });

  test("a bare EXPLAIN through prepare() does leave one (why the helper exists)", async () => {
    const statement = sqlite.prepare("EXPLAIN QUERY PLAN SELECT * FROM scheduled_jobs WHERE status = 'pending'");
    let error: unknown = null;
    try {
      statement.all();
      try { await waitForForeignWriteLock(sqlite, 250); } catch (e) { error = e; }
    } finally {
      statement.finalize(); // frees the connection again for every file after this one
    }
    expect(String(error)).toContain("database is locked");
    expect(await waitForForeignWriteLock(sqlite, 100)).toBeGreaterThanOrEqual(50);
  });

  test("no backend test or source file runs EXPLAIN through a cached statement or leaves an iterate() loop early", () => {
    const root = join(import.meta.dir, "..");
    const offenders: string[] = [];
    for (const dir of ["tests", "src"]) {
      for (const file of new Glob("**/*.ts").scanSync({ cwd: join(root, dir) })) {
        if (file === "openStatementLeak.test.ts" || file === "openStatements.ts" || file.startsWith("shelf/")) continue; // shelf/ has its own database file
        const lines = readFileSync(join(root, dir, file), "utf8").split("\n");
        lines.forEach((line, index) => {
          if (/EXPLAIN\s+QUERY/i.test(line) && /\.(query|prepare)\(/.test(line)) offenders.push(`${dir}/${file}:${index + 1} EXPLAIN through query()/prepare(): use explainPlan() from tests/openStatements.ts`);
          if (dir === "src" && /\.iterate\(/.test(line) && !/^\s*\/\//.test(line)) offenders.push(`${dir}/${file}:${index + 1} iterate(): read with .all() so no statement is left open`);
        });
      }
    }
    expect(offenders).toEqual([]);
  });
});
