import { describe, expect, test } from "bun:test";
import { stripThinking } from "@/apps/chat/ChatPage";

describe("stripThinking", () => {
  test("removes a <think> block ahead of the real answer", () => {
    expect(stripThinking("<think>let me work this out</think>The answer is 42.")).toBe("The answer is 42.");
  });

  test("passes plain text through unchanged", () => {
    expect(stripThinking("The capital of France is Paris.")).toBe("The capital of France is Paris.");
  });

  // A code review (2026-09-04) found the original `|| text` fallback
  // defeated the whole point here: a reasoning-only reply (no final
  // answer after </think>) strips to "", which is falsy, so `|| text`
  // re-surfaced the raw, un-stripped <think> block it exists to hide.
  test("a reasoning-only reply (nothing after </think>) never re-surfaces the raw block", () => {
    const result = stripThinking("<think>thinking forever and never answering</think>");
    expect(result).not.toContain("<think>");
    expect(result).not.toContain("thinking forever");
  });
});
