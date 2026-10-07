import { describe, expect, test } from "bun:test";
import { statusTimelineEvents } from "@/shell/pages/status/statusTimelineEvents";

describe("statusTimelineEvents", () => {
  const clock = (value: string) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
  test("maps the returned incidents to recent past and ongoing events", () => {
    expect(statusTimelineEvents({
      generated_at: "2026-09-30T12:00:00.000Z",
      days: 90,
      components: [],
      incidents: [
        { component: "chat", started_at: "2026-09-29T10:00:00.000Z", ended_at: null, minutes: 120, ongoing: true },
        { component: "voice", started_at: "2026-09-27T08:00:00.000Z", ended_at: "2026-09-27T08:35:00.000Z", minutes: 35, ongoing: false },
      ],
    })).toEqual([
      { id: "chat-2026-09-29T10:00:00.000Z-0", when: "now", time: "Sep 29", title: "Brain", detail: `Ongoing since ${clock("2026-09-29T10:00:00.000Z")} · 2 h` },
      { id: "voice-2026-09-27T08:00:00.000Z-1", when: "past", time: "Sep 27", title: "Voice", detail: `Ended ${clock("2026-09-27T08:35:00.000Z")} · 35 min` },
    ]);
  });

  test("returns no events when history is unavailable or empty", () => {
    expect(statusTimelineEvents()).toEqual([]);
    expect(statusTimelineEvents({ generated_at: "2026-09-30T12:00:00.000Z", days: 90, components: [], incidents: [] })).toEqual([]);
  });

  test("limits the timeline to the five incidents the old status list showed", () => {
    const history = { generated_at: "2026-09-30T12:00:00.000Z", days: 90, components: [], incidents: Array.from({ length: 7 }, (_, index) => ({ component: "chat" as const, started_at: `2026-09-${String(29 - index).padStart(2, "0")}T10:00:00.000Z`, ended_at: "2026-09-29T11:00:00.000Z", minutes: 60, ongoing: false })) };
    expect(statusTimelineEvents(history)).toHaveLength(5);
  });
});
