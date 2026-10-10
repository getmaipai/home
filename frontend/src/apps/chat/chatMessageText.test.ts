import { describe, expect, test } from "bun:test";
import { messageText } from "@/apps/chat/chatMessageText";
import type { ThreadMessage } from "@assistant-ui/react";

describe("messageText", () => {
  test("undefined gives ''", () => {
    expect(messageText(undefined)).toBe("");
  });

  test("one text part gives its text", () => {
    const message = {
      role: "assistant" as const,
      content: [{ type: "text" as const, text: "Hello!" }],
    } as unknown as ThreadMessage;
    expect(messageText(message)).toBe("Hello!");
  });

  test("two text parts are joined with no separator", () => {
    const message = {
      role: "assistant" as const,
      content: [
        { type: "text" as const, text: "Hello" },
        { type: "text" as const, text: " world!" },
      ],
    } as unknown as ThreadMessage;
    expect(messageText(message)).toBe("Hello world!");
  });

  test("reasoning parts are ignored", () => {
    const message = {
      role: "assistant" as const,
      content: [
        { type: "text" as const, text: "Hello" },
        { type: "reasoning" as const, text: "Some reasoning text" },
      ],
    } as unknown as ThreadMessage;
    expect(messageText(message)).toBe("Hello");
  });

  test("tool-call parts are ignored", () => {
    const message = {
      role: "assistant" as const,
      content: [
        { type: "text" as const, text: "Hello" },
        { type: "tool-call" as const, toolName: "weather", toolCallId: "1", toolInput: { location: "London" } },
      ],
    } as unknown as ThreadMessage;
    expect(messageText(message)).toBe("Hello");
  });

  test("image parts are ignored", () => {
    const message = {
      role: "assistant" as const,
      content: [
        { type: "text" as const, text: "Hello" },
        { type: "image" as const, source: { type: "url", url: "https://example.com/image.png" } },
      ],
    } as unknown as ThreadMessage;
    expect(messageText(message)).toBe("Hello");
  });

  test("a message with no text parts gives ''", () => {
    const message = {
      role: "assistant" as const,
      content: [
        { type: "reasoning" as const, text: "Some reasoning" },
        { type: "tool-call" as const, toolName: "weather", toolCallId: "1", toolInput: {} },
        { type: "image" as const, source: { type: "url", url: "https://example.com/image.png" } },
      ],
    } as unknown as ThreadMessage;
    expect(messageText(message)).toBe("");
  });
});
