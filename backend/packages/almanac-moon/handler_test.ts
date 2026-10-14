import { assertEquals } from "jsr:@std/assert@1";
import * as handler from "./handler.ts";
import reference from "./reference_fixture.json" with { type: "json" };

const { moonPhase, moonPhaseData } = handler;

Deno.test("names a real reference new moon as New Moon", () => {
  // 2000-01-06 18:14 UTC is this file's own reference epoch - the moon
  // is new BY DEFINITION at that instant.
  const result = moonPhase(new Date(Date.UTC(2000, 0, 6, 18, 14)));
  assertEquals(result.text, "The moon is in its New Moon phase.");
  assertEquals(moonPhaseData(new Date(Date.UTC(2000, 0, 6, 18, 14))).phase, "New Moon");
});

Deno.test("names a full moon roughly half a synodic month later", () => {
  const halfCycleLaterMs = Date.UTC(2000, 0, 6, 18, 14) + 14.77 * 86_400_000;
  const result = moonPhase(new Date(halfCycleLaterMs));
  assertEquals(result.text, "The moon is in its Full Moon phase.");
});

Deno.test("wraps around correctly just past a full cycle later", () => {
  // Slightly PAST one full synodic month, not exactly on it - landing
  // precisely on the boundary is a floating-point coin flip (the same
  // days-since-epoch division that produces the cycle length back out
  // doesn't round-trip to bit-exact 0.0), and that imprecision is not
  // itself the behavior under test here; a real "now" never lands
  // exactly on the boundary either.
  const justPastOneCycleMs = Date.UTC(2000, 0, 6, 18, 14) + 29.530588853 * 86_400_000 + 3_600_000;
  const result = moonPhase(new Date(justPastOneCycleMs));
  assertEquals(result.text, "The moon is in its New Moon phase.");
});

// A real gap found by code review: Math.floor alone starts each named
// phase exactly AT its own defining moment instead of centering the
// window on it, so up to ~1.8 days BEFORE an actual full/new moon the
// answer would still lag one phase behind. These two tests would have
// failed under the old floor-only version and pin the fix in place.
Deno.test("already calls it Full Moon a full day before the exact full-moon moment", () => {
  const oneDayBeforeFullMs = Date.UTC(2000, 0, 6, 18, 14) + (14.765294 - 1) * 86_400_000;
  const result = moonPhase(new Date(oneDayBeforeFullMs));
  assertEquals(result.text, "The moon is in its Full Moon phase.");
});

Deno.test("already calls it New Moon a full day before the exact new-moon moment", () => {
  const oneDayBeforeNewMs = Date.UTC(2000, 0, 6, 18, 14) + (29.530588853 - 1) * 86_400_000;
  const result = moonPhase(new Date(oneDayBeforeNewMs));
  assertEquals(result.text, "The moon is in its New Moon phase.");
});

Deno.test("sunrise and sunset match the reference table to the minute for four places and four dates", () => {
  // USNO publishes whole-minute values. Circular minute distance accepts
  // at most 1 minute, including the midnight wrap.
  assertEquals(typeof handler.sunTimes, "function");
  for (const row of reference.sun) {
    const actual = handler.sunTimes!(new Date(`${row.date}T12:00:00`), { lat: row.lat, lon: row.lon });
    const expectedRise = formatInProcessZone(utcFromLocal(row.date, row.sunrise, row.tz));
    const expectedSet = formatInProcessZone(utcFromLocal(row.date, row.sunset, row.tz));
    assertEquals(minuteDistance(actual.sunrise!, expectedRise) <= 1, true, `${row.place} ${row.date} sunrise ${actual.sunrise} vs ${expectedRise}`);
    assertEquals(minuteDistance(actual.sunset!, expectedSet) <= 1, true, `${row.place} ${row.date} sunset ${actual.sunset} vs ${expectedSet}`);
  }
});

