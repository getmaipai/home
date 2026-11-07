import { dateMs } from "@maipai/ui/src/relativeTime";
import { formatRelative as relativeWords } from "@/lib/format";

/**
 * How long ago a date was, in the active language ("now", "hace 3 min", "ayer", "7 nov"); "" for a value that is not a date (AUDIT-UI-01).
 * Kit gap: `@maipai/ui/src/relativeTime` words ("now", "Yesterday", "Oct 5") are English only and take no locale, so Home words them
 * through `lib/format`. `dateMs` is the kit's and stays.
 */
export function formatRelative(value: string | null | undefined, now: Date = new Date()): string {
  const ms = typeof value === "string" ? dateMs(value) : undefined;
  return ms === undefined ? "" : relativeWords(ms, now);
}
