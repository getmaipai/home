import { dateMs, formatRelative as kitFormatRelative } from "@maipai/ui/src/relativeTime";

/** The kit's relative time, safe for a value that is not a date: "" instead of "undefined NaN NaN" (AUDIT-UI-01). */
export function formatRelative(value: string | null | undefined, now: Date = new Date()): string {
  if (typeof value !== "string" || dateMs(value) === undefined) return "";
  return kitFormatRelative(value, now);
}
