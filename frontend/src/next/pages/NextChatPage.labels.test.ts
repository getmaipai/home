import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./NextChatPage.tsx", import.meta.url), "utf8");

describe("CHAT-WORDS-01 list labels", () => {
  test("Home passes the approved visible and accessible labels to the kit controls", () => {
    expect(source).toContain('<ThreadListNew label="New chat"');
    expect(source).toContain('<ThreadListSearch value={search} onValueChange={setSearch} label="Search chats" />');
  });
});
