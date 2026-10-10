import { describe, expect, test } from "bun:test";
import { ChatTurnError } from "@/apps/chat/chatTurnError";

describe("ChatTurnError", () => {
  test("is an instance of Error", () => {
    const error = new ChatTurnError("test message", "TEST_CODE", "turn-123");
    expect(error).toBeInstanceOf(Error);
  });

  test("is an instance of ChatTurnError", () => {
    const error = new ChatTurnError("test message", "TEST_CODE", "turn-123");
    expect(error).toBeInstanceOf(ChatTurnError);
  });

  test("name is ChatTurnError", () => {
    const error = new ChatTurnError("test message", "TEST_CODE", "turn-123");
    expect(error.name).toBe("ChatTurnError");
  });

  test("message is kept", () => {
    const error = new ChatTurnError("test message", "TEST_CODE", "turn-123");
    expect(error.message).toBe("test message");
  });

  test("code is kept", () => {
    const error = new ChatTurnError("test message", "TEST_CODE", "turn-123");
    expect(error.code).toBe("TEST_CODE");
  });

  test("turnId is kept when given", () => {
    const error = new ChatTurnError("test message", "TEST_CODE", "turn-123");
    expect(error.turnId).toBe("turn-123");
  });

  test("turnId is undefined when not given", () => {
    const error = new ChatTurnError("test message", "TEST_CODE");
    expect(error.turnId).toBeUndefined();
  });
});
