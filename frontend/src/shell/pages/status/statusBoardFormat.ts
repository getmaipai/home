import { i18n } from "@lingui/core";
import type { StatusMaintenance } from "@/lib/api";
import { engineRows } from "@/shell/pages/status/StatusComponents";
import { deviceTimeZone, formatDate, formatDateParts, formatList, formatRelativeLong } from "@/lib/format";

export const statusParts = () => engineRows().map(({ key, label }) => ({ id: key, name: label }));

export function joinNames(names: string[]) {
  if (names.length < 2) return names[0] ?? i18n._({ id: "Parts", message: "Parts" });
  return formatList(names);
}

function localParts(date: Date, timeZone: string) {
  const parts = formatDateParts(date, { locale: "en-CA", timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

function clock(date: Date, timeZone: string, includeMeridiem = true) {
  const parts = formatDateParts(date, { locale: "en-US", timeZone, hour: "numeric", minute: "2-digit", hour12: true });
  const hour = parts.find(({ type }) => type === "hour")?.value ?? "";
  const minute = parts.find(({ type }) => type === "minute")?.value ?? "00";
  const meridiem = parts.find(({ type }) => type === "dayPeriod")?.value ?? "";
  return `${hour}:${minute}${includeMeridiem ? ` ${meridiem}` : ""}`;
}

export function formatMaintenanceRange(startsAt: string, endsAt: string, now = new Date(), timeZone = deviceTimeZone()): string {
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
  const suffix = (date: Date) => formatDate(date, { locale: "en-US", timeZone, hour: "numeric", minute: "2-digit", hour12: true }).slice(-2);
  const sameDay = startKey === endKey;
  const startTime = clock(start, timeZone, !sameDay || suffix(start) !== suffix(end));
  const endTime = clock(end, timeZone);
  const range = sameDay && suffix(start) === suffix(end)
    ? i18n._({ id: "{start} to {end}", message: "{start} to {end}", values: { start: clock(start, timeZone, false), end: endTime } })
    : i18n._({ id: "{start} to {end}", message: "{start} to {end}", values: { start: startTime, end: endTime } });
  if (startKey === nowKey) {
    const hour = Number(formatDate(start, { locale: "en-US", timeZone, hour: "numeric", hour12: false }));
    return i18n._({ id: "{day}, {range}", message: "{day}, {range}", values: { day: hour >= 18 || hour < 5 ? i18n._({ id: "Tonight", message: "Tonight" }) : i18n._({ id: "Today", message: "Today" }), range } });
  }
  if (startKey === tomorrowKey) return i18n._({ id: "Tomorrow, {range}", message: "Tomorrow, {range}", values: { range } });
  const dateLabel = formatDate(start, { timeZone, month: "short", day: "numeric" });
  return i18n._({ id: "{day}, {range}", message: "{day}, {range}", values: { day: dateLabel, range } });
}

export function activeMaintenanceParts(windows: StatusMaintenance[] | undefined): string[] {
  return [...new Set((windows ?? []).filter((window) => window.status === "in_progress").flatMap((window) => window.components))];
}

export function relativePostedTime(iso: string, now = Date.now()): string {
  return formatRelativeLong(iso, now);
}
