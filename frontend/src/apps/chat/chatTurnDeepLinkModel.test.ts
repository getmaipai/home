import { expect, test } from "bun:test";
import { chatTurnHref, messageForTurn } from "./chatTurnDeepLinkModel";

test("chat turn links retain both conversation and turn ids", () => {
  expect(chatTurnHref("conv-a", "turn-a")).toBe("/chat?conversation=conv-a&turn=turn-a");
  expect(chatTurnHref("conv-a", "turn-a", "user")).toBe("/chat?conversation=conv-a&turn=turn-a&message=user");
});

test("a turn can target the exact user or assistant message", () => {
  const messages = [
    { id: "turn-a-user", role: "user", turnId: "turn-a" },
    { id: "turn-a-reply", role: "assistant", turnId: "turn-a" },
  ];
  expect(messageForTurn(messages, "turn-a", "assistant")).toBe("turn-a-reply");
  expect(messageForTurn(messages, "turn-a", "user")).toBe("turn-a-user");
  expect(messageForTurn([], "turn-gone", "assistant")).toBeNull();
});
