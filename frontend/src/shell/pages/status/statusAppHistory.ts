import type { StatusApp } from "@/lib/api";

type StatusAppDay = StatusApp["history"][number];

// One policy for the app-day bucket colors. Short startup blips stay green.
export const STATUS_APP_DAY_COLOR_THRESHOLDS = {
  amberDegradedMinutes: 5,
  redOutageMinutes: 1,
} as const;

export function statusForAppDay(day: StatusAppDay): "up" | "degraded" | "down" {
  if (day.minutes.outage >= STATUS_APP_DAY_COLOR_THRESHOLDS.redOutageMinutes) return "down";
  if (day.minutes.degraded >= STATUS_APP_DAY_COLOR_THRESHOLDS.amberDegradedMinutes) return "degraded";
  return "up";
}

function dayLabel(date: string, locale?: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(new Date(year!, month! - 1, day!, 12));
}

function durationWords(minutes: number): string {
  if (minutes < 1) return "less than 1 minute";
  minutes = Math.round(minutes);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours && rest) return `${hours} ${hours === 1 ? "hour" : "hours"} ${rest} ${rest === 1 ? "minute" : "minutes"}`;
  if (hours) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

function dayDetail(day: StatusAppDay): string {
  const { operational, degraded, outage, maintenance } = day.minutes;
  if (operational + degraded + outage + maintenance === 0) return "no data.";
  if (degraded === 0 && outage === 0 && maintenance === 0) return "all fine.";

  const details: string[] = [];
  if (outage > 0) details.push(`down for ${durationWords(outage)} (${day.uptime.toFixed(1)}% up)`);
  if (degraded > 0) details.push(`slow for ${durationWords(degraded)}`);
  if (maintenance > 0) details.push(`planned maintenance for ${durationWords(maintenance)}`);
  if (degraded > 0 && outage === 0 && maintenance === 0) return `${details[0]}, otherwise fine.`;
  return `${details.join("; ")}.`;
}

export function formatStatusAppDay(day: StatusAppDay, locale?: string): string {
  return `${dayLabel(day.date, locale)}: ${dayDetail(day)}`;
}

export function statusAppDayData(day: StatusAppDay, locale?: string) {
  const full = formatStatusAppDay(day, locale);
  const colon = full.indexOf(": ");
  return {
    status: statusForAppDay(day),
    label: full.slice(0, colon + 1),
    detail: full.slice(colon + 2),
  };
}
