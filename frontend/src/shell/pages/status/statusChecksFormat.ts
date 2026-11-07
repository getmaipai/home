import { i18n } from "@lingui/core";

// CANARY-01: words for the Status page's health checks row.
export function agoText(iso: string | null, now = Date.now()): string {
  if (!iso) return i18n._({ id: "Not checked yet", message: "Not checked yet" });
  const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return i18n._({ id: "Last checked just now", message: "Last checked just now" });
  if (minutes < 60) return i18n._({ id: "Last checked {minutes, plural, one {# minute} other {# minutes}} ago", message: "Last checked {minutes, plural, one {# minute} other {# minutes}} ago", values: { minutes } });
  const hours = Math.floor(minutes / 60);
  return i18n._({ id: "Last checked {hours, plural, one {# hour} other {# hours}} ago", message: "Last checked {hours, plural, one {# hour} other {# hours}} ago", values: { hours } });
}

export const groupWord = (group: "fail" | "pass" | "unknown"): string => ({ fail: i18n._({ id: "Failed", message: "Failed" }), pass: i18n._({ id: "Passed", message: "Passed" }), unknown: i18n._({ id: "Not checked", message: "Not checked" }) })[group];
