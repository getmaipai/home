import { afterAll, describe, expect, test } from "bun:test";
import { i18n } from "@lingui/core";
import { formatDate, formatList, formatNumber, formatRelative, formatRelativeLong, formatTime, formatUnit, languageName } from "@/lib/format";
import { formatRelative as homeRelative } from "@/lib/time";

const use = (locale: string) => { i18n.load(locale, {}); i18n.activate(locale); };
const at = new Date("2026-11-07T15:05:00Z");
const now = new Date("2026-11-07T15:08:00Z");
afterAll(() => use("en-US"));

describe("formats follow the active language", () => {
  test("date", () => {
    use("en-US"); expect(formatDate(at, { month: "short", day: "numeric", timeZone: "UTC" })).toBe("Nov 7");
    use("en-GB"); expect(formatDate(at, { month: "short", day: "numeric", timeZone: "UTC" })).toBe("7 Nov");
    use("es"); expect(formatDate(at, { month: "short", day: "numeric", timeZone: "UTC" })).toBe("7 nov");
    use("es"); expect(formatDate(at, { weekday: "long", timeZone: "UTC" })).toBe("sábado");
  });
  test("time: 12-hour in en-US, 24-hour in en-GB and es", () => {
    use("en-US"); expect(formatTime(at, { timeZone: "UTC" })).toMatch(/^3:05\s?PM$/);
    use("en-GB"); expect(formatTime(at, { timeZone: "UTC" })).toBe("15:05");
    use("es"); expect(formatTime(at, { timeZone: "UTC" })).toBe("15:05");
  });
  test("number", () => {
    use("en-US"); expect(formatNumber(1234567.5)).toBe("1,234,567.5");
    use("en-GB"); expect(formatNumber(1234567.5)).toBe("1,234,567.5");
    use("es"); expect(formatNumber(1234567.5)).toBe("1.234.567,5");
  });
  test("plural (ICU through i18n)", () => {
    const message = "{count, plural, one {# gizmo} other {# gizmos}}";
    use("en-US"); expect(i18n._({ id: message, message, values: { count: 1 } })).toBe("1 gizmo");
    expect(i18n._({ id: message, message, values: { count: 3 } })).toBe("3 gizmos");
    use("es"); expect(i18n._({ id: message, message, values: { count: 3 } })).toBe("3 gizmos");
  });
  test("list", () => {
    use("en-US"); expect(formatList(["a", "b", "c"])).toBe("a, b, and c");
    use("en-GB"); expect(formatList(["a", "b", "c"])).toBe("a, b and c");
    use("es"); expect(formatList(["a", "b", "c"])).toBe("a, b y c");
  });
  test("unit", () => {
    use("en-US"); expect(formatUnit(12.34, "gigabyte")).toBe("12.3 GB");
    expect(formatUnit(3, "minute")).toMatch(/^3 min/);
    use("es"); expect(formatUnit(12.34, "gigabyte")).toBe("12,3 GB");
    expect(formatUnit(3, "minute")).toMatch(/^3 min/);
    expect(formatUnit(40, "percent")).toMatch(/^40\s?%$/);
  });
  test("relative time", () => {
    use("en-US"); expect(formatRelative(at, now)).toBe("3m ago");
    use("es"); expect(formatRelative(at, now)).toBe("hace 3 min");
    use("es"); expect(formatRelative(new Date("2026-11-06T09:00:00Z"), now)).toBe("ayer");
    use("es"); expect(formatRelative(new Date("2026-10-01T09:00:00Z"), now)).toBe("1 oct");
    use("es"); expect(formatRelative(new Date(now.getTime() - 10_000), now)).toBe("ahora");
    use("es"); expect(formatRelativeLong(at, now.getTime())).toBe("hace 3 minutos");
    use("es"); expect(homeRelative("2026-11-07T15:05:00Z", now)).toBe("hace 3 min");
    expect(homeRelative(undefined)).toBe("");
    expect(homeRelative("not a date")).toBe("");
  });
  test("a language is named in its own language", () => {
    expect(languageName("es")).toBe("Español");
    expect(languageName("en-GB")).toMatch(/English/);
  });
  test("a child or teen mode tag still formats in the base language", () => {
    use("es-x-child"); expect(formatList(["a", "b", "c"])).toBe("a, b y c");
  });
});
