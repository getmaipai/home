import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Page } from "@maipai/ui/src/primitives/Page";
import { Tabs, TabsList, TabsTrigger } from "@maipai/ui/src/ui/tabs";
import { useBreakpoint } from "@maipai/ui/src/hooks/useBreakpoint";
import { api, type AlarmView } from "@/lib/api";
import { ComingUpRow } from "@/apps/reminders/ComingUpRow";
import { CLOCK_ADD_ALARM_EVENT, setClockHeaderTab, type ClockTab } from "@/apps/clock/clockHeader";
import { AlarmRecordRow } from "@/apps/clock/AlarmRecordRow";
import type { AlarmDraft } from "@/apps/clock/AlarmEditor";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { Label } from "@maipai/ui/src/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@maipai/ui/src/ui/sheet";
import { AlarmDays } from "@/apps/clock/AlarmDays";

const QUERY_KEY = ["household-coming-up"];
const ALARMS_KEY = ["household-alarms"];

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
  const [editing, setEditing] = useState<AlarmView | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<AlarmDraft>({ time: "07:00", days: [], label: "", tag: "", sound: "default", snooze_minutes: null });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const isPhone = useBreakpoint().width < 640;
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: api.comingUp });
  const alarmQuery = useQuery({ queryKey: ALARMS_KEY, queryFn: api.alarms });
  const records = useMemo(() => alarmQuery.data ?? [], [alarmQuery.data]);
  const alarms = useMemo(() => (query.data ?? []).filter((item) => item.kind === "alarm").sort((a, b) => Date.parse(a.at) - Date.parse(b.at)), [query.data]);
  const timers = useMemo(() => (query.data ?? []).filter((item) => item.kind === "timer").sort((a, b) => Date.parse(a.at) - Date.parse(b.at)), [query.data]);
  const items = tab === "alarms" ? alarms : timers;
  const nextAlarmAt = [...records.filter((alarm) => alarm.enabled && alarm.next_at).map((alarm) => alarm.next_at as string), ...alarms.map((alarm) => alarm.at)].sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  useEffect(() => { setClockHeaderTab(tab); }, [tab]);
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
    await Promise.all([queryClient.invalidateQueries({ queryKey: ALARMS_KEY }), queryClient.invalidateQueries({ queryKey: QUERY_KEY })]);
  }
  async function saveAlarm(draft: AlarmDraft) {
    if (editing) await api.updateAlarm(editing.id, draft);
    else await api.createAlarm({ ...draft, enabled: true });
    setEditorOpen(false); await changed();
  }
  function openEditor(alarm: AlarmView | null) {
    setEditing(alarm); setConfirmDelete(false); setSkipping(false);
    setDraft(alarm ? { time: alarm.time, days: alarm.days, label: alarm.label, tag: alarm.tag, sound: alarm.sound, snooze_minutes: alarm.snooze_minutes } : { time: "07:00", days: [], label: "", tag: "", sound: "default", snooze_minutes: null });
    setEditorOpen(true);
  }
  async function deleteAlarm() {
    if (!editing) return;
    await api.deleteAlarm(editing.id); setEditorOpen(false); await changed();
  }
  async function skipAlarm() {
    if (!editing) return;
    await api.skipNextAlarm(editing.id); await changed();
  }
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
        {tab === "alarms" && nextAlarmAt ? <p className="m-0 py-4 text-sm text-muted-foreground">{nextLabel(nextAlarmAt, now)}</p> : null}
        {tab === "alarms" && alarmQuery.isError ? <p role="alert" className="py-4 text-destructive">Could not load alarms.</p> : null}
        {tab === "timers" && items.length === 0 && !query.isLoading ? <p className="py-4 text-muted-foreground">No timers</p> : null}
        {tab === "alarms" && records.length === 0 && alarms.length === 0 && !query.isLoading && !alarmQuery.isLoading ? <p className="py-4 text-muted-foreground">No alarms</p> : null}
        <ul className="m-0 list-none p-0">{tab === "alarms" ? records.map((alarm) => <AlarmRecordRow key={alarm.id} alarm={alarm} now={now} onOpen={() => openEditor(alarm)} onToggleDay={(days) => { void api.updateAlarm(alarm.id, { days }).then(changed); }} onToggleEnabled={(enabled) => { void api.updateAlarm(alarm.id, { enabled }).then(changed); }} />) : null}{items.map((item) => <ComingUpRow key={item.id} item={item} presentation={tab === "alarms" ? "alarm" : "default"} onChanged={() => void query.refetch()} />)}</ul>
      </main>
      {isPhone ? <div className="mt-auto">{tabBar}</div> : null}
    </div>
    <Sheet open={editorOpen} onOpenChange={setEditorOpen}>
      <SheetContent side={isPhone ? "bottom" : "right"} data-testid="alarm-sheet-content">
        <SheetHeader><SheetTitle>{editing ? "Edit alarm" : "New alarm"}</SheetTitle><SheetDescription>Choose when this alarm rings.</SheetDescription></SheetHeader>
        <form className="flex flex-col gap-4 overflow-y-auto px-4" onSubmit={(event) => { event.preventDefault(); void saveAlarm(draft); }}>
          <div className="grid gap-2"><Label htmlFor="alarm-time">Time</Label><Input id="alarm-time" aria-label="Time" type="time" value={draft.time} onChange={(event) => setDraft({ ...draft, time: event.target.value })} /></div>
          <fieldset className="grid gap-2"><legend className="text-base font-medium">Repeat</legend><AlarmDays days={draft.days} onToggle={(day) => setDraft({ ...draft, days: draft.days.includes(day) ? draft.days.filter((value) => value !== day) : [...draft.days, day].sort() })} /></fieldset>
          <div className="grid gap-2"><Label htmlFor="alarm-label">Label</Label><Input id="alarm-label" aria-label="Label" value={draft.label} maxLength={120} onChange={(event) => setDraft({ ...draft, label: event.target.value })} /></div>
          <div className="grid gap-2"><Label htmlFor="alarm-tag">Tag</Label><Input id="alarm-tag" aria-label="Tag" list="alarm-tag-picks" value={draft.tag} maxLength={40} onChange={(event) => setDraft({ ...draft, tag: event.target.value })} /><datalist id="alarm-tag-picks"><option value="Wake up" /><option value="Slow morning" /></datalist></div>
          <div className="grid gap-2"><Label>Sound</Label><Select value={draft.sound} onValueChange={(value) => setDraft({ ...draft, sound: value as AlarmDraft["sound"] })}><SelectTrigger aria-label="Sound"><SelectValue /></SelectTrigger><SelectContent>{([["default", "Default"], ["none", "None"], ["bell", "Bell"], ["chime", "Chime"], ["digital", "Digital"], ["rise", "Rise"], ["gentle", "Gentle"], ["gentle_wake", "Gentle wake"]] as const).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-2"><Label>Snooze</Label><Select value={draft.snooze_minutes === null ? "default" : String(draft.snooze_minutes)} onValueChange={(value) => setDraft({ ...draft, snooze_minutes: value === "default" ? null : Number(value) as AlarmDraft["snooze_minutes"] })}><SelectTrigger aria-label="Snooze"><SelectValue /></SelectTrigger><SelectContent>{([["default", "Default"], ["5", "5 minutes"], ["10", "10 minutes"], ["15", "15 minutes"], ["30", "30 minutes"], ["60", "60 minutes"]] as const).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
          <div className="flex flex-wrap gap-2"><Button type="submit">Save</Button>{editing ? <><Button type="button" variant="secondary" onClick={() => { void skipAlarm().then(() => setSkipping(true)); }}>Skip next</Button><Button type="button" variant="destructive" onClick={() => setConfirmDelete(true)}>Delete</Button></> : null}</div>
          {skipping ? <p role="status" className="text-sm text-muted-foreground">Skipping the next one</p> : null}
          {confirmDelete ? <div role="alertdialog" aria-label="Delete alarm?" className="grid gap-2"><p>Delete this alarm?</p><Button type="button" variant="destructive" onClick={() => void deleteAlarm()}>Delete alarm</Button><Button type="button" variant="outline" onClick={() => setConfirmDelete(false)}>Cancel</Button></div> : null}
        </form>
      </SheetContent>
    </Sheet>
  </Page>;
}
