// CODE-STACK-01 H2: a Home coding setting change reaches the Stack call. A fake Stack client records what Home sends.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setHouseholdSettingValue } from "@/lib/settings";
import { CODING_STACK_MAP, __setCodingSyncClientForTests, codingStackValues, pushCodingSettings } from "@/lib/stackCodingSync";
import { getRegistryKey } from "@/lib/settingsRegistry";
import type { StackClient } from "@/lib/stack/client";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

let puts: Array<Record<string, unknown>>;
let promotes: number;
let pending: string[];
let fail: boolean;
type Answer = Awaited<ReturnType<NonNullable<StackClient["updateSettings"]>>>;
const answer = (): Answer => ({ sections: [], settings: pending.map((key) => ({ key, pending: 1 })) as unknown as Answer["settings"] });

beforeEach(() => {
  resetDb(); puts = []; promotes = 0; pending = []; fail = false;
  __setCodingSyncClientForTests({
    updateSettings: async (values) => { if (fail) throw new Error("refused"); puts.push(values); return answer(); },
    promotePendingSettings: async () => { promotes++; pending = []; return answer(); },
  });
});
afterEach(() => __setCodingSyncClientForTests(null));

async function owner() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  return client;
}
const put = (client: TestClient, key: string, value: unknown) => client.request("/api/settings", { method: "PUT", body: { scope: "household", key, value } });

describe("the map", () => {
  test("every Home key is a declared household key and every Stack key is the Stack's coding key", () => {
    for (const entry of CODING_STACK_MAP) {
      expect(getRegistryKey(entry.home)?.scope).toBe("household");
      expect(entry.stack.startsWith("stack.engines.coding.")).toBe(true);
    }
    expect(CODING_STACK_MAP.map((entry) => entry.stack.split(".").pop()).sort()).toEqual(["engine", "keep_warm_minutes", "splash_cache_gb", "thinking_budget_ceiling", "yield_to_chat"]);
  });
  test("defaults are the Stack's defaults and values are clamped to the Stack's ranges", () => {
    expect(codingStackValues()).toEqual({
      "stack.engines.coding.keep_warm_minutes": 15, "stack.engines.coding.thinking_budget_ceiling": 2000, "stack.engines.coding.yield_to_chat": true,
      "stack.engines.coding.engine": "auto", "stack.engines.coding.splash_cache_gb": 8,
    });
    setHouseholdSettingValue("coding.keep_warm_minutes", 0);
    setHouseholdSettingValue("coding.splash_cache_gb", 64);
    setHouseholdSettingValue("coding.thinking_budget_ceiling", 99999);
    expect(codingStackValues(["coding.keep_warm_minutes", "coding.splash_cache_gb", "coding.thinking_budget_ceiling"])).toEqual({
      "stack.engines.coding.keep_warm_minutes": 1, "stack.engines.coding.splash_cache_gb": 64, "stack.engines.coding.thinking_budget_ceiling": 32768,
    });
  });
});

describe("a Home settings change reaches the Stack call", () => {
  test("saving the keep-warm minutes sends the Stack key with the new value", async () => {
    const client = await owner();
    const res = await put(client, "coding.keep_warm_minutes", 30);
    expect(res.status).toBe(200);
    expect(puts).toEqual([{ "stack.engines.coding.keep_warm_minutes": 30 }]);
    expect(promotes).toBe(0);
  });
  test("each of the five coding settings reaches its own Stack key", async () => {
    const client = await owner();
    const cases: Array<[string, unknown, string, unknown]> = [
      ["coding.thinking_budget_ceiling", 4000, "stack.engines.coding.thinking_budget_ceiling", 4000],
      ["coding.yield_to_chat", false, "stack.engines.coding.yield_to_chat", false],
      ["coding.engine", "llama-server", "stack.engines.coding.engine", "llama-server"],
      ["coding.splash_cache_gb", 16, "stack.engines.coding.splash_cache_gb", 16],
      ["coding.keep_warm_minutes", 5, "stack.engines.coding.keep_warm_minutes", 5],
    ];
    for (const [home, value, stack, sent] of cases) {
      expect((await put(client, home, value)).status).toBe(200);
      expect(puts.at(-1)).toEqual({ [stack]: sent });
    }
  });
  test("a reset to default sends the default", async () => {
    const client = await owner();
    await put(client, "coding.splash_cache_gb", 32);
    const res = await client.post("/api/settings/reset", { scope: "household", key: "coding.splash_cache_gb" });
    expect(res.status).toBe(200);
    expect(puts.at(-1)).toEqual({ "stack.engines.coding.splash_cache_gb": 8 });
  });
  test("a setting the Stack does not read sends nothing", async () => {
    const client = await owner();
    await put(client, "coding.enabled", true);
    await put(client, "coding.adults_by_default", false);
    expect(puts).toEqual([]);
  });
  test("a setting that needs a restart is promoted only when every pending Stack value is a coding one", async () => {
    const client = await owner();
    pending = ["stack.engines.coding.engine"];
    await put(client, "coding.engine", "splash");
    expect(promotes).toBe(1);
    pending = ["stack.engines.coding.engine", "stack.engines.chat.engine"];
    await put(client, "coding.engine", "llama-server");
    expect(promotes).toBe(1);
  });
  test("a Stack that is away never fails the save; Home keeps the value and sends it on the next push", async () => {
    const client = await owner();
    fail = true;
    const res = await put(client, "coding.keep_warm_minutes", 20);
    expect(res.status).toBe(200);
    expect(await pushCodingSettings(["coding.keep_warm_minutes"])).toMatchObject({ skipped: "unreachable" });
    fail = false;
    expect(await pushCodingSettings()).toMatchObject({ pushed: expect.arrayContaining(["stack.engines.coding.keep_warm_minutes"]) });
    expect(puts.at(-1)!["stack.engines.coding.keep_warm_minutes"]).toBe(20);
  });
  test("only an admin can change a household setting, so a plain adult's write reaches no Stack call", async () => {
    const client = await owner();
    const { db } = await import("@/db");
    const { people } = await import("@/db/schema");
    const { invalidateSessionCacheForPerson } = await import("@/middleware/auth");
    const actor = db.select().from(people).get()!;
    db.update(people).set({ role: "adult" }).where((await import("drizzle-orm")).eq(people.id, actor.id)).run();
    invalidateSessionCacheForPerson(actor.id);
    const res = await put(client, "coding.keep_warm_minutes", 3);
    expect(res.status).toBe(403);
    expect(puts).toEqual([]);
  });
});
