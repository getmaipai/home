/** Wall clock fields for a timestamp in a person's configured time zone. */
export function wallClockParts(now: Date, zone?: string): { hour: number; minute: number; year: number; month: number; day: number; weekday: number } {
  const tz = validTimeZone(zone) ? zone! : Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", hour: "2-digit", minute: "2-digit", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(now).map((p) => [p.type, p.value]));
  return { hour: Number(parts.hour), minute: Number(parts.minute), year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday!) };
}
export function wallClockMinutes(now: Date, zone?: string): number { const p = wallClockParts(now, zone); return p.hour * 60 + p.minute; }
export function validTimeZone(zone: unknown): zone is string {
  if (typeof zone !== "string" || !zone) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); return true; } catch { return false; }
}
