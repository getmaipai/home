import type { StatusHistoryDay, StatusHistoryIncident, StatusHistoryMinutes } from "@/lib/api";

export function durationWords(minutes: number): string {
  if (minutes <= 0) return "just now";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days) return `${days} day${days === 1 ? "" : "s"}${hours ? ` ${hours} h` : ""}${rest ? ` ${rest} min` : ""}`;
  if (hours) return `${hours} h${rest ? ` ${rest} min` : ""}`;
  return `${rest} min`;
}

export function statusStripSummary(uptimePercent: number | null, incidents: readonly StatusHistoryIncident[]): string {
  if (uptimePercent === null) return "Last 90 days: no data yet.";
  const count = incidents.length;
  if (count === 0) return `Last 90 days: ${uptimePercent.toFixed(3)}% uptime, no outages.`;
  const outage = count === 1 ? "1 outage" : `${count} outages`;
  const down = durationWords(incidents.reduce((total, incident) => total + incident.minutes, 0));
  return `Last 90 days: ${uptimePercent.toFixed(3)}% uptime, ${outage}, ${down} down.`;
}

export function daySummary(minutes: StatusHistoryMinutes): string {
  const pieces: string[] = [];
  const phrase = (value: number) => {
    const hours = Math.floor(value / 60);
    const rest = value % 60;
    return `${hours ? `${hours} h` : ""}${hours && rest ? " " : ""}${rest ? `${rest} min` : ""}`;
  };
  if (minutes.degraded) pieces.push(`Slow for ${phrase(minutes.degraded)}`);
  if (minutes.outage) pieces.push(`Down for ${phrase(minutes.outage)}`);
  if (minutes.maintenance) pieces.push(`Under maintenance for ${phrase(minutes.maintenance)}`);
  return pieces.length ? pieces.join(", ") : "No problems";
}

export function dateWords(value: string, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }): string {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(new Date(value));
}

export function dayData(day: StatusHistoryDay) {
  return {
    status: day.worst === "operational" ? "up" as const : day.worst === "outage" ? "down" as const : day.worst,
    label: dateWords(`${day.date}T00:00:00Z`),
    detail: daySummary(day.minutes),
  };
}
