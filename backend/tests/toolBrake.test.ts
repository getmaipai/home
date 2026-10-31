import { describe, expect, test } from "bun:test";
import { brakeFor } from "@/lib/toolBrake";
import { getRegistry } from "@/lib/settingsRegistry";

describe("brakeFor", () => {
  const base = { tool: "remind" as const, args: {}, actor: { id: "a", role: "adult", band: "adult" as const }, mode: "do" as const, tainted: false };
  const cases = [
    ["delete asks", { action: "delete" }, "ask"],
    ["clear asks", { action: "clear_list", tool: "lists", listScope: "person" }, "ask"],
    ["five items do", { action: "move", itemCount: 5 }, "do"],
    ["six items ask", { action: "move", itemCount: 6 }, "ask"],
    ["never mode", { action: "create", mode: "never" }, "never"],
    ["ask mode", { action: "create", mode: "ask" }, "ask"],
    ["tainted write asks", { action: "create", tainted: true }, "ask"],
    ["minor own record acts", { action: "delete", actor: { id: "c", role: "child", band: "child" } }, "do"],
    ["minor household delete refuses", { action: "delete_list", tool: "lists", listScope: "household", actor: { id: "c", role: "child", band: "child" } }, "never"],
    ["minor household clear refuses", { action: "clear_list", tool: "lists", listScope: "household", actor: { id: "t", role: "teen", band: "teen" } }, "never"],
    ["unknown speaker refuses", { action: "create", actor: { id: "unknown", role: "guest", band: "child" } }, "never"],
    ["adult household delete asks", { action: "delete_list", tool: "lists", listScope: "household" }, "ask"],
  ] as const;
  for (const [name, overrides, decision] of cases) test(name, () => {
    expect(brakeFor({ ...base, ...overrides } as Parameters<typeof brakeFor>[0]).decision).toBe(decision);
  });
  test("minor household delete names parent_required", () => {
    expect(brakeFor({ ...base, tool: "lists", action: "delete_list", listScope: "household", actor: { id: "c", role: "child", band: "child" } }).reason).toBe("parent_required");
  });
  test("settings keys exist with default do", () => {
    for (const key of ["tools.remind.mode", "tools.timer.mode", "tools.lists.mode"]) {
      expect(getRegistry().find((entry) => entry.key === key)).toMatchObject({ default: "do", scope: "household" });
    }
  });
});
