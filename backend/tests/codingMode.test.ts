import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { codingModeReadiness } from "@/lib/codingMode";
import { setHouseholdSettingValue } from "@/lib/settings";
import { CODING_STACK_MAP } from "@/lib/stackCodingSync";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { resetDb } from "./reset-db";

const response = (overrides: Record<string, unknown> = {}) => ({
  mode: "normal", target: "normal", state: "stable", reason: null, available: true,
  checks: { engine: true, pieces: true, hardware: true, memory: true, bench: true },
  self_test: { passed_at: "2026-10-22T10:00:00Z", stale: false }, memory: { plan_bytes: 1, budget_bytes: 2 }, ...overrides,
});
beforeEach(() => { resetDb(); setHouseholdSettingValue("engines.stack.url", "http://127.0.0.1:8770"); });
afterEach(() => __resetStackEngineForTests());

describe("coding mode readiness", () => {
  test("reports Stack check failures as ordered readiness items", async () => {
    __setStackClientForTests({ getCodingMode: async () => response({ checks: { engine: false, pieces: false, hardware: false, memory: false, bench: false } }), roles: async () => ({ roles: [{ id: "coding", state: { state: "installed" } }] }) } as never);
    const value = await codingModeReadiness();
    expect(value.items.map((item) => item.id)).toEqual(["coding_enabled", "engine", "pieces", "hardware", "memory", "self_test", "client", "bench"]);
    expect(value.items.slice(1, 5).map((item) => item.state)).toEqual(["manual", "can_do", "manual", "manual"]);
    expect(value.items[7]?.state).toBe("manual");
    expect(value.ready).toBe(false);
    expect(value.first_unmet).toBe("coding_enabled");
  });

  test("classifies every combination of Stack check results", async () => {
    for (let mask = 0; mask < 32; mask++) {
      const checks = Object.fromEntries(["engine", "pieces", "hardware", "memory", "bench"].map((id, bit) => [id, Boolean(mask & (1 << bit))]));
      __setStackClientForTests({ getCodingMode: async () => response({ checks }), roles: async () => ({ roles: [{ id: "coding", state: { state: "installed" } }] }) } as never);
      const value = await codingModeReadiness();
      const states = Object.fromEntries(value.items.map((item) => [item.id, item.state]));
      expect(states.engine).toBe(checks.engine ? "done" : "manual");
      expect(states.pieces).toBe(checks.pieces ? "done" : "can_do");
      expect(states.hardware).toBe(checks.hardware ? "done" : "manual");
      expect(states.memory).toBe(checks.memory ? "done" : "manual");
      expect(states.bench).toBe(checks.bench ? "done" : "manual");
    }
  });

  test("Stack outage fails closed and the setting is not a pushed coding value", async () => {
    __setStackClientForTests({ getCodingMode: async () => { throw new Error("offline"); } } as never);
    const value = await codingModeReadiness();
    expect(value.ready).toBe(false);
    expect(value.items.filter((item) => ["engine", "pieces", "hardware", "memory", "self_test", "bench"].includes(item.id)).every((item) => item.state === "manual")).toBe(true);
    expect(CODING_STACK_MAP.some((entry) => entry.home === "coding.home_mode")).toBe(false);
  });
});
