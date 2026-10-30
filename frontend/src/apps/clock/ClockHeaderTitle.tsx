import { useEffect, useState } from "react";
import { Button } from "@maipai/ui/src/ui/button";
import { CLOCK_TAB_EVENT, openClockAdd, openClockAlarmEditor, type ClockTab } from "@/apps/clock/clockHeader";

export function ClockHeaderTitle() {
  const [tab, setTab] = useState<ClockTab>("alarms");
  useEffect(() => {
    const update = (event: Event) => setTab((event as CustomEvent<ClockTab>).detail);
    window.addEventListener(CLOCK_TAB_EVENT, update);
    return () => window.removeEventListener(CLOCK_TAB_EVENT, update);
  }, []);
  const title = ({
    alarms: "Alarms",
    timers: "Timers",
    "world-clocks": "World clocks",
    stopwatch: "Stopwatch",
  } as const)[tab];
  const addLabel = tab === "alarms"
    ? "Add alarm"
    : tab === "timers"
      ? "Add quick timer"
      : "Add world clock";
  const addAction = tab === "alarms" ? openClockAlarmEditor : openClockAdd;

  return (
    <div data-slot="header-title" className="min-w-0 flex-1 truncate text-base font-medium">
      {title}
      {tab !== "stopwatch" ? <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        aria-label={addLabel}
        onClick={addAction}
      ><span aria-hidden="true">+</span></Button> : null}
    </div>
  );
}
