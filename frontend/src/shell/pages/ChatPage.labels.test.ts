import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// COLUMN-01 moved the history column's kit composition into ChatColumn.tsx.
const source = readFileSync(new URL("./ChatColumn.tsx", import.meta.url), "utf8");

describe("CHAT-WORDS-01 list labels", () => {
  test("Home passes the approved visible and accessible labels to the kit controls", () => {
    expect(source).toContain('labels={{ newChat: "New chat", searchChats: "Search chats" }}');
    expect(source).toMatch(/<ThreadSearch\s+threads=\{searchableThreads\}\s+query=\{search\}[\s\S]*?inputOnly\s+aria-label="Search chats"/);
    expect(source).toContain('aria-label="Search chats"');
  });
});
