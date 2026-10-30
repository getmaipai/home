import { useEffect, useState } from "react";
import { CLOCK_TAB_EVENT, type ClockTab } from "@/apps/clock/clockHeader";

export function ClockHeaderTitle() {
  const [tab, setTab] = useState<ClockTab>("alarms");
  useEffect(() => {
    const update = (event: Event) => setTab((event as CustomEvent<ClockTab>).detail);
    window.addEventListener(CLOCK_TAB_EVENT, update);
    return () => window.removeEventListener(CLOCK_TAB_EVENT, update);
  }, []);
  return <div data-slot="header-title" className="min-w-0 flex-1 truncate text-base font-medium">{tab === "alarms" ? "Alarms" : "Timers"}</div>;
}
