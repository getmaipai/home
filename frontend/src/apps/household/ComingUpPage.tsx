import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Page } from "@maipai/ui/src/primitives/Page";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@maipai/ui/src/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@maipai/ui/src/ui/tabs";
import { api, type ComingUpItem } from "@/lib/api";

const QUERY_KEY = ["household-coming-up"];
const snoozes = [{ label: "15 minutes", input: { minutes: 15 } }, { label: "An hour", input: { minutes: 60 } }, { label: "Tomorrow morning", input: { until: "tomorrow_morning" as const } }];

function describeTime(date: Date) {
  return new Intl.DateTimeFormat(undefined, { weekday: "long", hour: "numeric", minute: "2-digit" }).format(date);
}

function TimerCountdown({ at }: { at: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.ceil((Date.parse(at) - now) / 1000));
  return <span aria-label="Time remaining">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} remaining</span>;
}

export function ComingUpPage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: api.comingUp });
  const items = query.data ?? [];
  const groups = useMemo(() => {
    const now = new Date();
    const today = now.toDateString();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const tomorrowKey = tomorrow.toDateString();
    const buckets: Record<string, ComingUpItem[]> = { Today: [], Tomorrow: [], Later: [] };
    for (const item of items) {
      const day = new Date(item.at).toDateString();
      buckets[day === today ? "Today" : day === tomorrowKey ? "Tomorrow" : "Later"]!.push(item);
    }
    return buckets;
  }, [items]);

  async function done(id: string) {
    await api.doneComingUp(id);
    await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  }
  async function snooze(id: string, input: { minutes?: number; until?: "tomorrow_morning" }) {
    await api.snoozeComingUp(id, input);
    await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  }

  return <Page title="Coming up">
    <nav aria-label="Household sections" className="px-4 py-2">
      <Tabs value="coming-up">
        <TabsList>
          <TabsTrigger value="lists" onClick={() => window.location.assign("/household")}>Lists</TabsTrigger>
          <TabsTrigger value="coming-up">Coming up</TabsTrigger>
        </TabsList>
      </Tabs>
    </nav>
    {query.isError ? <p role="alert" className="px-4 text-destructive">Could not load what is coming up.</p> : null}
    {items.length === 0 && !query.isLoading ? <p className="px-4 text-muted-foreground">Nothing is coming up.</p> : null}
    {Object.entries(groups).map(([name, rows]) => rows.length ? <section key={name} aria-label={name} className="px-4 pb-4">
      <h2 className="py-2 text-lg font-semibold">{name}</h2>
      <ul className="m-0 list-none p-0">
        {rows.map((item) => <li key={item.id} className="flex flex-col gap-2 border-b py-3 sm:min-h-14 sm:flex-row sm:items-center sm:gap-3 sm:py-2">
          <div className="flex items-center gap-3 sm:contents">
            <time dateTime={item.at} className="shrink-0 text-sm text-muted-foreground sm:w-36">{describeTime(new Date(item.at))}</time>
            <Badge variant="secondary" className="sm:order-3">{item.kind === "alarm" ? "Alarm" : item.kind === "timer" ? "Timer" : "Reminder"}</Badge>
          </div>
          <span className="min-w-0 break-words sm:flex-1 sm:truncate">{item.text}</span>
          <div className="flex flex-wrap items-center gap-2 sm:order-4">
            {item.kind === "timer" ? <TimerCountdown at={item.at} /> : null}
            <Button variant="secondary" onClick={() => void done(item.id)}>Done</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="outline">Snooze</Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {snoozes.map((option) => <DropdownMenuItem key={option.label} onSelect={() => void snooze(item.id, option.input)}>{option.label}</DropdownMenuItem>)}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </li>)}
      </ul>
    </section> : null)}
  </Page>;
}
