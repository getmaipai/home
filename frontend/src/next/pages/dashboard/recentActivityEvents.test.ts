import { describe, expect, test } from "bun:test";
import { recentActivityEvents } from "@/next/pages/dashboard/recentActivityEvents";

describe("recentActivityEvents", () => {
  test("maps exactly the rows returned by the dashboard route", () => {
    expect(recentActivityEvents([
      { turn_id: "turn-1", person_id: "person-1", display_name: "Nova", created_at: "2026-09-21T12:00:00.000Z", surface: "chat", source: "model" },
      { turn_id: "turn-2", person_id: "person-2", display_name: "Teen", created_at: "2026-09-20T12:00:00.000Z", surface: "robot", source: "companion" },
    ])).toEqual([
      { id: "turn-1", when: "past", time: "Sep 21", title: "Nova", detail: "chat" },
      { id: "turn-2", when: "past", time: "Sep 20", title: "Teen", detail: "robot" },
    ]);
  });

  test("keeps the existing empty copy inside the shipped timeline", () => {
    expect(recentActivityEvents([])).toEqual([
      { id: "empty", when: "past", time: "", title: "Nothing yet" },
    ]);
  });
});
