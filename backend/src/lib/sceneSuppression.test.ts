import { describe, expect, test, beforeEach } from "bun:test";
import { readFileSync } from "node:fs";
import { dismiss, isSuppressed, shouldReAlert, resume, listActive, clearAll, __resetForTests, auditCount, weatherAlertDismissal } from "./sceneSuppression";

const adult = { byBand: "adult" as const, byConfirmedAdult: true };
const child = { byBand: "child" as const, byConfirmedAdult: false };
const minute = 60_000;

describe("scene suppression", () => {
  beforeEach(__resetForTests);
  test("reason durations, repeats and ceilings for notable, emergency and sensor kinds", () => {
    const scenarios = [
      ["dog_bark", "handled", 60, 120, 240, 480, 480],
      ["glass_breaking", "handled", 30, 60, 120, 240, 240],
      ["dog_bark", "media", 180, 360, 480, 480, 480],
      ["glass_breaking", "media", 180, 360, 480, 480, 480],
      ["dog_bark", "party", 240, 240, 240, 240, 240],
      ["smoke", "media", 15, 15, 15, 15, 15],
    ] as const;
    for (const [kind, reason, first, second, third, fourth, fifth] of scenarios) {
      __resetForTests();
      const expected = [first, second, third, fourth, fifth];
      const ceiling = kind === "glass_breaking" ? (reason === "media" ? 8 * 60 : 4 * 60) : kind === "smoke" ? 60 : reason === "party" ? 8 * 60 : 8 * 60;
      for (let index = 0; index < expected.length; index++) {
        __resetForTests();
        const expectedMinutes = expected[index]!;
        let now = 0;
        for (let repeat = 0; repeat < index; repeat++) { dismiss({ kind, scope: "device", deviceId: "d1", reason, now, ...adult }); now++; }
        const result = dismiss({ kind, scope: "device", deviceId: "d1", reason, now, ...adult });
        const durationMs = expectedMinutes * minute;
        expect(result.until).toBe(Math.min(now + durationMs, ceiling * minute));
      }
    }
  });
  test("sensor alarm repeats in 15 minute increments, capped at one hour", () => {
    for (const now of [0, 1, 2, 3, 4]) {
      const result = dismiss({ kind: "smoke", scope: "household", reason: "handled", now, ...adult });
      expect(result.until).toBe(Math.min(now + 15 * minute, 60 * minute));
    }
  });
  test("anyone may dismiss for self, but child and unconfirmed adult scope requests are refused", () => {
    expect(dismiss({ kind: "doorbell", scope: "self", personId: "p1", reason: "other", now: 0, ...child }).ok).toBe(true);
    expect(dismiss({ kind: "doorbell", scope: "device", deviceId: "d1", reason: "other", now: 0, ...child })).toMatchObject({ ok: false, refusal: "adult_required" });
    // A3: anyone dismisses an alert directed at them, for themselves only, even a real sensor alarm (15 minutes, never for others).
    expect(dismiss({ kind: "smoke", scope: "self", personId: "p1", reason: "other", now: 0, ...child })).toMatchObject({ ok: true, until: 15 * 60_000 });
    expect(dismiss({ kind: "smoke", scope: "household", reason: "other", now: 0, ...child })).toMatchObject({ ok: false, refusal: "adult_required" });
    expect(isSuppressed({ kind: "doorbell", personId: "p1", now: 1 })).toBe(true);
    expect(isSuppressed({ kind: "doorbell", personId: "p2", now: 1 })).toBe(false);
  });
  test("emergency suppression is kind isolated", () => {
    dismiss({ kind: "glass_breaking", scope: "household", reason: "handled", now: 0, ...adult });
    expect(isSuppressed({ kind: "glass_breaking", now: 1 })).toBe(true);
    expect(isSuppressed({ kind: "co", now: 1 })).toBe(false);
  });
  test("re-alert happens once per hold and can be dismissed again", () => {
    dismiss({ kind: "glass_breaking", scope: "device", deviceId: "d1", reason: "handled", now: 0, ...adult });
    const args = { kind: "glass_breaking" as const, deviceId: "d1", now: 1, escalation: { dbLouder: 6 } };
    expect(shouldReAlert(args)).toBe(true);
    expect(shouldReAlert(args)).toBe(false);
    dismiss({ kind: "glass_breaking", scope: "device", deviceId: "d1", reason: "handled", now: 2, ...adult });
    expect(shouldReAlert(args)).toBe(true);
  });
  test("resume clears and expiry is exact at until", () => {
    dismiss({ kind: "dog_bark", scope: "device", deviceId: "d1", reason: "handled", now: 0, ...adult });
    expect(isSuppressed({ kind: "dog_bark", deviceId: "d1", now: 60 * minute - 1 })).toBe(true);
    expect(isSuppressed({ kind: "dog_bark", deviceId: "d1", now: 60 * minute })).toBe(false);
    dismiss({ kind: "dog_bark", scope: "device", deviceId: "d1", reason: "handled", now: 70 * minute, ...adult });
    expect(resume({ kind: "dog_bark", byConfirmedAdult: true })).toBe(1);
    expect(listActive(70 * minute)).toEqual([]);
  });
  test("weather alert holds use their bounded alert expiry and self scope", () => {
    const end = 5 * 60 * minute;
    const self = dismiss({ kind: "weather_alert", scope: "self", personId: "p1", reason: "handled", now: 0, untilOverrideMs: end, ...child });
    expect(self.until).toBe(end);
    expect(isSuppressed({ kind: "weather_alert", personId: "p1", now: 1 })).toBe(true);
    expect(isSuppressed({ kind: "weather_alert", personId: "p2", now: 1 })).toBe(false);
    const household = dismiss({ kind: "weather_alert", scope: "household", reason: "handled", now: 0, untilOverrideMs: end, ...adult });
    expect(household.until).toBe(end);
    expect(isSuppressed({ kind: "weather_alert", personId: "p2", now: end - 1 })).toBe(true);
    expect(isSuppressed({ kind: "weather_alert", personId: "p2", now: end })).toBe(false);
    expect(dismiss({ kind: "weather_alert", scope: "household", reason: "handled", now: 0, untilOverrideMs: 48 * 60 * minute, ...adult }).until).toBe(24 * 60 * minute);
  });
  test("weather alert holds are keyed by alert id and scope", () => {
    dismiss({ kind: "weather_alert", scope: "self", personId: "p1", refId: "old", reason: "handled", now: 0, untilOverrideMs: 10 * minute, ...child });
    expect(isSuppressed({ kind: "weather_alert", personId: "p1", refId: "old", now: 1 })).toBe(true);
    expect(weatherAlertDismissal("old", "p1", 1)).toBe("you");
    expect(isSuppressed({ kind: "weather_alert", personId: "p1", refId: "new", now: 1 })).toBe(false);
    dismiss({ kind: "weather_alert", scope: "household", refId: "shared", reason: "handled", now: 0, untilOverrideMs: 10 * minute, ...adult });
    expect(isSuppressed({ kind: "weather_alert", personId: "p2", refId: "shared", now: 1 })).toBe(true);
    expect(weatherAlertDismissal("shared", "p2", 1)).toBe("household");
    expect(resume({ kind: "weather_alert", refId: "shared", byConfirmedAdult: false, byPersonId: "p1" })).toBe(0);
  });
  test("audit exposes one count only and clearAll resets process state", () => {
    dismiss({ kind: "glass_breaking", scope: "device", deviceId: "opaque-device", reason: "other", now: Date.UTC(2026, 10, 14, 12), ...adult });
    expect(auditCount()).toBe(1);
    expect(JSON.stringify({ auditCount: auditCount() })).not.toMatch(/glass|opaque|person|kind/i);
    expect(listActive(Date.UTC(2026, 10, 14, 12))).toEqual([{ kind: "glass_breaking", scope: "device", deviceId: "opaque-device", until: Date.UTC(2026, 10, 14, 12) + 30 * minute }]);
    clearAll();
    expect(auditCount()).toBe(0);
    expect(listActive(Date.UTC(2026, 10, 14, 12))).toEqual([]);
  });
  test("module imports only boundedMap and type-only imports", () => {
    const source = readFileSync(new URL("./sceneSuppression.ts", import.meta.url), "utf8");
    const imports = [...source.matchAll(/^import\s+(.*?)\s+from\s+["']([^"']+)["'];/gm)];
    expect(imports.map((match) => ({ clause: match[1], path: match[2] }))).toEqual([
      { clause: "{ setBounded }", path: "@/lib/boundedMap" },
    ]);
    expect(source).not.toMatch(/Date\.now|writeFile|appendFile|createWriteStream/);
  });
});
