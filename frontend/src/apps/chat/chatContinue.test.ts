import { describe, expect, test } from "bun:test";
import { setPendingContinuation, consumeContinuation } from "@/apps/chat/chatContinue";

describe("chatContinue", () => {
  test("nothing pending gives undefined", () => {
    expect(consumeContinuation()).toBeUndefined();
  });

  test("a set value is returned once with assistantText and fromTurnId intact", () => {
    const value: import("./chatContinue").PendingContinuation = {
      assistantText: "hello world",
      fromTurnId: "abc-123",
    };
    setPendingContinuation(value);
    const result = consumeContinuation();
    expect(result).toEqual(value);
  });

  test("a second consume gives undefined", () => {
    setPendingContinuation({ assistantText: "after" });
    consumeContinuation();
    expect(consumeContinuation()).toBeUndefined();
  });

  test("setting null clears a pending value", () => {
    setPendingContinuation({ assistantText: "will be gone" });
    consumeContinuation();
    expect(consumeContinuation()).toBeUndefined();
    setPendingContinuation(null);
    expect(consumeContinuation()).toBeUndefined();
  });

  test("a later set replaces an earlier one", () => {
    setPendingContinuation({ assistantText: "first", fromTurnId: "t1" });
    setPendingContinuation({ assistantText: "second", fromTurnId: "t2" });
    expect(consumeContinuation()).toEqual({ assistantText: "second", fromTurnId: "t2" });
  });
});
