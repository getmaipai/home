import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@maipai/ui/src/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@maipai/ui/src/ui/dropdown-menu";
import { Popover, PopoverAnchor, PopoverContent } from "@maipai/ui/src/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@maipai/ui/src/ui/sheet";
import { getIcon } from "@maipai/ui/src/icons";
import { api, type NotificationDeliveryView, type Roster } from "@/lib/api";
import { SNOOZE_OPTIONS } from "@/lib/comingUp";
import { ALARM_LOOP_MAX_MS, startAlarmLoop, unlockAlarmAudio, type AlarmPlayback, type AlarmSoundId, type AlarmVolume } from "@/lib/alarmSounds";
import { NOTIFICATIONS_HISTORY_QUERY_KEY, NOTIFICATIONS_QUERY_KEY, useNotificationsQuery } from "@/shell/NotificationBell";
import styles from "@/shell/alarmRinger.module.css";

const RECENT_MS = 2 * 60_000;
const ALARM_SETTING_KEYS = ["alarms.sound", "alarms.volume", "alarms.snooze_minutes"] as const;
type AlarmDelivery = NotificationDeliveryView & { subjectJobId?: string | null };

function formattedTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function lineFor(item: AlarmDelivery) {
  const text = item.text.trim();
  const alarmText = text.match(/^Alarm:\s*(.*)$/i);
  if (alarmText) {
    const label = alarmText[1]?.trim();
    return label && label.toLowerCase() !== "alarm" ? `Time to get up: ${label}` : "Your alarm";
  }
  return text || "Your alarm";
}

function AlarmRows({ items, settings, blocked, reducedMotion, onUnlock, onDone, onSnooze }: {
  items: AlarmDelivery[];
  settings: { sound: AlarmSoundId; volume: AlarmVolume; snoozeMinutes: number };
  blocked: boolean;
  reducedMotion: boolean;
  onUnlock: () => void;
  onDone: (item: AlarmDelivery) => void;
  onSnooze: (item: AlarmDelivery, input: { minutes?: number; until?: "tomorrow_morning" }) => void;
}) {
  const Bell = getIcon("bell");
  const options = useMemo(() => SNOOZE_OPTIONS, []);
  return <div className="flex flex-col gap-3">
    {items.length > 1 ? <p className="m-0 text-sm font-medium">{items.length} alarms</p> : null}
    {items.map((item) => {
      const missed = Date.now() - Date.parse(item.createdAt) > RECENT_MS;
      return <section key={item.id} className="flex flex-col gap-3 border-b border-border pb-3 last:border-0 last:pb-0" aria-label="Alarm">
        <div className="flex items-center gap-3">
          {!missed ? <Bell size={44} aria-hidden className={reducedMotion ? undefined : styles.alarmRingerSwing} /> : null}
          <div className="min-w-0 flex-1">
            <p className="m-0 font-medium">{lineFor(item)}</p>
            {missed ? <p className="m-0 text-sm text-muted-foreground">Missed at {formattedTime(item.createdAt)}</p> : <time className="text-sm text-muted-foreground" dateTime={item.createdAt}>{formattedTime(item.createdAt)}</time>}
          </div>
        </div>
        {!missed && blocked && settings.sound !== "none" ? <Button variant="link" onClick={onUnlock}>Tap to turn the sound on</Button> : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => onDone(item)}>Done</Button>
          {item.subjectJobId ? <>
            <Button variant="outline" onClick={() => onSnooze(item, { minutes: settings.snoozeMinutes })}>Snooze {settings.snoozeMinutes} minutes</Button>
            <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" aria-label="More snooze options">More</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {options.map((option) => <DropdownMenuItem key={option.label} onSelect={() => onSnooze(item, option.input)}>{option.label}</DropdownMenuItem>)}
            </DropdownMenuContent>
            </DropdownMenu>
          </> : null}
        </div>
      </section>;
    })}
  </div>;
}

