import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// The history sidebar and its slot content are wired at ChatPage's use site.
const source = readFileSync(new URL("./ChatPage.tsx", import.meta.url), "utf8");

describe("CHAT-WORDS-01 list labels", () => {
  test("Home passes the approved visible and accessible labels to the kit controls", () => {
    expect(source).toContain('labels={{ newChat: "New chat", searchChats: "Search chats" }}');
    expect(source).toMatch(/<ThreadSearch\s+threads=\{searchableThreads\}[\s\S]*?inputOnly[\s\S]*?aria-label="Search chats"/);
    expect(source).toContain('aria-label="Search chats"');
  });
});
