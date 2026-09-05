import { describe, expect, test } from "bun:test";
import { rowsToMessages } from "@/apps/chat/mapRows";
import type { ConversationTurnRow } from "@/lib/api";

function row(overrides: Partial<ConversationTurnRow> = {}): ConversationTurnRow {
  return {
    id: "turn-1",
    personId: "person-1",
    surface: "chat",
    userText: "hello",
    replyText: "hi there",
    source: "model",
    pluginId: null,
    safetyFlagged: false,
    safetyAction: "allow",
    minorSpeaker: false,
    createdAt: "2026-09-04T00:00:00.000Z",
    ...overrides,
  };
}

describe("rowsToMessages", () => {
  test("splits one row into a user message and a reply message", () => {
    const out = rowsToMessages([row()], "Jesse");
    expect(out).toEqual([
      { id: "turn-1-user", sender: "Jesse", text: "hello", isSelf: true },
      { id: "turn-1-reply", sender: "MaiPai", text: "hi there", isSelf: false },
    ]);
  });

  test("reverses newest-first rows to oldest-first, newest last", () => {
    const rows = [
      row({ id: "turn-2", userText: "second" }),
      row({ id: "turn-1", userText: "first" }),
    ];
    const out = rowsToMessages(rows, "Jesse");
    expect(out.map((m) => m.text)).toEqual(["first", "hi there", "second", "hi there"]);
  });

  test("empty history maps to an empty thread", () => {
    expect(rowsToMessages([], "Jesse")).toEqual([]);
  });

  test("a refused turn still renders both sides, not swallowed", () => {
    const out = rowsToMessages(
      [row({ source: "safety_refuse", replyText: "I can't help with that." })],
      "Jesse",
    );
    expect(out[1]).toEqual({
      id: "turn-1-reply",
      sender: "MaiPai",
      text: "I can't help with that.",
      isSelf: false,
    });
  });
});
