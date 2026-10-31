import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { codingModeReadiness } from "@/lib/codingMode";
import { getHouseholdSettingValue, setHouseholdSettingValue } from "@/lib/settings";
import { CODING_STACK_MAP } from "@/lib/stackCodingSync";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { StackError } from "@/lib/stack/errors";
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";
import { invalidateSessionCacheForPerson } from "@/middleware/auth";

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

describe("coding mode self-test route", () => {
  test("returns 202 when the Stack accepts the test and does not write a setting", async () => {
    const client = new TestClient(); await client.post("/api/auth/setup", {displayName:"Sage",secret:"correcthorse"});
    __setStackClientForTests({ runCodingModeSelfTest: async () => {} } as never);
    const response = await client.post("/api/coding/mode/self-test", {});
    expect(response.status).toBe(202); expect(await response.json()).toEqual({accepted:true});
    expect(getHouseholdSettingValue("coding.home_mode")).toBe("normal");
  });

  test("passes through a Stack refusal as 409, maps an outage to plain 503 words, and is admin only", async () => {
    const client = new TestClient(); await client.post("/api/auth/setup", {displayName:"Sage",secret:"correcthorse"});
    __setStackClientForTests({ runCodingModeSelfTest: async () => { throw new StackError("unverified", "The coding model is not available while a mode switch is running.", {status:409}); } } as never);
    const refused = await client.post("/api/coding/mode/self-test", {});
    expect(refused.status).toBe(409); expect(await refused.json()).toEqual({error:"The coding model is not available while a mode switch is running."});
    __setStackClientForTests({ runCodingModeSelfTest: async () => { throw new Error("offline"); } } as never);
    const down = await client.post("/api/coding/mode/self-test", {});
    expect(down.status).toBe(503); expect(await down.json()).toEqual({error:"Home could not reach the AI engine."});
    expect((await new TestClient().post("/api/coding/mode/self-test", {})).status).toBe(401);
    const actor = db.select().from(people).where(eq(people.displayName,"Sage")).get()!;
    db.update(people).set({role:"adult"}).where(eq(people.id,actor.id)).run(); invalidateSessionCacheForPerson(actor.id);
    expect((await client.post("/api/coding/mode/self-test", {})).status).toBe(403);
  });
});

describe("the retired Home mode switch (TIER-HOME-05)", () => {
  test("saving coding.home_mode is refused and the Stack is never asked to switch", async () => {
    const client = new TestClient(); await client.post("/api/auth/setup", {displayName:"Sage",secret:"correcthorse"});
    let switches = 0;
    __setStackClientForTests({ getCodingMode: async () => response({ mode: "normal", target: "normal" }), setCodingMode: async () => { switches++; } } as never);
    const saved = await client.put("/api/settings", {scope:"household", key:"coding.home_mode", value:"coding"});
    expect(saved.status).toBe(400);
    expect(switches).toBe(0);
    expect(getHouseholdSettingValue("coding.home_mode")).toBe("normal");
  });

  test("startup returns a Stack left in coding mode to normal when no lease is held, and clears a stored switch", async () => {
    const { reconcileCodingModeAtStartup } = await import("@/lib/codingMode");
    setHouseholdSettingValue("coding.home_mode", "coding");
    const sent: string[] = [];
    __setStackClientForTests({ getCodingMode: async () => response({ mode: "coding", target: "coding", state: "stable" }), setCodingMode: async (mode: string) => { sent.push(mode); } } as never);
    await reconcileCodingModeAtStartup();
    expect(sent).toEqual(["normal"]);
    expect(getHouseholdSettingValue("coding.home_mode")).toBe("normal");
  });
});
