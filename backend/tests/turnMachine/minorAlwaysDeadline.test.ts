// MINOR-DEADLINE-01 (owner call, 2026-10-17): on a model whose template reasons on every turn
// (Muse Glimmer 30B) a child's or teen's wall-clock deadlines are raised so a safety-shaped
// question is not cut off with "That took me too long"; an adult and a model that can switch
// thinking off keep their record's figures.
import { beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "../reset-db";
import { useDefaultScriptedStack } from "../stackFixture";
import { CATALOG } from "@/lib/modelCatalog";
import { MINOR_ALWAYS_THINKING_DEADLINES_MS, resolveTurnBudgetWithStack } from "@/lib/turnMachine/budget";

const ALWAYS = "muse-glimmer-30b-q4-k-xl";
const SWITCHABLE = "qwen3-8b-instruct-q4-k-m";
const record = (id: string) => CATALOG.find((m) => m.id === id)!.turn_budget!.deadlines_ms;

beforeEach(() => {
  resetDb();
  useDefaultScriptedStack();
});

describe("MINOR-DEADLINE-01: a minor's deadline on a model that always reasons", () => {
  test("a teen and a child get the raised model and total deadlines", async () => {
    for (const band of ["teen", "child"] as const) {
      const d = (await resolveTurnBudgetWithStack(ALWAYS, band)).deadlines_ms;
      expect(d.model).toBe(MINOR_ALWAYS_THINKING_DEADLINES_MS.model);
      expect(d.total).toBe(MINOR_ALWAYS_THINKING_DEADLINES_MS.total);
      expect(d.model).toBeGreaterThan(record(ALWAYS).model);
    }
  });

  test("an adult keeps the record's figures", async () => {
    const d = (await resolveTurnBudgetWithStack(ALWAYS, "adult")).deadlines_ms;
    expect(d.model).toBe(record(ALWAYS).model);
    expect(d.total).toBe(record(ALWAYS).total);
  });

  test("a model that can switch thinking off keeps its record's figures for a teen", async () => {
    const d = (await resolveTurnBudgetWithStack(SWITCHABLE, "teen")).deadlines_ms;
    expect(d.model).toBe(record(SWITCHABLE).model);
    expect(d.total).toBe(record(SWITCHABLE).total);
  });

  test("the catalog record itself is never mutated", async () => {
    const before = { ...record(ALWAYS) };
    await resolveTurnBudgetWithStack(ALWAYS, "teen");
    expect(record(ALWAYS)).toEqual(before);
  });
});
