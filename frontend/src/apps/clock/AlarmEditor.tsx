import { i18n } from "@lingui/core";
import { useEffect, useState } from "react";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { Label } from "@maipai/ui/src/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/ui/select";
import { SheetDescription, SheetHeader, SheetTitle } from "@maipai/ui/src/ui/sheet";
import { DestructiveConfirm } from "@maipai/ui/src/primitives/DestructiveConfirm";
import { AlarmDays } from "@/apps/clock/AlarmDays";
import { api, type AlarmView } from "@/lib/api";
import { useHubMutation } from "@/lib/useHubMutation";
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
  const saveMutation = useHubMutation({ verb: "save the alarm", mutationFn: async () => { if (alarm) await api.updateAlarm(alarm.id, draft); else await api.createAlarm({ ...draft, enabled: true }); }, onSuccess: async () => { await onSaved(); onClose(); } });
  const [skipping, setSkipping] = useState(false);
  const skipMutation = useHubMutation({ verb: "skip the next alarm", mutationFn: async () => { if (alarm) await api.skipNextAlarm(alarm.id); }, onSuccess: async () => { setSkipping(true); await onSaved(); } });
  const deleteMutation = useHubMutation({ verb: "delete the alarm", mutationFn: async () => { if (alarm) await api.deleteAlarm(alarm.id); }, onSuccess: async () => { await onSaved(); onClose(); } });

  useEffect(() => {
    setDraft(draftFrom(alarm));
    setConfirmDelete(false);
    setSkipping(false);
  }, [alarm]);

  function save(event: React.FormEvent) {
    event.preventDefault();
    void saveMutation.run();
  }

  function skip() {
    void skipMutation.run();
  }

  function remove() {
    void deleteMutation.run();
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
          <SheetTitle>{alarm ? i18n._({ id: "Edit alarm", message: "Edit alarm" }) : i18n._({ id: "New alarm", message: "New alarm" })}</SheetTitle>
          <SheetDescription>{i18n._({ id: "Choose when this alarm rings.", message: "Choose when this alarm rings." })}</SheetDescription>
        </SheetHeader>
        <form className="flex flex-col gap-4 overflow-y-auto px-4" onSubmit={(event) => void save(event)}>
          <div className="grid gap-2">
            <Label htmlFor="alarm-time">{i18n._({ id: "Time", message: "Time" })}</Label>
            <Input id="alarm-time" aria-label={i18n._({ id: "Time", message: "Time" })} type="time" value={draft.time} onChange={(event) => setDraft({ ...draft, time: event.target.value })} />
          </div>
          <fieldset className="grid gap-2">
            <legend className="text-base font-medium">{i18n._({ id: "Repeat", message: "Repeat" })}</legend>
            <AlarmDays days={draft.days} onToggle={toggleDay} />
          </fieldset>
          <div className="grid gap-2">
            <Label htmlFor="alarm-label">{i18n._({ id: "Label", message: "Label" })}</Label>
            <Input id="alarm-label" aria-label={i18n._({ id: "Label", message: "Label" })} value={draft.label} maxLength={120} onChange={(event) => setDraft({ ...draft, label: event.target.value })} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="alarm-tag">{i18n._({ id: "Tag", message: "Tag" })}</Label>
            <Input id="alarm-tag" aria-label={i18n._({ id: "Tag", message: "Tag" })} list="alarm-tag-picks" value={draft.tag} maxLength={40} onChange={(event) => setDraft({ ...draft, tag: event.target.value })} />
            <datalist id="alarm-tag-picks"><option value="Wake up" /><option value="Slow morning" /></datalist>
          </div>
          <div className="grid gap-2">
            <Label>{i18n._({ id: "Sound", message: "Sound" })}</Label>
            <Select value={draft.sound} onValueChange={(value) => setDraft({ ...draft, sound: value as AlarmDraft["sound"] })}>
              <SelectTrigger aria-label={i18n._({ id: "Sound", message: "Sound" })}><SelectValue /></SelectTrigger>
              <SelectContent>
                {([ ["default", i18n._({ id: "Default", message: "Default" })], ["none", i18n._({ id: "None", message: "None" })], ["bell", i18n._({ id: "Bell", message: "Bell" })], ["chime", i18n._({ id: "Chime", message: "Chime" })], ["digital", i18n._({ id: "Digital", message: "Digital" })], ["rise", i18n._({ id: "Rise", message: "Rise" })], ["gentle", i18n._({ id: "Gentle", message: "Gentle" })], ["gentle_wake", i18n._({ id: "Gentle wake", message: "Gentle wake" })] ] as const).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>{i18n._({ id: "Snooze", message: "Snooze" })}</Label>
            <Select value={draft.snooze_minutes === null ? "default" : String(draft.snooze_minutes)} onValueChange={(value) => setDraft({ ...draft, snooze_minutes: value === "default" ? null : Number(value) as AlarmDraft["snooze_minutes"] })}>
              <SelectTrigger aria-label={i18n._({ id: "Snooze", message: "Snooze" })}><SelectValue /></SelectTrigger>
              <SelectContent>
                {([ ["default", i18n._({ id: "Default", message: "Default" })], ["5", "5 minutes"], ["10", "10 minutes"], ["15", "15 minutes"], ["30", "30 minutes"], ["60", "60 minutes"] ] as const).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={saveMutation.busy}>{i18n._({ id: "Save", message: "Save" })}</Button>
            {alarm ? <>
              <Button type="button" variant="secondary" disabled={skipMutation.busy} onClick={skip}>{i18n._({ id: "Skip next", message: "Skip next" })}</Button>
              <Button type="button" variant="destructive" onClick={() => setConfirmDelete(true)}>{i18n._({ id: "Delete", message: "Delete" })}</Button>
            </> : null}
          </div>
          {skipping ? <p role="status" className="text-sm text-muted-foreground">{i18n._({ id: "Skipping the next one", message: "Skipping the next one" })}</p> : null}
          {confirmDelete ? <DestructiveConfirm message={i18n._({ id: "Delete this alarm?", message: "Delete this alarm?" })} confirmLabel={i18n._({ id: "Delete alarm", message: "Delete alarm" })} busyLabel={i18n._({ id: "Deleting", message: "Deleting" })} busy={deleteMutation.busy} onConfirm={remove} onCancel={() => setConfirmDelete(false)} /> : null}
        </form>
      </>
  );
}
