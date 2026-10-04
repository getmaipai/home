import { describe, expect, test } from "bun:test";
import { chatListGroupLabel, groupChatList } from "@/apps/chat/chatListGroups";

// Wednesday 2026-09-30, mid-afternoon, local time.
const NOW = new Date(2026, 8, 30, 15, 0, 0);
const at = (day: number, hour = 9) => new Date(2026, 8, day, hour, 0, 0);

describe("chatListGroupLabel", () => {
  test("buckets by local calendar day: Today, Yesterday, Previous 7 days, Older", () => {
    expect(chatListGroupLabel(at(30, 0), NOW)).toBe("Today");
    expect(chatListGroupLabel(at(29, 23), NOW)).toBe("Yesterday");
    expect(chatListGroupLabel(at(29, 0), NOW)).toBe("Yesterday");
    expect(chatListGroupLabel(at(28), NOW)).toBe("Previous 7 days");
    expect(chatListGroupLabel(at(23, 0), NOW)).toBe("Previous 7 days");
    expect(chatListGroupLabel(at(22, 23), NOW)).toBe("Older");
    expect(chatListGroupLabel(new Date(2026, 0, 2), NOW)).toBe("Older");
  });

  test("a chat with no date yet is a brand-new one: Today", () => {
    expect(chatListGroupLabel(undefined, NOW)).toBe("Today");
  });
});

describe("groupChatList", () => {
  test("keeps newest first inside each group and drops empty groups", () => {
    const groups = groupChatList(
      [
        { id: "juniper-old", lastMessageAt: new Date(2026, 7, 1) },
        { id: "juniper-today-early", lastMessageAt: at(30, 8) },
        { id: "oliver-week", lastMessageAt: at(26) },
        { id: "juniper-today-late", lastMessageAt: at(30, 14) },
      ],
      NOW,
    );
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ["Today", ["juniper-today-late", "juniper-today-early"]],
      ["Previous 7 days", ["oliver-week"]],
      ["Older", ["juniper-old"]],
    ]);
  });

  test("an empty list has no groups", () => {
    expect(groupChatList([], NOW)).toEqual([]);
  });
});
