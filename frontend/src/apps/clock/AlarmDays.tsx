import { Toggle } from "@maipai/ui/src/ui/toggle";

const daysOfWeek: Array<[number, string, string]> = [[1, "M", "Monday"], [2, "T", "Tuesday"], [3, "W", "Wednesday"], [4, "T", "Thursday"], [5, "F", "Friday"], [6, "S", "Saturday"], [7, "S", "Sunday"]];

export function AlarmDays({ days, onToggle }: { days: number[]; onToggle: (day: number) => void }) {
  return <div className="flex flex-wrap gap-1">{daysOfWeek.map(([day, letter, name]) => <Toggle key={day} type="button" variant="chip" size="sm" aria-label={name} aria-pressed={days.includes(day)} pressed={days.includes(day)} onPressedChange={() => onToggle(day)}>{letter}</Toggle>)}</div>;
}
