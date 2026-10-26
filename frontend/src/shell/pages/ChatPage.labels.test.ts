import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// The history sidebar and its slot content are wired at ChatPage's use site.
const source = readFileSync(new URL("./ChatPage.tsx", import.meta.url), "utf8");

describe("CHAT-WORDS-01 list labels", () => {
  test("Home passes the approved visible and accessible labels to the kit controls", () => {
    // The column is the shared SectionSidebar: its New chat row and search field carry these labels.
    expect(source).toContain('const newChatAction = { label: "New chat"');
    expect(source).toMatch(/search=\{hasThreads \? \{[^}]*label: "Search chats"/);
  });
});
