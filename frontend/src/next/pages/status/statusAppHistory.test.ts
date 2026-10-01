import { describe, expect, test } from "bun:test";
import type { StatusApp } from "@/lib/api";
import { formatStatusAppDay, statusForAppDay } from "@/next/pages/status/statusAppHistory";

type Day = StatusApp["history"][number];
const makeDay = (minutes: Partial<Day["minutes"]> = {}, uptime = 100): Day => ({
  date: "2026-10-01", state: "operational", uptime,
  minutes: { operational: 1440, degraded: 0, outage: 0, maintenance: 0, ...minutes },
});

describe("status app day presentation", () => {
  test.each([
    ["all fine", makeDay(), "Oct 1: all fine."],
    ["a short startup", makeDay({ operational: 1439.5, degraded: 0.5 }), "Oct 1: slow for less than 1 minute, otherwise fine."],
    ["degraded below the color threshold", makeDay({ operational: 1438, degraded: 2 }), "Oct 1: slow for 2 minutes, otherwise fine."],
    ["slow", makeDay({ operational: 1428, degraded: 12 }), "Oct 1: slow for 12 minutes, otherwise fine."],
    ["down", makeDay({ operational: 1432, outage: 8 }, 99.4), "Oct 1: down for 8 minutes (99.4% up)."],
    ["no data", makeDay({ operational: 0 }), "Oct 1: no data."],
    ["planned maintenance", makeDay({ operational: 1380, maintenance: 60 }), "Oct 1: planned maintenance for 1 hour."],
  ] as const)("formats %s in household words", (_name, day, expected) => {
    expect(formatStatusAppDay(day, "en-US")).toBe(expected);
  });

  test("uses the household locale for the day label", () => {
    expect(formatStatusAppDay(makeDay(), "en-GB")).toBe("1 Oct: all fine.");
  });

  test.each([
    ["thirty degraded seconds stay fine", makeDay({ operational: 1439.5, degraded: 0.5 }), "up"],
    ["four degraded minutes stay fine", makeDay({ operational: 1436, degraded: 4 }), "up"],
    ["five degraded minutes become amber", makeDay({ operational: 1435, degraded: 5 }), "degraded"],
    ["one outage minute becomes red", makeDay({ operational: 1439, outage: 1 }), "down"],
    ["maintenance does not change the color", makeDay({ operational: 1380, maintenance: 60 }), "up"],
  ] as const)("colors by threshold: %s", (_name, day, expected) => {
    expect(statusForAppDay(day)).toBe(expected);
  });
});
