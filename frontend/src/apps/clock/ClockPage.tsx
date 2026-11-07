import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsList, TabsTrigger } from "@maipai/ui/src/ui/tabs";
import { useBreakpoint } from "@maipai/ui/src/hooks/useBreakpoint";
import { AlarmsTab } from "@/apps/clock/AlarmsTab";
import { TimersTab } from "@/apps/clock/TimersTab";
import { WorldClocksTab } from "@/apps/clock/WorldClocksTab";
import { StopwatchTab } from "@/apps/clock/StopwatchTab";
import { setClockHeaderTab, type ClockTab } from "@/apps/clock/clockHeader";
import { api, type ComingUpItem } from "@/lib/api";

const taglines: Record<ClockTab, string> = {
  // AUDIT-UI-01: a hint, not an empty state (each tab draws its own "No alarms" line, so the page said "no alarms" twice).
  alarms: "Add an alarm with the plus button.",
  timers: "Add a timer with the plus button.",
  "world-clocks": "Add a world clock with the plus button.",
  stopwatch: "Every moment, counted.",
};

function ActiveTab({ tab, comingUp }: { tab: ClockTab; comingUp: ComingUpItem[] }) {
  if (tab === "alarms") return <AlarmsTab />;
  if (tab === "timers") return <>
    <TimersTab running={comingUp.filter((item) => item.kind === "timer")} />
  </>;
  if (tab === "world-clocks") return <WorldClocksTab />;
  return <StopwatchTab />;
}

export function ClockPage() {
  const [tab, setTab] = useState<ClockTab>("alarms");
  const isPhone = useBreakpoint().width < 640;
  const query = useQuery({ queryKey: ["household-coming-up"], queryFn: api.comingUp });
  const comingUp = useMemo(() => Array.isArray(query.data) ? query.data : [], [query.data]);

  useEffect(() => setClockHeaderTab(tab), [tab]);

  const tabBar = (
    <Tabs value={tab} onValueChange={(value) => setTab(value as ClockTab)}>
      <nav aria-label="Clock sections" className={isPhone ? undefined : "px-4 py-3"}>
        <TabsList variant={isPhone ? "bottom" : "default"} position={isPhone ? "sticky" : undefined}>
          <TabsTrigger value="alarms" onClick={() => setTab("alarms")}>Alarms</TabsTrigger>
          <TabsTrigger value="timers" onClick={() => setTab("timers")}>Timers</TabsTrigger>
          <TabsTrigger value="world-clocks" onClick={() => setTab("world-clocks")}>World clocks</TabsTrigger>
          <TabsTrigger value="stopwatch" onClick={() => setTab("stopwatch")}>Stopwatch</TabsTrigger>
        </TabsList>
      </nav>
    </Tabs>
  );

  return (
    // AUDIT-UI-01: the route (PageHeaderLayout) draws this page's one h1; a second one here made two.
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex min-h-[calc(100dvh-7rem)] flex-1 flex-col">
        {isPhone ? null : tabBar}
        <section className="min-h-0 flex-1 overflow-y-auto px-4">
          <p className="m-0 border-b py-4 text-sm text-muted-foreground">{taglines[tab]}</p>
          <ActiveTab tab={tab} comingUp={comingUp} />
        </section>
        {isPhone ? <div className="mt-auto">{tabBar}</div> : null}
      </div>
    </div>
  );
}
