import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useBreakpoint } from "@maipai/ui/src/hooks/useBreakpoint";
import { api, type AlarmView } from "@/lib/api";
import { AlarmRecordRow } from "@/apps/clock/AlarmRecordRow";
import { ComingUpRow } from "@/apps/reminders/ComingUpRow";
import { AlarmEditor } from "@/apps/clock/AlarmEditor";
import { Sheet, SheetContent } from "@maipai/ui/src/ui/sheet";
import { CLOCK_ADD_ALARM_EVENT } from "@/apps/clock/clockHeader";

const comingUpKey = ["household-coming-up"];
const alarmsKey = ["household-alarms"];

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

export function AlarmsTab() {
  const [now, setNow] = useState(Date.now());
  const [editing, setEditing] = useState<AlarmView | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const isPhone = useBreakpoint().width < 640;
  const client = useQueryClient();
  const query = useQuery({ queryKey: comingUpKey, queryFn: api.comingUp });
  const alarmQuery = useQuery({ queryKey: alarmsKey, queryFn: api.alarms });
  const records = useMemo(() => alarmQuery.data ?? [], [alarmQuery.data]);
  const alarms = useMemo(() => (query.data ?? []).filter((item) => item.kind === "alarm").sort((a, b) => Date.parse(a.at) - Date.parse(b.at)), [query.data]);
  const nextAlarmAt = [...records.filter((alarm) => alarm.enabled && alarm.next_at).map((alarm) => alarm.next_at as string), ...alarms.map((alarm) => alarm.at)].sort((a, b) => Date.parse(a) - Date.parse(b))[0];

  useEffect(() => {
    const add = () => openEditor(null);
    window.addEventListener(CLOCK_ADD_ALARM_EVENT, add);
    return () => window.removeEventListener(CLOCK_ADD_ALARM_EVENT, add);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  async function changed() {
    await Promise.all([
      client.invalidateQueries({ queryKey: alarmsKey }),
      client.invalidateQueries({ queryKey: comingUpKey }),
    ]);
  }

  function openEditor(alarm: AlarmView | null) {
    setEditing(alarm);
    setEditorOpen(true);
  }

  return (
    <section aria-label="Alarms">
      {query.isError ? <p role="alert" className="py-4 text-destructive">Could not load the clock.</p> : null}
      {alarmQuery.isError ? <p role="alert" className="py-4 text-destructive">Could not load alarms.</p> : null}
      {nextAlarmAt ? <p className="m-0 py-4 text-sm text-muted-foreground">{nextLabel(nextAlarmAt, now)}</p> : null}
      {records.length === 0 && alarms.length === 0 && !query.isLoading && !alarmQuery.isLoading
        ? <p className="py-4 text-muted-foreground">No alarms</p>
        : null}
      <ul className="m-0 list-none p-0">
        {records.map((alarm) => <AlarmRecordRow
          key={alarm.id}
          alarm={alarm}
          now={now}
          onOpen={() => openEditor(alarm)}
          onToggleDay={(days) => { void api.updateAlarm(alarm.id, { days }).then(changed); }}
          onToggleEnabled={(enabled) => { void api.updateAlarm(alarm.id, { enabled }).then(changed); }}
        />)}
        {alarms.map((item) => <ComingUpRow key={item.id} item={item} presentation="alarm" onChanged={() => void query.refetch()} />)}
      </ul>
      <Sheet open={editorOpen} onOpenChange={setEditorOpen}>
        <SheetContent side={isPhone ? "bottom" : "right"} data-testid="alarm-sheet-content">
          <AlarmEditor alarm={editing} onSaved={changed} onClose={() => setEditorOpen(false)} />
        </SheetContent>
      </Sheet>
    </section>
  );
}