export function AlarmRinger({ person }: { person: Roster | null }) {
  const query = useNotificationsQuery();
  const queryClient = useQueryClient();
  const scope = person ? `person:${person.id}` : "";
  const settingQuery = useQuery({ queryKey: ["settings-values", scope, ALARM_SETTING_KEYS], queryFn: () => api.settingsValues(scope), enabled: Boolean(person) });
  const seenIds = useRef<Set<string> | null>(null);
  const arrivedIds = useRef<Set<string>>(new Set());
  const playback = useRef<AlarmPlayback | null>(null);
  const ringStartedAt = useRef<number | null>(null);
  const [blocked, setBlocked] = useState(false);
  // Closing the dialog (Escape, the close button) hides it and stops the sound; the alarm stays in the bell and history.
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [, setArrivalVersion] = useState(0);
  const [phone, setPhone] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 719.98px)").matches);
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const rows = Array.isArray(query.data) ? query.data.filter((row) => row.typeId === "alarm.due") as AlarmDelivery[] : [];

  useEffect(() => {
    const media = window.matchMedia("(max-width: 719.98px)");
    const update = () => setPhone(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!query.data) return;
    const deliveries = Array.isArray(query.data) ? query.data : [];
    if (seenIds.current === null) {
      seenIds.current = new Set(deliveries.map((row) => row.id));
      return;
    }
    for (const row of deliveries) {
      if (!seenIds.current.has(row.id)) {
        seenIds.current.add(row.id);
        if (row.typeId === "alarm.due") arrivedIds.current.add(row.id);
      }
    }
    setArrivalVersion((version) => version + 1);
  }, [query.data]);

  const settings = useMemo(() => {
    const values = settingQuery.data ?? [];
    const value = (key: string) => values.find((row) => row.key === key)?.value;
    const sound = value("alarms.sound");
    const volume = value("alarms.volume");
    const snoozeMinutes = Number(value("alarms.snooze_minutes") ?? 10);
    return {
      sound: (typeof sound === "string" ? sound : "bell") as AlarmSoundId,
      volume: (typeof volume === "string" ? volume : "medium") as AlarmVolume,
      snoozeMinutes: [5, 10, 15, 30, 60].includes(snoozeMinutes) ? snoozeMinutes : 10,
    };
  }, [settingQuery.data]);
  const activeRows = rows.filter((row) => !hidden.has(row.id) && arrivedIds.current.has(row.id) && Date.now() - Date.parse(row.createdAt) <= RECENT_MS);
  const activeRowsKey = activeRows.map((row) => row.id).join(",");
  const missedRows = rows.filter((row) => !hidden.has(row.id) && (!arrivedIds.current.has(row.id) || Date.now() - Date.parse(row.createdAt) > RECENT_MS));
  const visibleRows = [...activeRows, ...missedRows];
  const open = visibleRows.length > 0;

  useEffect(() => {
    playback.current?.stop();
    playback.current = null;
    setBlocked(false);
    if (!activeRows.length) { ringStartedAt.current = null; return; }
    if (!settingQuery.isSuccess || settings.sound === "none") { if (settings.sound === "none") ringStartedAt.current = null; return; }
    ringStartedAt.current ??= Date.now();
    const maxMs = Math.max(0, ALARM_LOOP_MAX_MS - (Date.now() - ringStartedAt.current));
    const next = startAlarmLoop(settings.sound, settings.volume, { maxMs });
    playback.current = next;
    setBlocked(next.blocked);
    return () => { next.stop(); if (playback.current === next) playback.current = null; };
  }, [activeRowsKey, activeRows.length, settingQuery.isSuccess, settings.sound, settings.volume]);

  useEffect(() => () => playback.current?.stop(), []);

  function hideAll() {
    playback.current?.stop();
    setHidden((current) => new Set([...current, ...visibleRows.map((row) => row.id)]));
  }

  async function done(item: AlarmDelivery) {
    if (activeRows.length <= 1) playback.current?.stop();
    await api.dismissNotification(item.id);
    arrivedIds.current.delete(item.id);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_HISTORY_QUERY_KEY }),
      // A snoozed alarm is pending again: the Clock and Reminders pages read it from here.
      queryClient.invalidateQueries({ queryKey: ["household-coming-up"] }),
    ]);
  }

  async function snooze(item: AlarmDelivery, input: { minutes?: number; until?: "tomorrow_morning" }) {
    if (!item.subjectJobId) return;
    await api.snoozeComingUp(item.subjectJobId, input);
    await done(item);
  }

  async function unlock() {
    if (settings.sound === "none") return;
    if (!await unlockAlarmAudio()) return;
    ringStartedAt.current ??= Date.now();
    const maxMs = Math.max(0, ALARM_LOOP_MAX_MS - (Date.now() - ringStartedAt.current));
    const next = startAlarmLoop(settings.sound, settings.volume, { maxMs });
    playback.current?.stop();
    playback.current = next;
    setBlocked(next.blocked);
  }

  if (!person || !open) return null;
  const content = <AlarmRows items={visibleRows} settings={settings} blocked={blocked} reducedMotion={reducedMotion} onUnlock={unlock} onDone={(item) => void done(item)} onSnooze={(item, input) => void snooze(item, input)} />;
  return <>
    {phone ? <Sheet open onOpenChange={(next) => { if (!next) hideAll(); }}>
      <SheetContent side="top" aria-label="Ringing alarms">
        <SheetHeader><SheetTitle>Alarms</SheetTitle></SheetHeader><div className="px-4 pb-4">{content}</div>
      </SheetContent>
    </Sheet> : <Popover open onOpenChange={(next) => { if (!next) hideAll(); }}>
      <PopoverAnchor style={{ position: "fixed", right: 20, top: 56 }} />
      <PopoverContent align="end" side="bottom" width="auto" aria-label="Ringing alarms">
        {content}
      </PopoverContent>
    </Popover>}
  </>;
}
