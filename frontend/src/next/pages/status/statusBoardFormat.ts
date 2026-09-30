import type { StatusMaintenance } from "@/lib/api";
import { ENGINE_ROWS } from "@/next/pages/status/StatusComponents";

export const STATUS_PARTS = ENGINE_ROWS.map(({ key, label }) => ({ id: key, name: label }));

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
    ? `${clock(start, timeZone, false)} to ${endTime}`
    : `${startTime} to ${endTime}`;
  if (startKey === nowKey) {
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hour12: false }).format(start));
    return `${hour >= 18 || hour < 5 ? "Tonight" : "Today"}, ${range}`;
  }
  if (startKey === tomorrowKey) return `Tomorrow, ${range}`;
  const dateLabel = new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(start);
  return `${dateLabel}, ${range}`;
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
  return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(Math.round(value), unit);
}
