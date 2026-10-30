import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Page } from "@maipai/ui/src/primitives/Page";
import { Tabs, TabsList, TabsTrigger } from "@maipai/ui/src/ui/tabs";
import { useBreakpoint } from "@maipai/ui/src/hooks/useBreakpoint";
import { api } from "@/lib/api";
import { ComingUpRow } from "@/apps/reminders/ComingUpRow";
import { setClockHeaderTab, type ClockTab } from "@/apps/clock/clockHeader";

const QUERY_KEY = ["household-coming-up"];

function untilText(at: string, now: number) {
  const minutes = Math.max(0, Math.floor((Date.parse(at) - now) / 60_000));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? `${hours} h ${remainder} min` : `${remainder} min`;
}

function nextLabel(at: string, now: number) {
  const date = new Date(at);
  const day = new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date);
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  return `Next: ${day} ${time}, in ${untilText(at, now)}`;
}

export function ClockPage() {
  const [tab, setTab] = useState<ClockTab>("alarms");
  const [now, setNow] = useState(Date.now());
  const isPhone = useBreakpoint().width < 640;
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: api.comingUp });
  const alarms = useMemo(() => (query.data ?? []).filter((item) => item.kind === "alarm").sort((a, b) => Date.parse(a.at) - Date.parse(b.at)), [query.data]);
  const timers = useMemo(() => (query.data ?? []).filter((item) => item.kind === "timer").sort((a, b) => Date.parse(a.at) - Date.parse(b.at)), [query.data]);
  const items = tab === "alarms" ? alarms : timers;
  useEffect(() => { setClockHeaderTab(tab); }, [tab]);
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);
  // Apple Clock puts its tabs in a bar at the bottom on a phone; wider screens keep the raised pill at the top.
  const tabBar = <Tabs value={tab} onValueChange={(value) => setTab(value as ClockTab)}>
    <nav aria-label="Clock sections" className={isPhone ? undefined : "px-4 py-3"}>
      <TabsList variant={isPhone ? "bottom" : "default"} position={isPhone ? "sticky" : undefined}>
        <TabsTrigger value="alarms" onClick={() => setTab("alarms")}>Alarms</TabsTrigger>
        <TabsTrigger value="timers" onClick={() => setTab("timers")}>Timers</TabsTrigger>
      </TabsList>
    </nav>
  </Tabs>;
  return <Page title="Clock" hideTitle>
    <div className="flex min-h-[calc(100dvh-7rem)] flex-1 flex-col">
      {isPhone ? null : tabBar}
      <main className="min-h-0 flex-1 overflow-y-auto px-4">
        <p className="m-0 border-b py-4 text-sm text-muted-foreground">{tab === "alarms" ? "Make space for a gentler start." : "A little focus, one moment at a time."}</p>
        {query.isError ? <p role="alert" className="py-4 text-destructive">Could not load the clock.</p> : null}
        {tab === "alarms" && alarms[0] ? <p className="m-0 py-4 text-sm text-muted-foreground">{nextLabel(alarms[0].at, now)}</p> : null}
        {items.length === 0 && !query.isLoading ? <p className="py-4 text-muted-foreground">{tab === "alarms" ? "No alarms" : "No timers"}</p> : null}
        <ul className="m-0 list-none p-0">{items.map((item) => <ComingUpRow key={item.id} item={item} presentation={tab === "alarms" ? "alarm" : "default"} onChanged={() => void query.refetch()} />)}</ul>
      </main>
      {isPhone ? <div className="mt-auto">{tabBar}</div> : null}
    </div>
  </Page>;
}
