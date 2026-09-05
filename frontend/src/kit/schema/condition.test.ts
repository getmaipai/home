import { describe, expect, test } from "bun:test";
import { evaluateCondition } from "@/kit/schema/condition";

describe("evaluateCondition", () => {
  test("no condition means always shown", () => {
    expect(evaluateCondition(undefined, {})).toBe(true);
  });

  test("a bare dotted path is a truthy check", () => {
    expect(evaluateCondition("canManage", { canManage: true })).toBe(true);
    expect(evaluateCondition("canManage", { canManage: false })).toBe(false);
    expect(evaluateCondition("nested.flag", { nested: { flag: true } })).toBe(true);
  });

  test("a negated path", () => {
    expect(evaluateCondition("!canManage", { canManage: true })).toBe(false);
    expect(evaluateCondition("!canManage", { canManage: false })).toBe(true);
  });

  test("an equality check", () => {
    expect(evaluateCondition("role == 'owner'", { role: "owner" })).toBe(true);
    expect(evaluateCondition("role == 'owner'", { role: "admin" })).toBe(false);
  });

  test("a negated equality check", () => {
    expect(evaluateCondition("!role == 'owner'", { role: "owner" })).toBe(false);
    expect(evaluateCondition("!role == 'owner'", { role: "admin" })).toBe(true);
  });
});
