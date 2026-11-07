import { i18n } from "@lingui/core";
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
  return new Intl.DateTimeFormat(locale ?? i18n.locale, { month: "short", day: "numeric" }).format(new Date(year!, month! - 1, day!, 12));
}

function durationWords(minutes: number): string {
  if (minutes < 1) return i18n._({ id: "less than 1 minute", message: "less than 1 minute" });
  minutes = Math.round(minutes);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourText = (n: number) => i18n._({ id: "{n, plural, one {# hour} other {# hours}}", message: "{n, plural, one {# hour} other {# hours}}", values: { n } });
  const minuteText = (n: number) => i18n._({ id: "{n, plural, one {# minute} other {# minutes}}", message: "{n, plural, one {# minute} other {# minutes}}", values: { n } });
  if (hours && rest) return `${hourText(hours)} ${minuteText(rest)}`;
  if (hours) return hourText(hours);
  return minuteText(minutes);
}

function dayDetail(day: StatusAppDay): string {
  const { operational, degraded, outage, maintenance } = day.minutes;
  if (operational + degraded + outage + maintenance === 0) return i18n._({ id: "no data.", message: "no data." });
  if (degraded === 0 && outage === 0 && maintenance === 0) return i18n._({ id: "all fine.", message: "all fine." });

  const details: string[] = [];
  if (outage > 0) details.push(i18n._({ id: "down for {time} ({percent}% up)", message: "down for {time} ({percent}% up)", values: { time: durationWords(outage), percent: day.uptime.toFixed(1) } }));
  if (degraded > 0) details.push(i18n._({ id: "slow for {time}", message: "slow for {time}", values: { time: durationWords(degraded) } }));
  if (maintenance > 0) details.push(i18n._({ id: "planned maintenance for {time}", message: "planned maintenance for {time}", values: { time: durationWords(maintenance) } }));
  if (degraded > 0 && outage === 0 && maintenance === 0) return i18n._({ id: "{detail}, otherwise fine.", message: "{detail}, otherwise fine.", values: { detail: details[0] } });
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
