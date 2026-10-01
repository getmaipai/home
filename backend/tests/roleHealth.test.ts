import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { roleHealth } from "@/lib/roleHealth";

beforeEach(() => resetDb());
afterEach(() => __resetStackEngineForTests());

function client(roles: Array<{ id: string; state: { state: string; reason?: string | null }; reason?: string | null }>, fail = false) {
  __setStackClientForTests({ roles: async () => { if (fail) throw new Error("offline"); return { roles }; } } as never);
}

describe("roleHealth", () => {
  test("Stack-owned chat uses the Stack role state", async () => {
    setHouseholdSettingValue("engines.stack.url", "http://127.0.0.1:8770");
    client([{ id: "chat", state: { state: "offline", reason: "model crashed" }, reason: "model crashed" }]);
    expect(await roleHealth("chat")).toMatchObject({ availability: "unavailable", reason: "model crashed" });
  });

  test("Stack fetch failure makes owned roles unavailable with stack unreachable reason", async () => {
    setHouseholdSettingValue("engines.stack.url", "http://127.0.0.1:8770");
    client([], true);
    expect(await roleHealth("chat")).toEqual({ availability: "unavailable", reason: "stack_unreachable" });
  });

  test("Stack ready is operational for chat and embeddings", async () => {
    setHouseholdSettingValue("engines.stack.url", "http://127.0.0.1:8770");
    client([{ id: "chat", state: { state: "ready", reason: null }, reason: null }]);
    expect(await roleHealth("chat")).toEqual({ availability: "ready", reason: null });
    expect(await roleHealth("embed")).toMatchObject({ availability: expect.any(String) });
  });
});