Deno.test("moon phase and illumination match the reference table for six dates, including each principal phase", () => {
  for (const row of reference.moon.phases) {
    const data = moonPhaseData(new Date(row.utc));
    assertEquals(data.phase, row.phase, `${row.utc}: ${data.phase} vs ${row.phase}`);
  }
  for (const row of reference.moon.illumination) {
    const data = moonPhaseData(new Date(row.utc));
    assertEquals(Math.abs(data.illumination! - row.fraction) <= 0.02, true, `${row.utc}: ${data.illumination} vs ${row.fraction}`);
  }
});

Deno.test("the phase name changes halfway between principal phases, not at the phase itself", () => {
  const quarter = new Date("2026-02-24T12:27:00Z").getTime();
  const before = moonPhaseData(new Date(quarter - 3 * 86_400_000));
  const at = moonPhaseData(new Date(quarter));
  assertEquals(before.phase, "Waxing Crescent");
  assertEquals(at.phase, "First Quarter");
});

Deno.test("polar day and polar night give a plain no-sunrise answer, not a throw", () => {
  assertEquals(typeof handler.handleAlmanacMoon, "function");
  for (const date of ["2026-06-21", "2026-12-21"]) {
    const result = handler.handleAlmanacMoon!({ __now: `${date}T12:00:00.000`, __home_sky: { lat: 69.65, lon: 18.96 } });
    assertEquals(result.reply.text.includes("The sun does not rise today where you are."), true);
  }
});

Deno.test("sunrise and sunset are given in the same zone as __now", () => {
  assertEquals(typeof handler.sunTimes, "function");
  const now = new Date("2026-12-21T12:00:00");
  const result = handler.sunTimes!(now, { lat: 47.61, lon: -122.33 });
  assertEquals(minuteDistance(result.sunrise!, formatInProcessZone(utcFromLocal("2026-12-21", "15:55", 0))) <= 1, true);
  assertEquals(minuteDistance(result.sunset!, formatInProcessZone(utcFromLocal("2026-12-21", "00:20", 0))) <= 1, true);
});

Deno.test("no home place gives the set-the-home-place answer and still names the moon phase", () => {
  const result = handler.handleAlmanacMoon!({ __now: "2026-03-19T12:00:00.000" });
  assertEquals(result.reply.text.includes("I don't know where you are, so I can't work out sunrise or sunset. An owner or admin can set the home place in Settings."), true);
  assertEquals(result.reply.text.includes("moon is in its"), true);
});

Deno.test("a malformed or NaN sky input gives the moon-only answer, not a throw", () => {
  for (const sky of [{ lat: Number.NaN, lon: 1 }, { lat: "47", lon: -122 }, null]) {
    const result = handler.handleAlmanacMoon!({ __now: "2026-03-19T12:00:00.000", __home_sky: sky });
    assertEquals(result.reply.text.startsWith("The moon is in its"), true);
  }
});

Deno.test("the reply never contains coordinates or the area label for a child profile", () => {
  const result = handler.handleAlmanacMoon!({ __now: "2026-03-20T12:00:00.000", __home_sky: { lat: 47.61, lon: -122.33, area: "123 Example Street" }, profile: "child" });
  assertEquals(result.reply.text.includes("47.61"), false);
  assertEquals(result.reply.text.includes("-122.33"), false);
  assertEquals(result.reply.text.includes("123 Example Street"), false);
});

Deno.test("handler.ts contains no fetch( and no URL", async () => {
  const source = await Deno.readTextFile(new URL("./handler.ts", import.meta.url));
  assertEquals(/fetch\s*\(/.test(source), false);
  assertEquals(/\bURL\b/.test(source), false);
});

function minuteDistance(a: string, b: string): number {
  const toMinute = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  const distance = Math.abs(toMinute(a) - toMinute(b));
  return Math.min(distance, 1440 - distance);
}

function utcFromLocal(date: string, time: string, offsetHours: number): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!, hour! - offsetHours, minute!));
}

function formatInProcessZone(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(value);
}
