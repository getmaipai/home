import { i18n } from "@lingui/core";
import type { StatusMaintenance } from "@/lib/api";
import { engineRows } from "@/shell/pages/status/StatusComponents";

export const statusParts = () => engineRows().map(({ key, label }) => ({ id: key, name: label }));

export function joinNames(names: string[]) {
  if (names.length < 2) return names[0] ?? i18n._({ id: "Parts", message: "Parts" });
  if (i18n.locale.startsWith("en")) return names.length === 2 ? `${names[0]} and ${names[1]}` : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return new Intl.ListFormat(i18n.locale, { style: "long", type: "conjunction" }).format(names);
}

function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

function clock(date: Date, timeZone: string, includeMeridiem = true) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(date);
  const hour = parts.find(({ type }) => type === "hour")?.value ?? "";
  const minute = parts.find(({ type }) => type === "minute")?.value ?? "00";
  const meridiem = parts.find(({ type }) => type === "dayPeriod")?.value ?? "";
  return `${hour}:${minute}${includeMeridiem ? ` ${meridiem}` : ""}`;
}

export function formatMaintenanceRange(startsAt: string, endsAt: string, now = new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const startDay = localParts(start, timeZone);
  const endDay = localParts(end, timeZone);
  const nowDay = localParts(now, timeZone);
  const startKey = `${startDay.year}-${startDay.month}-${startDay.day}`;
  const endKey = `${endDay.year}-${endDay.month}-${endDay.day}`;
  const nowKey = `${nowDay.year}-${nowDay.month}-${nowDay.day}`;
  const tomorrowDate = new Date(Date.UTC(Number(nowDay.year), Number(nowDay.month) - 1, Number(nowDay.day) + 1));
  const tomorrowKey = `${tomorrowDate.getUTCFullYear()}-${String(tomorrowDate.getUTCMonth() + 1).padStart(2, "0")}-${String(tomorrowDate.getUTCDate()).padStart(2, "0")}`;
  const suffix = (date: Date) => new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", hour12: true }).format(date).slice(-2);
  const sameDay = startKey === endKey;
  const startTime = clock(start, timeZone, !sameDay || suffix(start) !== suffix(end));
  const endTime = clock(end, timeZone);
  const range = sameDay && suffix(start) === suffix(end)
    ? i18n._({ id: "{start} to {end}", message: "{start} to {end}", values: { start: clock(start, timeZone, false), end: endTime } })
    : i18n._({ id: "{start} to {end}", message: "{start} to {end}", values: { start: startTime, end: endTime } });
  if (startKey === nowKey) {
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hour12: false }).format(start));
    return i18n._({ id: "{day}, {range}", message: "{day}, {range}", values: { day: hour >= 18 || hour < 5 ? i18n._({ id: "Tonight", message: "Tonight" }) : i18n._({ id: "Today", message: "Today" }), range } });
  }
  if (startKey === tomorrowKey) return i18n._({ id: "Tomorrow, {range}", message: "Tomorrow, {range}", values: { range } });
  const dateLabel = new Intl.DateTimeFormat(i18n.locale, { timeZone, month: "short", day: "numeric" }).format(start);
  return i18n._({ id: "{day}, {range}", message: "{day}, {range}", values: { day: dateLabel, range } });
}

export function activeMaintenanceParts(windows: StatusMaintenance[] | undefined): string[] {
  return [...new Set((windows ?? []).filter((window) => window.status === "in_progress").flatMap((window) => window.components))];
}

export function relativePostedTime(iso: string, now = Date.now()): string {
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  const units: Array<[number, Intl.RelativeTimeFormatUnit]> = [[60, "second"], [60, "minute"], [24, "hour"], [7, "day"], [4.35, "week"], [12, "month"], [Infinity, "year"]];
  let value = seconds;
  let unit: Intl.RelativeTimeFormatUnit = "second";
  for (const [limit, nextUnit] of units) {
    unit = nextUnit;
    if (Math.abs(value) < limit) break;
    value /= limit;
  }
  return new Intl.RelativeTimeFormat(i18n.locale, { numeric: "auto" }).format(Math.round(value), unit);
}
