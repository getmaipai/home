import { activeLocale } from "@/lib/activeLocale";

/**
 * The one place that formats dates, times, numbers, relative times, lists and units (I18N-F6). Every function reads the active
 * language at call time, so a page that renders again after a language change follows it. No other file calls `Intl.*`,
 * `toLocaleDateString`, `toLocaleTimeString` or `toLocaleString` (the `lint:i18n` rule `intl-outside-format` enforces it).
 */

type DateInput = Date | string | number;
export type DateOptions = Intl.DateTimeFormatOptions & { locale?: string };

const toDate = (value: DateInput): Date => (value instanceof Date ? value : new Date(value));
const valid = (date: Date): boolean => Number.isFinite(date.getTime());
const split = ({ locale, ...options }: DateOptions): [string, Intl.DateTimeFormatOptions] => [locale ?? activeLocale(), options];

/** Any date and time part set: `formatDate(d, { weekday: "long", month: "long", day: "numeric" })`. A time zone goes in `timeZone`. */
export function formatDate(value: DateInput, options: DateOptions = { year: "numeric", month: "short", day: "numeric" }): string {
  const [locale, rest] = split(options);
  const date = toDate(value);
  // A value that is not a date reads as nothing, never as a crash on the screen.
  return valid(date) ? new Intl.DateTimeFormat(locale, rest).format(date) : "";
}

/** A clock time ("3:05 PM" in en-US, "15:05" in en-GB and es). */
export function formatTime(value: DateInput, options: DateOptions = {}): string {
  return formatDate(value, { hour: "numeric", minute: "2-digit", ...options });
}

/** A full date and time, what `toLocaleString()` printed. */
export function formatDateTime(value: DateInput, options: DateOptions = {}): string {
  return formatDate(value, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...options });
}

/** The parts of a formatted date (used to compare calendar days in a zone and to lay a time out by hand). */
export function formatDateParts(value: DateInput, options: DateOptions): Intl.DateTimeFormatPart[] {
  const [locale, rest] = split(options);
  const date = toDate(value);
  return valid(date) ? new Intl.DateTimeFormat(locale, rest).formatToParts(date) : [];
}

/** The zone the browser runs in (the person's own device zone). */
export const deviceTimeZone = (): string => new Intl.DateTimeFormat().resolvedOptions().timeZone;

export function formatNumber(value: number, options: Intl.NumberFormatOptions = {}): string {
  return new Intl.NumberFormat(activeLocale(), options).format(value);
}

export function formatPercent(fraction: number, options: Intl.NumberFormatOptions = {}): string {
  return formatNumber(fraction, { style: "percent", maximumFractionDigits: 0, ...options });
}

/** Units the app shows. The value is the `Intl` unit id. */
export const UNITS = {
  byte: "byte",
  kilobyte: "kilobyte",
  megabyte: "megabyte",
  gigabyte: "gigabyte",
  terabyte: "terabyte",
  second: "second",
  minute: "minute",
  hour: "hour",
  day: "day",
  percent: "percent",
} as const;
export type UnitName = keyof typeof UNITS;

/** A number with its unit in the active language ("12 GB", "3 min", "5 h", "40 %" in es). `display` defaults to short. */
export function formatUnit(value: number, unit: UnitName, options: Intl.NumberFormatOptions = {}): string {
  return formatNumber(value, { style: "unit", unit: UNITS[unit], unitDisplay: "short", maximumFractionDigits: 1, ...options });
}

/** A list as words ("a, b and c" in English, "a, b y c" in Spanish). `unit` joins short pieces ("Mon, Tue"). */
export function formatList(items: readonly string[], options: Intl.ListFormatOptions = { style: "long", type: "conjunction" }): string {
  return new Intl.ListFormat(activeLocale(), options).format(items);
}

/** The words for a moment before or after `now`, in the nearest whole unit ("3 min ago", "hace 3 min", "yesterday", "ayer"). */
export function formatRelativeUnit(value: number, unit: Intl.RelativeTimeFormatUnit, options: Intl.RelativeTimeFormatOptions = { numeric: "auto" }): string {
  return new Intl.RelativeTimeFormat(activeLocale(), options).format(value, unit);
}

const startOfDay = (date: Date): number => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());

/**
 * How long ago a moment was, for lists and cards: now, minutes, hours, yesterday, days, then a short date (with the year when it is
 * not this year). A moment in the future is a short date. Same steps as the kit's `formatRelative`, in the active language.
 */
export function formatRelative(value: DateInput, now: Date = new Date()): string {
  const then = toDate(value);
  if (!valid(then)) return "";
  const diffMs = now.getTime() - then.getTime();
  const shortDate = () => formatDate(then, then.getFullYear() === now.getFullYear() ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
  if (diffMs < 0) return shortDate();
  const style = { numeric: "auto", style: "narrow" } as const;
  if (diffMs < 60_000) return formatRelativeUnit(0, "second", style);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return formatRelativeUnit(-minutes, "minute", style);
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours < 24) return formatRelativeUnit(-hours, "hour", style);
  const calendarDays = Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000);
  if (calendarDays === 1) return formatRelativeUnit(-1, "day", style);
  const days = Math.floor(diffMs / 86_400_000);
  if (days < 7) return formatRelativeUnit(-days, "day", style);
  return shortDate();
}

/** Like `formatRelative` but steps through weeks, months and years too, and reads future moments ("in 2 hours"). For posted-at lines. */
export function formatRelativeLong(value: DateInput, now: number = Date.now()): string {
  const seconds = Math.round((toDate(value).getTime() - now) / 1000);
  const steps: Array<[number, Intl.RelativeTimeFormatUnit]> = [[60, "second"], [60, "minute"], [24, "hour"], [7, "day"], [4.35, "week"], [12, "month"], [Infinity, "year"]];
  let amount = seconds;
  let unit: Intl.RelativeTimeFormatUnit = "second";
  for (const [limit, next] of steps) {
    unit = next;
    if (Math.abs(amount) < limit) break;
    amount /= limit;
  }
  return formatRelativeUnit(Math.round(amount), unit);
}

/** A language's name in its own language ("Español"), first letter capitalised. Falls back to the tag. */
export function languageName(tag: string, inLanguage: string = tag): string {
  try {
    const name = new Intl.DisplayNames([inLanguage], { type: "language" }).of(tag);
    return name ? name.charAt(0).toLocaleUpperCase(inLanguage) + name.slice(1) : tag;
  } catch { return tag; }
}

/** The bundle `useFormat()` returns. */
export const format = {
  date: formatDate, time: formatTime, dateTime: formatDateTime, dateParts: formatDateParts, number: formatNumber, percent: formatPercent,
  unit: formatUnit, list: formatList, relative: formatRelative, relativeLong: formatRelativeLong, relativeUnit: formatRelativeUnit, languageName,
};
