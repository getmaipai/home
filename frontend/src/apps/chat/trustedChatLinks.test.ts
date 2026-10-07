import { describe, expect, test } from "bun:test";
import type { ThreadMessage } from "@assistant-ui/react";
import { trustedChatLinks } from "@/apps/chat/trustedChatLinks";

const user = {
  id: "user-1", role: "user", content: [{ type: "text", text: "I typed https://example.com/page?q=1, and (https://example.com/paren_(x))." }],
} as unknown as ThreadMessage;
const assistant = {
  id: "assistant-1", role: "assistant", content: [{
    type: "tool-call", toolCallId: "sources-1", toolName: "sources", args: {},
    result: [{ url: "https://source.example/article", site: "source.example", title: "Article" }],
  }],
} as unknown as ThreadMessage;

describe("trustedChatLinks", () => {
  test("trusts typed URLs from the conversation and sources for this reply", () => {
    expect(trustedChatLinks(assistant, [user, assistant])).toEqual([
      "https://example.com/page?q=1",
      "https://example.com/paren_(x)",
      "https://source.example/article",
    ]);
  });

  test("does not trust external links merely because a prior assistant mentioned them", () => {
    const olderAssistant = {
      id: "assistant-old", role: "assistant", content: [{ type: "text", text: "https://old.example" }],
    } as unknown as ThreadMessage;
    expect(trustedChatLinks(assistant, [olderAssistant, assistant])).toEqual(["https://source.example/article"]);
  });
});
