import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { statusEvents } from "@/db/schema";
import { buildStatusHistory } from "@/lib/statusHistory";
import { setHouseholdSettingValue } from "@/lib/settings";
import { resetDb } from "./reset-db";
import type { StatusComponent } from "@maipai/spec/gen/ts/status-component.js";
import type { StatusEvent } from "@maipai/spec/gen/ts/status-event.js";

const now = new Date("2026-09-30T12:00:00.000Z");
const day = 86_400_000;
function add(component: StatusComponent, state: StatusEvent["state"], at: number, id = `${component}-${state}-${at}`) {
  db.insert(statusEvents).values({ id, component, state, at: new Date(at).toISOString(), source: "sample", detail: "private", hlc: `${at}:0:test` }).run();
}

beforeEach(() => { resetDb(); db.delete(statusEvents).run(); });

describe("buildStatusHistory", () => {
  test("no rows means unknown throughout", () => {
    const result = buildStatusHistory(2, now);
    expect(result.components.every((part) => part.uptime_percent === null && part.current.state === "none" && part.current.since === null)).toBe(true);
    expect(result.components.every((part) => part.days.every((entry) => entry.worst === "none"))).toBe(true);
  });

  test("a historical SearXNG row is hidden when its integration is not configured", () => {
    add("service:searxng", "degraded", now.getTime() - 60_000);
    expect(buildStatusHistory(1, now).components.some((part) => part.component === "service:searxng")).toBe(false);
    setHouseholdSettingValue("search.searxng_url", "http://127.0.0.1:8888");
    expect(buildStatusHistory(1, now).components.find((part) => part.component === "service:searxng")?.current.state).toBe("degraded");
  });

  test("continuous operational state is 100 percent", () => {
    const start = Date.UTC(2026, 8, 29);
    add("chat", "operational", start - 31 * day);
    const chat = buildStatusHistory(1, now).components.find((part) => part.component === "chat")!;
    expect(chat.uptime_percent).toBe(100);
    expect(chat.days[0]?.worst).toBe("operational");
    // Today has 720 elapsed whole minutes at noon.
    expect(chat.days[0]?.minutes.operational).toBe(720);
  });

  test("a 90-minute outage is bucketed and reported as an incident", () => {
    const start = Date.UTC(2026, 8, 29);
    add("chat", "operational", start);
    add("chat", "outage", start + 6 * 60 * 60_000);
    add("chat", "operational", start + 7.5 * 60 * 60_000);
    const result = buildStatusHistory(2, now);
    const chat = result.components.find((part) => part.component === "chat")!;
    // From midnight yesterday through noon today there are 2160 known minutes; 90 are down, so 2070 / 2160 * 100 = 95.833333... -> 95.833.
    expect(chat.uptime_percent).toBe(95.833);
    expect(chat.days[0]?.worst).toBe("outage");
    expect(chat.days[0]?.minutes.outage).toBe(90);
    expect(result.incidents).toEqual([{ component: "chat", started_at: new Date(start + 6 * 60 * 60_000).toISOString(), ended_at: new Date(start + 7.5 * 60 * 60_000).toISOString(), minutes: 90, ongoing: false }]);
  });

  test("ongoing outage has null end and current outage", () => {
    const start = now.getTime() - 90 * 60_000;
    add("chat", "operational", start - 60_000);
    add("chat", "outage", start);
    const result = buildStatusHistory(1, now);
    expect(result.incidents[0]).toMatchObject({ ended_at: null, minutes: 90, ongoing: true });
    expect(result.components.find((part) => part.component === "chat")?.current).toEqual({ state: "outage", since: new Date(start).toISOString() });
  });

  test("maintenance is removed from the uptime denominator", () => {
    const start = Date.UTC(2026, 8, 29);
    add("chat", "operational", start);
    add("chat", "outage", start + 6 * 60 * 60_000);
    add("chat", "maintenance", start + 7.5 * 60 * 60_000);
    add("chat", "operational", start + 9.5 * 60 * 60_000);
    // Of 2160 known minutes, 120 maintenance minutes are excluded; 90 outage minutes remain, so 1950 / 2040 * 100 = 95.588235... -> 95.588.
    expect(buildStatusHistory(2, now).components.find((part) => part.component === "chat")?.uptime_percent).toBe(95.588);
  });

  test("carries the state from before the window and returns requested day count", () => {
    const start = Date.UTC(2026, 8, 29);
    add("chat", "operational", start - 31 * day);
    const result = buildStatusHistory(30, now);
    expect(result.components[0]?.days).toHaveLength(30);
    expect(result.components[0]?.days.at(-1)?.date).toBe("2026-09-30");
    expect(result.components.find((part) => part.component === "chat")?.days[0]?.worst).toBe("operational");
  });

  test("UTC midnight buckets adjacent event boundaries correctly", () => {
    const start = Date.UTC(2026, 8, 29);
    add("chat", "operational", start - 1);
    add("chat", "outage", start + 23 * 60 * 60_000 + 59 * 60_000 + 59_000);
    add("chat", "operational", start + day);
    const chat = buildStatusHistory(2, now).components.find((part) => part.component === "chat")!;
    expect(chat.days[0]?.minutes.outage).toBe(1);
    expect(chat.days[1]?.minutes.operational).toBe(720);
  });

  test("incidents are newest first and capped at twenty", () => {
    const start = Date.UTC(2026, 8, 29);
    for (let i = 0; i < 22; i++) {
      const at = start + i * 60_000;
      add("chat", "outage", at, `out-${i}`);
      add("chat", "operational", at + 30_000, `up-${i}`);
    }
    const incidents = buildStatusHistory(2, now).incidents;
    expect(incidents).toHaveLength(20);
    expect(incidents[0]?.started_at).toBe(new Date(start + 21 * 60_000).toISOString());
  });
});
