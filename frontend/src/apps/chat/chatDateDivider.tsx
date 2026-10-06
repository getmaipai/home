// ELEMENTS-ADOPT-01: the date line between messages, the kit's DayDivider
// (day-separator.tsx) in the kit Thread's MessageBefore slot. A line opens
// the conversation and marks each new day or a return after an hour away,
// labelled the way the major chat apps do ("Today 1:53 AM").
import { useAuiState } from "@assistant-ui/react";
import { DayDivider } from "@maipai/ui/src/elements/day-separator";

/** A pause this long between two messages earns its own line. */
export const DATE_DIVIDER_GAP_MS = 60 * 60 * 1000;

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Whether a message sent at `at` opens with a date line, given the one before it. */
export function needsDateDivider(previous: Date | undefined, at: Date): boolean {
  if (!previous) return true;
  return !sameDay(previous, at) || at.getTime() - previous.getTime() >= DATE_DIVIDER_GAP_MS;
}

/** "Today 1:53 AM", "Yesterday 9:05 PM", "Monday 8:00 AM" within the week,
 * "Oct 5 8:00 AM" this year, "Oct 5, 2025 8:00 AM" before it. */
export function dateDividerLabel(at: Date, now: Date = new Date()): string {
  const time = at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfThatDay = new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
  const daysAgo = Math.round((startOfToday - startOfThatDay) / 86_400_000);
  if (daysAgo === 0) return `Today ${time}`;
  if (daysAgo === 1) return `Yesterday ${time}`;
  if (daysAgo > 1 && daysAgo < 7) return `${at.toLocaleDateString(undefined, { weekday: "long" })} ${time}`;
  const date = at.toLocaleDateString(undefined, at.getFullYear() === now.getFullYear()
    ? { month: "short", day: "numeric" }
    : { month: "short", day: "numeric", year: "numeric" });
  return `${date} ${time}`;
}

/** The kit Thread's MessageBefore slot: one DayDivider where a line belongs. */
export function ChatDateDivider() {
  // A primitive (the epoch or -1), so the selector is stable while a reply streams.
  const at = useAuiState((s) => s.message.createdAt?.getTime() ?? -1);
  const previous = useAuiState((s) => s.thread.messages[s.message.index - 1]?.createdAt?.getTime() ?? -1);
  if (at < 0) return null;
  const when = new Date(at);
  if (!needsDateDivider(previous < 0 ? undefined : new Date(previous), when)) return null;
  return <DayDivider label={dateDividerLabel(when)} className="mx-auto w-full max-w-xs" />;
}
