import { describe, expect, test } from "bun:test";
import { daySummary, durationWords, dateWords, statusStripSummary } from "@/next/pages/status/statusHistoryFormat";

describe("status history words", () => {
  test("summarizes every daily state and omits zero minutes", () => {
    expect(daySummary({ operational: 1440, degraded: 0, outage: 0, maintenance: 0 })).toBe("No problems");
    expect(daySummary({ operational: 1350, degraded: 0, outage: 90, maintenance: 0 })).toBe("Down for 1 h 30 min");
    expect(daySummary({ operational: 1420, degraded: 20, outage: 0, maintenance: 0 })).toBe("Slow for 20 min");
    expect(daySummary({ operational: 1320, degraded: 0, outage: 0, maintenance: 120 })).toBe("Under maintenance for 2 h");
    expect(daySummary({ operational: 1300, degraded: 20, outage: 60, maintenance: 60 })).toBe("Slow for 20 min, Down for 1 h, Under maintenance for 1 h");
  });

  test("uses plain duration words", () => {
    expect(durationWords(0)).toBe("just now");
    expect(durationWords(12)).toBe("12 min");
    expect(durationWords(130)).toBe("2 h 10 min");
    expect(durationWords(1620)).toBe("1 day 3 h");
  });

  test("formats dates as short words", () => {
    expect(dateWords("2026-09-12T14:10:00.000Z", { month: "short", day: "numeric" })).toBe("Sep 12");
  });

  test("builds one plain sentence for the strip and its outage summary", () => {
    const incident = (minutes: number) => ({ component: "chat" as const, started_at: "2026-09-12T00:00:00.000Z", ended_at: null, minutes, ongoing: true });
    expect(statusStripSummary(99.982, [incident(130)])).toBe("Last 90 days: 99.982% uptime, 1 outage, 2 h 10 min down.");
    expect(statusStripSummary(98.765, [incident(35), incident(24)])).toBe("Last 90 days: 98.765% uptime, 2 outages, 59 min down.");
    expect(statusStripSummary(null, [])).toBe("Last 90 days: no data yet.");
  });
});
