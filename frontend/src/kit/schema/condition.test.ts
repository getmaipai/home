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

  // A code review (2026-09-05) found an unsupported operator silently
  // fell through to the bare-path truthy check, which - since the whole
  // expression string never matches a real field - just always evaluated
  // to false, with nothing pointing at the actual mistake.
  test("an unsupported operator throws rather than silently rendering as always-hidden", () => {
    expect(() => evaluateCondition("status != 'archived'", { status: "active" })).toThrow(/unsupported condition/);
    expect(() => evaluateCondition("count > 0", { count: 1 })).toThrow(/unsupported condition/);
    expect(() => evaluateCondition("a && b", { a: true, b: true })).toThrow(/unsupported condition/);
  });
});
