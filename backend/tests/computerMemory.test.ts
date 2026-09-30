import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { describeComputerMemory } from "@/lib/computerMemory";
import type { BudgetResponse } from "@/lib/stack/types";
import { roleNames } from "../../frontend/src/lib/fitPanel";

function budget(loaded: BudgetResponse["loaded"], pressure: BudgetResponse["pressure"] = "normal"): BudgetResponse {
  return { totalMemoryBytes: 32 * 1024 ** 3, capBytes: 16 * 1024 ** 3, freeMemoryBytes: 8 * 1024 ** 3, availablePercent: 50, pressure, memoryReadingDegraded: false, loaded, queue: [] };
}
const model = (id: string, peakBytes: number) => ({ id, kind: "resident" as const, peakBytes, measured: true, lastUsedAt: "2026-09-30T00:00:00Z", idleTtlSeconds: 60, pinned: false, pid: 1 });

describe("describeComputerMemory", () => {
  test("describes an empty loaded list", () => {
    expect(describeComputerMemory(budget([]))).toEqual({ usableGb: 16, usedGb: 0, freeGb: 16, pressure: "normal", pressureText: "Plenty of room right now.", loaded: [] });
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
  test.each([["normal", "Plenty of room right now."], ["warn", "Memory is getting tight."], ["critical", "Memory is very tight."]] as const)("words %s pressure", (pressure, text) => {
    expect(describeComputerMemory(budget([], pressure)).pressureText).toBe(text);
  });
});
