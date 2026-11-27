// PRIVACY-LEVEL-PROOF-01: one function answers "may this class of data be saved for this chat"; every persistence point is listed and its
// guard calls that function. Extends THIN-INC (the per-row temporary tests), does not repeat them.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { mayRetain, RETENTION_POINTS, RETENTION_TABLES } from "@/lib/gate/retention";

const SRC = join(import.meta.dir, "..", "src");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") && !p.endsWith(".test.ts") ? [p] : [];
  });
}

describe("mayRetain", () => {
  test("a normal chat keeps everything", () => {
    for (const cls of ["memory", "transcript", "attachment", "tool_audit"] as const) expect(mayRetain(cls, { temporary: false, band: "adult" })).toBe(true);
  });
  test("a temporary chat keeps nothing for an adult", () => {
    for (const cls of ["memory", "transcript", "attachment", "tool_audit", "safety_trail"] as const) expect(mayRetain(cls, { temporary: true, band: "adult" })).toBe(false);
  });
  test("a minor's temporary chat still keeps the safety trail and nothing else", () => {
    for (const band of ["child", "teen"] as const) {
      expect(mayRetain("safety_trail", { temporary: true, band })).toBe(true);
      expect(mayRetain("transcript", { temporary: true, band })).toBe(false);
      expect(mayRetain("memory", { temporary: true, band })).toBe(false);
    }
  });
  test("a tool audit row in a minor's temporary chat is the safety trail, so it stays", () => {
    expect(mayRetain("tool_audit", { temporary: true, band: "child" })).toBe(true);
    expect(mayRetain("tool_audit", { temporary: true, band: "adult" })).toBe(false);
  });
});

describe("every persistence point is listed and guarded", () => {
  const all = files(SRC);
  test("each listed point's guard file calls mayRetain with its class", () => {
    for (const point of RETENTION_POINTS) {
      const text = readFileSync(join(SRC, point.guard), "utf8").split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join("\n");
      expect(text.includes(`mayRetain("${point.class}", {`), `${point.id}: ${point.guard} must call mayRetain("${point.class}", ...)`).toBe(true);
    }
  });
  test("a file that writes a chat-data table is a listed writer (a new saving path fails here)", () => {
    const listed = new Set(RETENTION_POINTS.flatMap((p) => p.writers));
    const unlisted: string[] = [];
    for (const file of all) {
      const rel = relative(SRC, file);
      if (rel.startsWith("db/") || rel.startsWith("lib/gate/retention.ts")) continue;
      const text = readFileSync(file, "utf8");
      for (const table of RETENTION_TABLES) {
        // Any receiver (db, tx, a transaction handle): the table name is what counts.
        if (new RegExp(`\\.insert\\(\\s*${table}\\s*\\)`).test(text) && !listed.has(rel)) unlisted.push(`${rel} writes ${table}`);
      }
    }
    expect(unlisted).toEqual([]);
  });
  test("a listed writer still exists", () => {
    for (const rel of new Set(RETENTION_POINTS.flatMap((p) => p.writers))) expect(all.map((f) => relative(SRC, f))).toContain(rel);
  });
});

import { recordToolAudit, listOwnToolAudit } from "@/lib/toolAudit";
import { resetDb } from "./reset-db";
import { createBenchPeople } from "../scripts/bench/conversationRunner";

describe("tool audit in a temporary chat", () => {
  test("an adult's temporary tool call leaves no row; a normal one does", () => {
    resetDb();
    const owner = createBenchPeople().owner;
    recordToolAudit({ personId: owner.id, tool: "remind", action: "add", decision: "do", band: "adult", temporary: true });
    expect(listOwnToolAudit(owner.id, 5)).toHaveLength(0);
    recordToolAudit({ personId: owner.id, tool: "remind", action: "add", decision: "do", band: "adult" });
    expect(listOwnToolAudit(owner.id, 5)).toHaveLength(1);
  });
  test("a minor's temporary tool call keeps its row (the safety trail)", () => {
    resetDb();
    const owner = createBenchPeople().owner;
    recordToolAudit({ personId: owner.id, tool: "remind", action: "add", decision: "do", band: "child", temporary: true });
    expect(listOwnToolAudit(owner.id, 5)).toHaveLength(1);
  });
});
