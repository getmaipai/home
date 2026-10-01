import { afterEach, describe, expect, test } from "bun:test";
import { engineWarmupsForStackRoles } from "@/lib/engineBoot";
import { __resetStackEngineForTests } from "@/lib/stackEngine";
import { resetDb } from "./reset-db";
import { setHouseholdSettingValue } from "@/lib/settings";

afterEach(() => {
  resetDb();
  __resetStackEngineForTests();
});

describe("engine boot warm-ups", () => {
  test("warms no Home engines when the Stack is configured", () => {
    setHouseholdSettingValue("engines.stack.url", "http://127.0.0.1:8780");
    expect(engineWarmupsForStackRoles()).toEqual([]);
  });

  test("keeps Home warm-ups when no Stack is configured", () => {
    setHouseholdSettingValue("engines.stack.url", "");
    expect(engineWarmupsForStackRoles()).toEqual(["chat", "embed", "tts"]);
  });
});
