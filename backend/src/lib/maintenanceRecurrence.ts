import { RRuleTemporal } from "rrule-temporal";
import type { MaintenanceWindow } from "@maipai/spec/gen/ts/maintenance-window.js";

export type Occurrence = { starts_at: string; ends_at: string; status: "scheduled" | "in_progress" | "completed" | "cancelled" };

function localIcsDateTime(value: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, calendar: "gregory", numberingSystem: "latn", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "00";
  return `${part("year")}${part("month")}${part("day")}T${part("hour")}${part("minute")}${part("second")}`;
}

function recurrenceRule(window: MaintenanceWindow, timeZone: string): RRuleTemporal {
  const until = window.until ? `;UNTIL=${window.until.replaceAll("-", "")}` : "";
  return new RRuleTemporal({
    rruleString: `DTSTART;TZID=${timeZone}:${localIcsDateTime(window.starts_at, timeZone)}\nRRULE:${window.rrule}${until}`,
  });
}

function isoAt(epochMilliseconds: number): string {
  return new Date(epochMilliseconds).toISOString();
}

export function maintenanceOccurrence(
  window: MaintenanceWindow,
  now: Date,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
): Occurrence {
  if (!window.rrule) {
    const status = window.cancelled_at ? "cancelled" : now.getTime() < Date.parse(window.starts_at) ? "scheduled"
      : now.getTime() < Date.parse(window.ends_at) ? "in_progress" : "completed";
    return { starts_at: window.starts_at, ends_at: window.ends_at, status };
  }

  const rule = recurrenceRule(window, timeZone);
  const duration = Date.parse(window.ends_at) - Date.parse(window.starts_at);
  const previous = rule.previous(now, true);
  const next = rule.next(now, true);
  const previousStart = previous?.epochMilliseconds;
  if (window.cancelled_at) {
    const start = previousStart ?? Date.parse(window.starts_at);
    return { starts_at: isoAt(start), ends_at: isoAt(start + duration), status: "cancelled" };
  }
  if (previousStart !== undefined && previousStart <= now.getTime() && previousStart + duration > now.getTime()) {
    return { starts_at: isoAt(previousStart), ends_at: isoAt(previousStart + duration), status: "in_progress" };
  }
  if (next) {
    const start = next.epochMilliseconds;
    return { starts_at: isoAt(start), ends_at: isoAt(start + duration), status: "scheduled" };
  }
  if (previousStart !== undefined) {
    return { starts_at: isoAt(previousStart), ends_at: isoAt(previousStart + duration), status: "completed" };
  }
  return { starts_at: window.starts_at, ends_at: window.ends_at, status: "completed" };
}

export function validateMaintenanceRecurrence(
  window: MaintenanceWindow,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
): void {
  if (window.rrule) recurrenceRule(window, timeZone);
}
