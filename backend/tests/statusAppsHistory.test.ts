import { describe, expect, test } from "bun:test";
import { buildAppHistory, type AppNeed, type StatusEventLike } from "@/lib/statusApps";

const start = Date.UTC(2026, 9, 1);
const now = new Date(start + 12 * 60 * 60_000);
const chatNeed: AppNeed = { kind: "engine", id: "chat", name: "MaiPai's AI", purpose: "Answer chat turns", required: true };
function event(state: string, at: number, component = "chat"): StatusEventLike {
  return { component, state, at: new Date(at).toISOString() };
}
function today(events: StatusEventLike[], needs: AppNeed[] = [chatNeed]) {
  return buildAppHistory(needs, events, now, 1).history[0]!;
}

describe("buildAppHistory daily minutes", () => {
  test("returns separate operational and degraded minute totals", () => {
    const day = today([
      event("operational", start),
      event("degraded", start + 60 * 60_000),
      event("operational", start + 62 * 60_000),
    ]);
    expect(day.minutes).toEqual({ operational: 718, degraded: 2, outage: 0, maintenance: 0 });
    expect(day.uptime).toBe(100);
  });

  test("preserves a thirty-second startup in fractional minutes", () => {
    const day = today([
      event("operational", start, "chat"),
      event("degraded", start + 60 * 60_000, "chat"),
      event("operational", start + 60 * 60_000 + 30_000, "chat"),
    ]);
    expect(day.minutes.degraded).toBe(0.5);
    expect(day.uptime).toBe(100);
  });

  test("counts an optional need problem as slow without reducing uptime", () => {
    const day = today([
      event("operational", start, "chat"),
      event("degraded", start + 60 * 60_000, "service:search"),
      event("operational", start + 62 * 60_000, "service:search"),
    ], [chatNeed, { kind: "service", id: "search", name: "Search", purpose: "Search", required: false }]);
    expect(day.minutes.degraded).toBe(2);
    expect(day.minutes.outage).toBe(0);
    expect(day.uptime).toBe(100);
  });

  test("counts required outages separately and keeps maintenance out of uptime", () => {
    const day = today([
      event("operational", start),
      event("outage", start + 60 * 60_000),
      event("operational", start + 68 * 60_000),
      event("maintenance", start + 120 * 60_000),
      event("operational", start + 180 * 60_000),
    ]);
    expect(day.minutes).toEqual({ operational: 652, degraded: 0, outage: 8, maintenance: 60 });
    expect(day.uptime).toBe(98.788);
  });

  test("zero minutes means the day has no known sample", () => {
    expect(today([]).minutes).toEqual({ operational: 0, degraded: 0, outage: 0, maintenance: 0 });
  });
});
