import { Toggle } from "@maipai/ui/src/ui/toggle";
import { activeLocale } from "@/lib/activeLocale";

// 2024-01-01 is a Monday, so day 1 to 7 (Monday to Sunday) maps to January 1 to 7 in UTC; the names follow the active language.
const daysOfWeek = (): Array<[number, string, string]> => {
  const letter = new Intl.DateTimeFormat(activeLocale(), { weekday: "narrow", timeZone: "UTC" });
  const name = new Intl.DateTimeFormat(activeLocale(), { weekday: "long", timeZone: "UTC" });
  return [1, 2, 3, 4, 5, 6, 7].map((day) => [day, letter.format(new Date(Date.UTC(2024, 0, day))), name.format(new Date(Date.UTC(2024, 0, day)))]);
};

export function AlarmDays({ days, onToggle }: { days: number[]; onToggle: (day: number) => void }) {
  return <div className="flex flex-wrap gap-1">{daysOfWeek().map(([day, letter, name]) => <Toggle key={day} type="button" variant="chip" size="sm" aria-label={name} aria-pressed={days.includes(day)} pressed={days.includes(day)} onPressedChange={() => onToggle(day)}>{letter}</Toggle>)}</div>;
}
