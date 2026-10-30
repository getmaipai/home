import { useEffect, useState } from "react";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@maipai/ui/src/ui/dropdown-menu";
import { api, type ComingUpItem } from "@/lib/api";
import { SNOOZE_OPTIONS } from "@/lib/comingUp";

function describeTime(date: Date) {
  return new Intl.DateTimeFormat(undefined, { weekday: "long", hour: "numeric", minute: "2-digit" }).format(date);
}

export function TimerCountdown({ at }: { at: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.ceil((Date.parse(at) - now) / 1000));
  return <span aria-label="Time remaining">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} remaining</span>;
}

export function ComingUpRow({ item, onChanged }: { item: ComingUpItem; onChanged: () => void }) {
  async function done() {
    await api.doneComingUp(item.id);
    onChanged();
  }
  async function snooze(input: { minutes?: number; until?: "tomorrow_morning" }) {
    await api.snoozeComingUp(item.id, input);
    onChanged();
  }
  return <li className="flex flex-col gap-2 border-b py-3 sm:min-h-14 sm:flex-row sm:items-center sm:gap-3 sm:py-2">
    <div className="flex items-center gap-3 sm:contents">
      <time dateTime={item.at} className="shrink-0 text-sm text-muted-foreground sm:w-36">{describeTime(new Date(item.at))}</time>
      <Badge variant="secondary" className="sm:order-3">{item.kind === "alarm" ? "Alarm" : item.kind === "timer" ? "Timer" : "Reminder"}</Badge>
    </div>
    <span className="min-w-0 break-words sm:flex-1 sm:truncate">{item.text}</span>
    <div className="flex flex-wrap items-center gap-2 sm:order-4">
      {item.kind === "timer" ? <TimerCountdown at={item.at} /> : null}
      <Button variant="secondary" onClick={() => void done()}>Done</Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="outline">Snooze</Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {SNOOZE_OPTIONS.map((option) => <DropdownMenuItem key={option.label} onSelect={() => void snooze(option.input)}>{option.label}</DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </li>;
}
