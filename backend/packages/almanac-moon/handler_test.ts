import { assertEquals } from "jsr:@std/assert@1";
import { moonPhase } from "./handler.ts";

Deno.test("names a real reference new moon as New Moon", () => {
  // 2000-01-06 18:14 UTC is this file's own reference epoch - the moon
  // is new BY DEFINITION at that instant.
  const result = moonPhase(new Date(Date.UTC(2000, 0, 6, 18, 14)));
  assertEquals(result.text, "The moon is in its New Moon phase.");
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
