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

export function ComingUpRow({ item, onChanged, presentation = "default" }: { item: ComingUpItem; onChanged: () => void; presentation?: "default" | "alarm" }) {
  async function done() {
    await api.doneComingUp(item.id);
    onChanged();
  }
  async function snooze(input: { minutes?: number; until?: "tomorrow_morning" }) {
    await api.snoozeComingUp(item.id, input);
    onChanged();
  }
  if (presentation === "alarm") {
    const date = new Date(item.at);
    const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(date);
    const hourMinute = time.filter((part) => part.type === "hour" || part.type === "minute" || part.type === "literal").map((part) => part.value).join("").trim();
    const dayPeriod = time.find((part) => part.type === "dayPeriod")?.value ?? "";
    const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date);
    return <li aria-label={`${hourMinute} ${dayPeriod}, once, ${item.text}`} className="flex flex-col gap-3 border-b py-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0" aria-label={`${hourMinute} ${dayPeriod}, once, ${item.text}`} role="group">
        <div className="flex items-baseline gap-2 tabular-nums"><time dateTime={item.at} className="text-4xl font-light tracking-tight">{hourMinute}</time><span className="text-sm text-muted-foreground">{dayPeriod}</span></div>
        <p className="m-0 text-sm text-muted-foreground">Once · {weekday}</p>
        <p className="m-0 truncate text-base">{item.text}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {item.text ? <Badge variant="secondary">{item.text}</Badge> : null}
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
  return <li className="flex flex-col gap-3 border-b py-5 sm:flex-row sm:items-center sm:gap-4">
    <time dateTime={item.at} className="shrink-0 text-2xl font-light tabular-nums tracking-tight">{describeTime(new Date(item.at))}</time>
    <span className="min-w-0 break-words sm:flex-1 sm:truncate">{item.text}</span>
    <div className="flex flex-wrap items-center gap-2">
      {item.kind === "timer" ? <span className="text-sm tabular-nums text-muted-foreground"><TimerCountdown at={item.at} /></span> : null}
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
