import { Toggle } from "@maipai/ui/src/ui/toggle";
import { formatDate } from "@/lib/format";

// 2024-01-01 is a Monday, so day 1 to 7 (Monday to Sunday) maps to January 1 to 7 in UTC; the names follow the active language.
const daysOfWeek = (): Array<[number, string, string]> => {
  return [1, 2, 3, 4, 5, 6, 7].map((day) => [day, formatDate(Date.UTC(2024, 0, day), { weekday: "narrow", timeZone: "UTC" }), formatDate(Date.UTC(2024, 0, day), { weekday: "long", timeZone: "UTC" })]);
};

export function AlarmDays({ days, onToggle }: { days: number[]; onToggle: (day: number) => void }) {
  return <div className="flex flex-wrap gap-1">{daysOfWeek().map(([day, letter, name]) => <Toggle key={day} type="button" variant="chip" size="sm" aria-label={name} aria-pressed={days.includes(day)} pressed={days.includes(day)} onPressedChange={() => onToggle(day)}>{letter}</Toggle>)}</div>;
}
