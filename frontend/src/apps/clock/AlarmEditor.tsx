import { useEffect, useState } from "react";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { Label } from "@maipai/ui/src/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/ui/select";
import { SheetDescription, SheetHeader, SheetTitle } from "@maipai/ui/src/ui/sheet";
import { AlarmDays } from "@/apps/clock/AlarmDays";
import { api, type AlarmView } from "@/lib/api";
import type { AlarmDraft } from "@/apps/clock/alarmTypes";

const emptyDraft = (): AlarmDraft => ({ time: "07:00", days: [], label: "", tag: "", sound: "default", snooze_minutes: null });

function draftFrom(alarm: AlarmView | null): AlarmDraft {
  return alarm ? {
    time: alarm.time,
    days: alarm.days,
    label: alarm.label,
    tag: alarm.tag,
    sound: alarm.sound,
    snooze_minutes: alarm.snooze_minutes,
  } : emptyDraft();
}

export function AlarmEditor({
  alarm,
  onSaved,
  onClose,
}: {
  alarm: AlarmView | null;
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<AlarmDraft>(() => draftFrom(alarm));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [skipping, setSkipping] = useState(false);

  useEffect(() => {
    setDraft(draftFrom(alarm));
    setConfirmDelete(false);
    setSkipping(false);
  }, [alarm]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (alarm) await api.updateAlarm(alarm.id, draft);
    else await api.createAlarm({ ...draft, enabled: true });
    onClose();
    await onSaved();
  }

  async function skip() {
    if (!alarm) return;
    await api.skipNextAlarm(alarm.id);
    setSkipping(true);
    await onSaved();
  }

  async function remove() {
    if (!alarm) return;
    await api.deleteAlarm(alarm.id);
    onClose();
    await onSaved();
  }

  function toggleDay(day: number) {
    const days = draft.days.includes(day)
      ? draft.days.filter((value) => value !== day)
      : [...draft.days, day].sort();
    setDraft({ ...draft, days });
  }

  return (
      <>
        <SheetHeader>
          <SheetTitle>{alarm ? "Edit alarm" : "New alarm"}</SheetTitle>
          <SheetDescription>Choose when this alarm rings.</SheetDescription>
        </SheetHeader>
        <form className="flex flex-col gap-4 overflow-y-auto px-4" onSubmit={(event) => void save(event)}>
          <div className="grid gap-2">
            <Label htmlFor="alarm-time">Time</Label>
            <Input id="alarm-time" aria-label="Time" type="time" value={draft.time} onChange={(event) => setDraft({ ...draft, time: event.target.value })} />
          </div>
          <fieldset className="grid gap-2">
            <legend className="text-base font-medium">Repeat</legend>
            <AlarmDays days={draft.days} onToggle={toggleDay} />
          </fieldset>
          <div className="grid gap-2">
            <Label htmlFor="alarm-label">Label</Label>
            <Input id="alarm-label" aria-label="Label" value={draft.label} maxLength={120} onChange={(event) => setDraft({ ...draft, label: event.target.value })} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="alarm-tag">Tag</Label>
            <Input id="alarm-tag" aria-label="Tag" list="alarm-tag-picks" value={draft.tag} maxLength={40} onChange={(event) => setDraft({ ...draft, tag: event.target.value })} />
            <datalist id="alarm-tag-picks"><option value="Wake up" /><option value="Slow morning" /></datalist>
          </div>
          <div className="grid gap-2">
            <Label>Sound</Label>
            <Select value={draft.sound} onValueChange={(value) => setDraft({ ...draft, sound: value as AlarmDraft["sound"] })}>
              <SelectTrigger aria-label="Sound"><SelectValue /></SelectTrigger>
              <SelectContent>
                {([ ["default", "Default"], ["none", "None"], ["bell", "Bell"], ["chime", "Chime"], ["digital", "Digital"], ["rise", "Rise"], ["gentle", "Gentle"], ["gentle_wake", "Gentle wake"] ] as const).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Snooze</Label>
            <Select value={draft.snooze_minutes === null ? "default" : String(draft.snooze_minutes)} onValueChange={(value) => setDraft({ ...draft, snooze_minutes: value === "default" ? null : Number(value) as AlarmDraft["snooze_minutes"] })}>
              <SelectTrigger aria-label="Snooze"><SelectValue /></SelectTrigger>
              <SelectContent>
                {([ ["default", "Default"], ["5", "5 minutes"], ["10", "10 minutes"], ["15", "15 minutes"], ["30", "30 minutes"], ["60", "60 minutes"] ] as const).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit">Save</Button>
            {alarm ? <>
              <Button type="button" variant="secondary" onClick={() => void skip()}>Skip next</Button>
              <Button type="button" variant="destructive" onClick={() => setConfirmDelete(true)}>Delete</Button>
            </> : null}
          </div>
          {skipping ? <p role="status" className="text-sm text-muted-foreground">Skipping the next one</p> : null}
          {confirmDelete ? <div role="alertdialog" aria-label="Delete alarm?" className="grid gap-2">
            <p>Delete this alarm?</p>
            <Button type="button" variant="destructive" onClick={() => void remove()}>Delete alarm</Button>
            <Button type="button" variant="outline" onClick={() => setConfirmDelete(false)}>Cancel</Button>
          </div> : null}
        </form>
      </>
  );
}
