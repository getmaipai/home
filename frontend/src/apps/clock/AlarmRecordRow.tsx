import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { Switch } from "@maipai/ui/src/ui/switch";
import type { AlarmView } from "@/lib/api";
import { AlarmDays } from "@/apps/clock/AlarmDays";

function daysLabel(days: number[], at: string | null) {
  if (!days.length) return `Once${at ? ` · ${new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(new Date(at))}` : ""}`;
  if (days.length === 7) return "Every day";
  if ([1, 2, 3, 4, 5].every((day) => days.includes(day)) && days.length === 5) return "Weekdays";
  if ([6, 7].every((day) => days.includes(day)) && days.length === 2) return "Weekends";
  return days.map((day) => new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(new Date(Date.UTC(2024, 0, day)))).join(", ");
}

export function alarmTime(time: string) {
  const [hourText, minute] = time.split(":");
  const hourNumber = Number(hourText);
  const hour = hourNumber % 12 || 12;
  return { time: `${hour}:${minute}`, period: hourNumber < 12 ? "AM" : "PM" };
}

function untilText(at: string, now: number) {
  const minutes = Math.max(0, Math.floor((Date.parse(at) - now) / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
}

export function AlarmRecordRow({ alarm, now, onOpen, onToggleDay, onToggleEnabled }: { alarm: AlarmView; now: number; onOpen: () => void; onToggleDay: (days: number[]) => void; onToggleEnabled: (enabled: boolean) => void }) {
  const { time, period } = alarmTime(alarm.time);
  const repeat = daysLabel(alarm.days, alarm.next_at);
  const label = alarm.label || alarm.tag || "Alarm";
  const sound = alarm.sound === "gentle_wake" ? "Gentle wake" : alarm.sound === "default" ? "" : alarm.sound === "none" ? "None" : `${alarm.sound[0]?.toUpperCase() ?? ""}${alarm.sound.slice(1)}`;
  return <li className="flex flex-col gap-3 border-b py-5" data-disabled={!alarm.enabled || undefined}>
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <Button type="button" variant="ghost" aria-label={`${time} ${period}, ${repeat.toLowerCase()}, ${label}`} onClick={onOpen}>
          <span className="flex items-baseline gap-2 tabular-nums"><span className="text-4xl font-light tracking-tight">{time}</span><span className="text-sm text-muted-foreground">{period}</span></span>
        </Button>
        <div className="flex flex-wrap items-center gap-2 px-3 text-sm text-muted-foreground">
          <span>{repeat}{sound || alarm.label ? ` · ${sound || alarm.label}` : ""}</span>
          {alarm.tag ? <Badge variant="secondary">{alarm.tag}</Badge> : null}
        </div>
      </div>
      <Switch checked={alarm.enabled} aria-label={`${time} ${period}, ${repeat.toLowerCase()}, ${label}, ${alarm.enabled ? "on" : "off"}`} onCheckedChange={onToggleEnabled} />
    </div>
    <div className="flex items-center justify-between gap-2 px-3">
      <AlarmDays days={alarm.days} onToggle={(day) => onToggleDay(alarm.days.includes(day) ? alarm.days.filter((value) => value !== day) : [...alarm.days, day].sort())} />
      <span className="shrink-0 text-sm text-muted-foreground">{alarm.enabled && alarm.next_at ? `Rings in ${untilText(alarm.next_at, now)}` : "Off"}</span>
    </div>
  </li>;
}
