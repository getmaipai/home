import { i18n } from "@lingui/core";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useBreakpoint } from "@maipai/ui/src/hooks/useBreakpoint";
import { api, type AlarmView } from "@/lib/api";
import { AlarmRecordRow } from "@/apps/clock/AlarmRecordRow";
import { ComingUpRow } from "@/apps/reminders/ComingUpRow";
import { AlarmEditor } from "@/apps/clock/AlarmEditor";
import { Sheet, SheetContent } from "@maipai/ui/src/ui/sheet";
import { CLOCK_ADD_ALARM_EVENT } from "@/apps/clock/clockHeader";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import { useHubMutation } from "@/lib/useHubMutation";
import { formatDate, formatTime } from "@/lib/format";
import { StatusCard } from "@maipai/ui/src/elements/status-card";

const comingUpKey = ["household-coming-up"];
const alarmsKey = ["household-alarms"];

function untilText(at: string, now: number) {
  const minutes = Math.max(0, Math.floor((Date.parse(at) - now) / 60_000));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? i18n._({ id: "{hours} h {remainder} min", message: "{hours} h {remainder} min", values: { hours, remainder } }) : i18n._({ id: "{remainder} min", message: "{remainder} min", values: { remainder } });
}

function nextLabel(at: string, now: number) {
  const date = new Date(at);
  const day = formatDate(date, { weekday: "short" });
  const time = formatTime(date);
  return i18n._({ id: "Next: {day} {time}, in {untilText}", message: "Next: {day} {time}, in {untilText}", values: { day, time, untilText: untilText(at, now) } });
}

export function AlarmsTab() {
  const [now, setNow] = useState(Date.now());
  const [editing, setEditing] = useState<AlarmView | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const isPhone = useBreakpoint().width < 640;
  const client = useQueryClient();
  const query = useQuery({ queryKey: comingUpKey, queryFn: api.comingUp });
  const alarmQuery = useQuery({ queryKey: alarmsKey, queryFn: api.alarms });
  const alarmChange = useHubMutation({ verb: "update the alarm", mutationFn: ({ id, patch }: { id: string; patch: Partial<AlarmView> }) => api.updateAlarm(id, patch), onSuccess: changed });
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
    <section aria-label={i18n._({ id: "Alarms", message: "Alarms" })}>
      {query.isError ? <StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={i18n._({ id: "Could not load the clock. Check your connection and try again.", message: "Could not load the clock. Check your connection and try again." })} action={{ label: i18n._({ id: "Retry", message: "Retry" }), onSelect: () => void query.refetch() }} /> : null}
      {alarmQuery.isError ? <StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={i18n._({ id: "Could not load alarms. Check your connection and try again.", message: "Could not load alarms. Check your connection and try again." })} action={{ label: i18n._({ id: "Retry", message: "Retry" }), onSelect: () => void alarmQuery.refetch() }} /> : null}
      {nextAlarmAt ? <p className="m-0 py-4 text-sm text-muted-foreground">{nextLabel(nextAlarmAt, now)}</p> : null}
      {records.length === 0 && alarms.length === 0 && !query.isLoading && !alarmQuery.isLoading && !query.isError && !alarmQuery.isError
        ? <div className="py-4"><EmptyState icon="clock" variant="tile" text={i18n._({ id: "No alarms", message: "No alarms" })} actionLabel={i18n._({ id: "Add an alarm", message: "Add an alarm" })} onAction={() => window.dispatchEvent(new Event(CLOCK_ADD_ALARM_EVENT))} /></div>
        : null}
      <ul className="m-0 list-none p-0">
        {records.map((alarm) => <AlarmRecordRow
          key={alarm.id}
          alarm={alarm}
          now={now}
          onOpen={() => openEditor(alarm)}
          onToggleDay={(days) => { void alarmChange.run({ id: alarm.id, patch: { days } }); }}
          onToggleEnabled={(enabled) => { void alarmChange.run({ id: alarm.id, patch: { enabled } }); }}
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
