import { useEffect, useState } from "react";
import { Button } from "@maipai/ui/src/ui/button";
import { CLOCK_TAB_EVENT, openClockAlarmEditor, type ClockTab } from "@/apps/clock/clockHeader";

export function ClockHeaderTitle() {
  const [tab, setTab] = useState<ClockTab>("alarms");
  useEffect(() => {
    const update = (event: Event) => setTab((event as CustomEvent<ClockTab>).detail);
    window.addEventListener(CLOCK_TAB_EVENT, update);
    return () => window.removeEventListener(CLOCK_TAB_EVENT, update);
  }, []);
  return <div data-slot="header-title" className="min-w-0 flex-1 truncate text-base font-medium">{tab === "alarms" ? "Alarms" : "Timers"}{tab === "alarms" ? <Button type="button" variant="ghost" size="icon-lg" aria-label="Add alarm" onClick={openClockAlarmEditor}><span aria-hidden="true">+</span></Button> : null}</div>;
}
