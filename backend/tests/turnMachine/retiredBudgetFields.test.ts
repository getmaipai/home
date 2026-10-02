// THIN-2B (rule 1): the forced-search budget fields are retired. Home no
// longer reads or declares `always_search` on the turn budget; the pinned
// spec still requires the field on a catalog record, so the record carries it
// as a deprecated, ignored value until the next spec tag removes it.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { NO_RECORD_BUDGET } from "@/lib/turnMachine/budget";
import { CATALOG } from "@/lib/modelCatalog";

const ROOT = join(import.meta.dir, "../../src/lib/turnMachine");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith(".ts") ? [path] : [];
  });
}

describe("the retired forced-search budget fields", () => {
  test("nothing under turnMachine/ reads or declares always_search or a query_writer budget field", () => {
    const offenders = sourceFiles(ROOT).filter((path) => /always_search|budget\.query_writer|query_writer\s*:\s*(boolean|true|false)/.test(readFileSync(path, "utf8")));
    expect(offenders).toEqual([]);
  });

  test("the budget a record-less model runs with does not carry always_search", () => {
    expect("always_search" in NO_RECORD_BUDGET).toBe(false);
  });

  test("the catalog's chat records still load with their budgets", () => {
    const chat = CATALOG.filter((m) => m.role === "chat" && m.turn_budget);
    expect(chat.length).toBeGreaterThan(0);
    for (const model of chat) expect(typeof model.turn_budget?.rounds).toBe("number");
  });
});
