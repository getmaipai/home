import { afterEach, describe, expect, test } from "bun:test";
import { engineWarmupsForStackRoles } from "@/lib/engineBoot";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { resetDb } from "./reset-db";
import { restoreDefaultScriptedStack } from "./stackFixture";
import { setHouseholdSettingValue } from "@/lib/settings";

afterEach(() => {
  resetDb();
  __resetStackEngineForTests();
  restoreDefaultScriptedStack();
});

describe("engine boot warm-ups", () => {
  test("warms no Home engines when the Stack is configured", () => {
    setHouseholdSettingValue("engines.stack.url", "http://127.0.0.1:8780");
    expect(engineWarmupsForStackRoles()).toEqual([]);
  });

  test("warms no Home owned roles when no Stack is configured", () => {
    setHouseholdSettingValue("engines.stack.url", "");
    __setStackClientForTests(null);
    expect(engineWarmupsForStackRoles()).toEqual([]);
  });
});
