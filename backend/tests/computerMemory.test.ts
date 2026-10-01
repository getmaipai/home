import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { describeComputerMemory } from "@/lib/computerMemory";
import type { BudgetResponse } from "@/lib/stack/types";
import { roleNames } from "../../frontend/src/lib/fitPanel";
import { getHomeOwnedRoles, __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { setHouseholdSettingValue } from "@/lib/settings";
import { resetDb } from "./reset-db";

function budget(loaded: BudgetResponse["loaded"], pressure: BudgetResponse["pressure"] = "normal"): BudgetResponse {
  return { totalMemoryBytes: 32 * 1024 ** 3, capBytes: 16 * 1024 ** 3, freeMemoryBytes: 8 * 1024 ** 3, availablePercent: 50, pressure, memoryReadingDegraded: false, loaded, queue: [] };
}
const model = (id: string, peakBytes: number) => ({ id, kind: "resident" as const, peakBytes, measured: true, lastUsedAt: "2026-09-30T00:00:00Z", idleTtlSeconds: 60, pinned: false, pid: 1 });

describe("describeComputerMemory", () => {
  beforeEach(() => resetDb());
  afterEach(() => __resetStackEngineForTests());
  test("describes an empty loaded list", () => {
    expect(describeComputerMemory(budget([]))).toEqual({ usableGb: 16, usedGb: 0, freeGb: 16, pressure: "normal", pressureText: "This computer has plenty of free memory right now.", loaded: [], homeOwnedRoles: [] });
  });
  test("reports all roles as Home-owned when all Stack switches are off", () => {
    setHouseholdSettingValue("engines.stack.url", "http://127.0.0.1:8770");
    for (const role of ["chat", "embeddings", "stt", "tts"] as const) setHouseholdSettingValue(`engines.stack.use_${role}`, false);
    expect(describeComputerMemory(budget([]), getHomeOwnedRoles()).homeOwnedRoles).toEqual(["chat", "embeddings", "stt", "tts"]);
  });
  test("reports only Home-owned roles when two Stack switches are on", () => {
    setHouseholdSettingValue("engines.stack.url", "http://127.0.0.1:8770");
    setHouseholdSettingValue("engines.stack.use_chat", true);
    setHouseholdSettingValue("engines.stack.use_embeddings", true);
    expect(describeComputerMemory(budget([]), getHomeOwnedRoles()).homeOwnedRoles).toEqual(["stt", "tts"]);
  });
  test("reports no Home-owned roles when every Stack switch is on", () => {
    setHouseholdSettingValue("engines.stack.url", "http://127.0.0.1:8770");
    for (const role of ["chat", "embeddings", "stt", "tts"] as const) setHouseholdSettingValue(`engines.stack.use_${role}`, true);
    expect(describeComputerMemory(budget([]), getHomeOwnedRoles()).homeOwnedRoles).toEqual([]);
  });
  test("a test client counts every role as Stack-owned", () => {
    __setStackClientForTests({} as never);
    expect(describeComputerMemory(budget([]), getHomeOwnedRoles()).homeOwnedRoles).toEqual([]);
  });
  test("sums two loaded roles and rounds GiB to one decimal", () => {
    const result = describeComputerMemory(budget([model("chat", 5.14 * 1024 ** 3), model("embed", 1.06 * 1024 ** 3)]));
    expect(result.usedGb).toBe(6.2);
    expect(result.freeGb).toBe(9.8);
    expect(result.loaded).toEqual([{ id: "chat", label: "Chat", gb: 5.1 }, { id: "embed", label: "Search", gb: 1.1 }]);
  });
  test("uses a role name for known ids and preserves an unknown id", () => {
    const result = describeComputerMemory(budget([model("chat", 1), model("unknown-role", 2)]));
    expect(result.loaded.map(({ label }) => label)).toEqual(["Chat", "unknown-role"]);
  });
  test("keeps frontend fit role names in sync", () => {
    const source = readFileSync(new URL("../../frontend/src/lib/fitPanel.ts", import.meta.url), "utf8");
    const normalized = source.replace(/"([a-z-]+)":/g, "$1:");
    for (const [id, label] of Object.entries(roleNames)) expect(normalized).toContain(`${id}: "${label}"`);
    const result = describeComputerMemory(budget(Object.keys(roleNames).map((id) => model(id, 1))));
    expect(result.loaded.map((item) => item.label)).toEqual(Object.values(roleNames));
  });
  test.each([["normal", "This computer has plenty of free memory right now."], ["warn", "This computer's memory is getting tight right now."], ["critical", "This computer's memory is very tight right now."]] as const)("words %s pressure", (pressure, text) => {
    expect(describeComputerMemory(budget([], pressure)).pressureText).toBe(text);
  });
});
