import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Page } from "@maipai/ui/src/primitives/Page";
import { api, type ComingUpItem } from "@/lib/api";
import { RemindersTabs } from "@/apps/reminders/RemindersTabs";
import { ComingUpRow } from "./ComingUpRow";

const QUERY_KEY = ["household-coming-up"];
export function ComingUpPage() {
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: api.comingUp });
  const items = useMemo(() => (query.data ?? []).filter((item) => item.kind === "reminder"), [query.data]);
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

  return <Page title="Reminders" hideTitle>
    <RemindersTabs value="coming-up" />
    {query.isError ? <p role="alert" className="px-4 text-destructive">Could not load what is coming up.</p> : null}
    {items.length === 0 && !query.isLoading ? <p className="px-4 text-muted-foreground">No reminders</p> : null}
    {Object.entries(groups).map(([name, rows]) => rows.length ? <section key={name} aria-label={name} className="px-4 pb-4">
      <h2 className="py-2 text-lg font-semibold">{name}</h2>
      <ul className="m-0 list-none p-0">
        {rows.map((item) => <ComingUpRow key={item.id} item={item} onChanged={() => void query.refetch()} />)}
      </ul>
    </section> : null)}
  </Page>;
}
