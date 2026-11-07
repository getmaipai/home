import { i18n } from "@lingui/core";
import { useEffect, useState } from "react";
import { Button } from "@maipai/ui/src/ui/button";
import { getIcon } from "@maipai/ui/src/icons";
import { CLOCK_TAB_EVENT, openClockAdd, openClockAlarmEditor, type ClockTab } from "@/apps/clock/clockHeader";

const PlusIcon = getIcon("plus");

/** The Clock header's add button, drawn after the shared page title (icon and "Clock", like every other page); what it adds follows the
 * selected tab. Stopwatch has nothing to add, so it draws nothing (AUDIT-UI-01: the header used to read "Alarms +", the tab's name). */
export function ClockHeaderAdd() {
  const [tab, setTab] = useState<ClockTab>("alarms");
  useEffect(() => {
    const update = (event: Event) => setTab((event as CustomEvent<ClockTab>).detail);
    window.addEventListener(CLOCK_TAB_EVENT, update);
    return () => window.removeEventListener(CLOCK_TAB_EVENT, update);
  }, []);
  if (tab === "stopwatch") return null;
  const addLabel = tab === "alarms"
    ? i18n._({ id: "Add alarm", message: "Add alarm" })
    : tab === "timers"
      ? i18n._({ id: "Add quick timer", message: "Add quick timer" })
      : i18n._({ id: "Add world clock", message: "Add world clock" });
  const addAction = tab === "alarms" ? openClockAlarmEditor : openClockAdd;

  return (
    <span data-slot="header-add" className="flex shrink-0 items-center">
    <Button
      type="button"
      variant="ghost"
      size="icon-lg"
      aria-label={addLabel}
      onClick={addAction}
    ><PlusIcon aria-hidden="true" /></Button>
    </span>
  );
}
