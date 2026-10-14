import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { WEEKDAYS } from "../src/lib/almanacCompute";

export const FIRST_YEAR = 2026;
export const LAST_YEAR = 2045;
export const COUNTRY_CODES = { "United States": "US", Canada: "CA", "United Kingdom": "GB", Australia: "AU" } as const;
const MONDAY = WEEKDAYS.indexOf("Monday");
const THURSDAY = WEEKDAYS.indexOf("Thursday");
type CountryCode = "US" | "CA";
type Rule =
  | { kind: "fixed"; month: number; day: number }
  | { kind: "nth_weekday"; month: number; weekday: number; n: number }
  | { kind: "last_weekday"; month: number; weekday: number }
  | { kind: "monday_before"; month: number; day: number }
  | { kind: "easter_offset"; days: number };
type HolidayRule = { name: string; rule: Rule; observed?: "sat_to_fri_sun_to_mon" };

const RULES: Record<CountryCode, HolidayRule[]> = {
  US: [
    { name: "New Year's Day", rule: { kind: "fixed", month: 1, day: 1 }, observed: "sat_to_fri_sun_to_mon" },
    { name: "Birthday of Martin Luther King, Jr.", rule: { kind: "nth_weekday", month: 1, weekday: MONDAY, n: 3 } },
    { name: "Washington's Birthday", rule: { kind: "nth_weekday", month: 2, weekday: MONDAY, n: 3 } },
    { name: "Memorial Day", rule: { kind: "last_weekday", month: 5, weekday: MONDAY } },
    { name: "Juneteenth National Independence Day", rule: { kind: "fixed", month: 6, day: 19 }, observed: "sat_to_fri_sun_to_mon" },
    { name: "Independence Day", rule: { kind: "fixed", month: 7, day: 4 }, observed: "sat_to_fri_sun_to_mon" },
    { name: "Labor Day", rule: { kind: "nth_weekday", month: 9, weekday: MONDAY, n: 1 } },
    { name: "Columbus Day", rule: { kind: "nth_weekday", month: 10, weekday: MONDAY, n: 2 } },
    { name: "Veterans Day", rule: { kind: "fixed", month: 11, day: 11 }, observed: "sat_to_fri_sun_to_mon" },
    { name: "Thanksgiving Day", rule: { kind: "nth_weekday", month: 11, weekday: THURSDAY, n: 4 } },
    { name: "Christmas Day", rule: { kind: "fixed", month: 12, day: 25 }, observed: "sat_to_fri_sun_to_mon" },
  ],
  CA: [
    { name: "New Year's Day", rule: { kind: "fixed", month: 1, day: 1 } },
    { name: "Good Friday", rule: { kind: "easter_offset", days: -2 } },
    { name: "Victoria Day", rule: { kind: "monday_before", month: 5, day: 25 } },
    { name: "Canada Day", rule: { kind: "fixed", month: 7, day: 1 } },
    { name: "Labour Day", rule: { kind: "nth_weekday", month: 9, weekday: MONDAY, n: 1 } },
    { name: "National Day for Truth and Reconciliation", rule: { kind: "fixed", month: 9, day: 30 } },
    { name: "Thanksgiving Day", rule: { kind: "nth_weekday", month: 10, weekday: MONDAY, n: 2 } },
    { name: "Remembrance Day", rule: { kind: "fixed", month: 11, day: 11 } },
    { name: "Christmas Day", rule: { kind: "fixed", month: 12, day: 25 } },
    { name: "Boxing Day", rule: { kind: "fixed", month: 12, day: 26 } },
  ],
};

function isoDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}
function utcDate(year: number, month: number, day: number): Date { return new Date(Date.UTC(year, month - 1, day)); }

export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return isoDate(utcDate(year, month, day));
}

function shiftDays(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}
function ruleDate(year: number, rule: Rule): Date {
  if (rule.kind === "fixed") return utcDate(year, rule.month, rule.day);
  if (rule.kind === "easter_offset") return shiftDays(new Date(`${easterSunday(year)}T00:00:00Z`), rule.days);
  if (rule.kind === "monday_before") {
    const anchor = utcDate(year, rule.month, rule.day);
    const weekdayOffset = (anchor.getUTCDay() + 6) % 7;
    const daysBack = weekdayOffset === 0 ? 7 : weekdayOffset;
    return shiftDays(anchor, -daysBack);
  }
  if (rule.kind === "nth_weekday") {
    const first = utcDate(year, rule.month, 1);
    const day = 1 + (rule.weekday - first.getUTCDay() + 7) % 7 + (rule.n - 1) * 7;
    return utcDate(year, rule.month, day);
  }
  const last = new Date(Date.UTC(year, rule.month, 0));
  return shiftDays(last, -((last.getUTCDay() - rule.weekday + 7) % 7));
}

function observedDate(date: Date, rule?: HolidayRule["observed"]): string | undefined {
  if (!rule) return undefined;
  const weekday = date.getUTCDay();
  if (weekday === 6) return isoDate(shiftDays(date, -1));
  if (weekday === 0) return isoDate(shiftDays(date, 1));
  return undefined;
}

export function buildHolidayData() {
  const years: Record<string, Record<CountryCode, Array<{ date: string; name: string; observed?: string }>>> = {};
  for (let year = FIRST_YEAR; year <= LAST_YEAR; year++) {
    const perCountry = {} as Record<CountryCode, Array<{ date: string; name: string; observed?: string }>>;
    for (const code of Object.keys(RULES) as CountryCode[]) {
      perCountry[code] = RULES[code].map(({ name, rule, observed }) => {
        const date = ruleDate(year, rule);
        const shifted = observedDate(date, observed);
        return { date: isoDate(date), name, ...(shifted && shifted !== isoDate(date) ? { observed: shifted } : {}) };
      }).sort((a, b) => a.date.localeCompare(b.date));
    }
    years[String(year)] = perCountry;
  }
  return {
    generated_by: "backend/scripts/gen-almanac-holidays.ts",
    year_range: { first: FIRST_YEAR, last: LAST_YEAR },
    country_codes: COUNTRY_CODES,
    sources: {
      US: "https://www.opm.gov/policy-data-oversight/pay-leave/federal-holidays/",
      CA: "https://www.canada.ca/en/services/jobs/workplace/federal-labour-standards/vacations-holidays.html",
    },
    years,
  };
}

export function generatedBytes(): string { return JSON.stringify(buildHolidayData(), null, 2) + "\n"; }

if (import.meta.main) {
  const outPath = join(import.meta.dir, "..", "packages", "almanac-holiday", "holidays.json");
  writeFileSync(outPath, generatedBytes());
  console.log(`Wrote holiday data to ${outPath}`);
}
