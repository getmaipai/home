// NEWS-LOOK-02: the hub's words for time on a News page. The dateline ("Sat, Oct 17 · Updated 7:40") and the day groups of the
// rows ("This morning", "Last night", "Yesterday", "Wed, Oct 14") are built here, in the hub's own time zone, from the hub's clock.
// Nothing here reads a person: every viewer of the same hub sees the same words.

/** The hub's time zone: the one this process runs in (the same zone the maintenance windows use). */
export function hubTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

interface Local { y: number; m: number; d: number; hour: number; minute: number; weekday: string; monthName: string }

function localOf(date: Date, timeZone: string): Local {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", weekday: "short",
  }).formatToParts(date);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
  const month = new Intl.DateTimeFormat("en-US", { timeZone, month: "short" }).format(date);
  return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")), hour: Number(get("hour")), minute: Number(get("minute")), weekday: get("weekday"), monthName: month };
}

/** A whole-day number for a local calendar date, so "yesterday" is a subtraction that survives month ends and time changes. */
const dayNumber = (local: Local): number => Math.floor(Date.UTC(local.y, local.m - 1, local.d) / 86_400_000);

/** "Sat, Oct 17 · Updated 7:40": the day and the time the hub read the shelf, in the hub's time zone (12-hour, no am or pm). */
export function datelineOf(now: Date, timeZone = hubTimeZone()): string {
  const local = localOf(now, timeZone);
  const hour = local.hour % 12 === 0 ? 12 : local.hour % 12;
  return `${local.weekday}, ${local.monthName} ${local.d} · Updated ${hour}:${String(local.minute).padStart(2, "0")}`;
}

/** The local calendar day of an instant, as "2026-10-17": two instants are on the same day when these are equal. */
export function localDayKey(date: Date, timeZone = hubTimeZone()): string {
  const local = localOf(date, timeZone);
  return `${local.y}-${String(local.m).padStart(2, "0")}-${String(local.d).padStart(2, "0")}`;
}

/** The heading a row sits under: today by the part of the day, last evening as "Last night", the day before as "Yesterday",
 * anything older as "Wed, Oct 14". */
export function dayGroupOf(published: Date, now: Date, timeZone = hubTimeZone()): string {
  const at = localOf(published, timeZone);
  const today = localOf(now, timeZone);
  const gap = dayNumber(today) - dayNumber(at);
  if (gap <= 0) return at.hour < 12 ? "This morning" : at.hour < 18 ? "This afternoon" : "This evening";
  if (gap === 1) return at.hour >= 18 ? "Last night" : "Yesterday";
  return `${at.weekday}, ${at.monthName} ${at.d}`;
}
