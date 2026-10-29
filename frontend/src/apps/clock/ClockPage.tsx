import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Page } from "@maipai/ui/src/primitives/Page";
import { Tabs, TabsList, TabsTrigger } from "@maipai/ui/src/ui/tabs";
import { api } from "@/lib/api";
import { ComingUpRow } from "@/apps/reminders/ComingUpRow";

const QUERY_KEY = ["household-coming-up"];

export function ClockPage() {
  const [tab, setTab] = useState("alarms");
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: api.comingUp });
  const alarms = useMemo(() => (query.data ?? []).filter((item) => item.kind === "alarm").sort((a, b) => Date.parse(a.at) - Date.parse(b.at)), [query.data]);
  const timers = useMemo(() => (query.data ?? []).filter((item) => item.kind === "timer").sort((a, b) => Date.parse(a.at) - Date.parse(b.at)), [query.data]);
  const items = tab === "alarms" ? alarms : timers;
  return <Page title="Clock" hideTitle>
    <Tabs value={tab} onValueChange={setTab}>
      <nav aria-label="Clock sections" className="px-4 py-2">
        <TabsList><TabsTrigger value="alarms" onClick={() => setTab("alarms")}>Alarms</TabsTrigger><TabsTrigger value="timers" onClick={() => setTab("timers")}>Timers</TabsTrigger></TabsList>
      </nav>
    {query.isError ? <p role="alert" className="px-4 text-destructive">Could not load the clock.</p> : null}
    {items.length === 0 && !query.isLoading ? <p className="px-4 text-muted-foreground">{tab === "alarms" ? "No alarms" : "No timers"}</p> : null}
    <ul className="m-0 list-none px-4 pb-4">{items.map((item) => <ComingUpRow key={item.id} item={item} onChanged={() => void query.refetch()} />)}</ul>
    </Tabs>
  </Page>;
}
