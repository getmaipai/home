import { i18n } from "@lingui/core";
import type { StatusHistoryDay, StatusHistoryIncident, StatusHistoryMinutes } from "@/lib/api";
import { formatDate } from "@/lib/format";

export function durationWords(minutes: number): string {
  if (minutes <= 0) return i18n._({ id: "just now", message: "just now" });
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  const h = (n: number) => i18n._({ id: "{n} h", message: "{n} h", values: { n } });
  const m = (n: number) => i18n._({ id: "{n} min", message: "{n} min", values: { n } });
  if (days) return [i18n._({ id: "{n, plural, one {# day} other {# days}}", message: "{n, plural, one {# day} other {# days}}", values: { n: days } }), hours ? h(hours) : "", rest ? m(rest) : ""].filter(Boolean).join(" ");
  if (hours) return rest ? `${h(hours)} ${m(rest)}` : h(hours);
  return m(rest);
}

/** One decimal, rounded down: 99.98% with an outage must not read as a perfect 100.0%. */
function uptimeWords(uptimePercent: number): string {
  return (Math.floor(Number((uptimePercent * 10).toFixed(6))) / 10).toFixed(1);
}

export function statusStripSummary(uptimePercent: number | null, incidents: readonly StatusHistoryIncident[]): string {
  if (uptimePercent === null) return i18n._({ id: "Last 90 days: no data yet.", message: "Last 90 days: no data yet." });
  const count = incidents.length;
  const percent = uptimeWords(uptimePercent);
  if (count === 0) return i18n._({ id: "Last 90 days: {percent}% uptime, no outages.", message: "Last 90 days: {percent}% uptime, no outages.", values: { percent } });
  const down = durationWords(incidents.reduce((total, incident) => total + incident.minutes, 0));
  return i18n._({ id: "Last 90 days: {percent}% uptime, {count, plural, one {# outage} other {# outages}}, {down} down.", message: "Last 90 days: {percent}% uptime, {count, plural, one {# outage} other {# outages}}, {down} down.", values: { percent, count, down } });
}

export function daySummary(minutes: StatusHistoryMinutes): string {
  const pieces: string[] = [];
  const phrase = (value: number) => {
    const hours = Math.floor(value / 60);
    const rest = value % 60;
    return [hours ? i18n._({ id: "{n} h", message: "{n} h", values: { n: hours } }) : "", rest ? i18n._({ id: "{n} min", message: "{n} min", values: { n: rest } }) : ""].filter(Boolean).join(" ");
  };
  if (minutes.degraded) pieces.push(i18n._({ id: "Slow for {time}", message: "Slow for {time}", values: { time: phrase(minutes.degraded) } }));
  if (minutes.outage) pieces.push(i18n._({ id: "Down for {time}", message: "Down for {time}", values: { time: phrase(minutes.outage) } }));
  if (minutes.maintenance) pieces.push(i18n._({ id: "Under maintenance for {time}", message: "Under maintenance for {time}", values: { time: phrase(minutes.maintenance) } }));
  return pieces.length ? pieces.join(", ") : i18n._({ id: "No problems", message: "No problems" });
}

export function dateWords(value: string, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }): string {
  return formatDate(value, { ...options, timeZone: "UTC" });
}

export function dayData(day: StatusHistoryDay) {
  return {
    status: day.worst === "operational" ? "up" as const : day.worst === "outage" ? "down" as const : day.worst,
    label: dateWords(`${day.date}T00:00:00Z`),
    detail: daySummary(day.minutes),
  };
}
