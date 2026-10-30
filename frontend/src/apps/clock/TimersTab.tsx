import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ProgressRing } from "@maipai/ui/src/ui/progress-ring";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { Label } from "@maipai/ui/src/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@maipai/ui/src/ui/sheet";
import { api, type ComingUpItem, type QuickTimerView } from "@/lib/api";
import { ComingUpRow } from "@/apps/reminders/ComingUpRow";
import { CLOCK_ADD_EVENT } from "@/apps/clock/clockHeader";

const timersKey = ["household-coming-up"];
const quickKey = ["quick-timers"];

function twoDigits(value: number) {
  return String(value).padStart(2, "0");
}

function displayTime(seconds: number) {
  return `${twoDigits(Math.floor(seconds / 60))}:${twoDigits(seconds % 60)}`;
}

function remainingSeconds(timer: ComingUpItem, now: number) {
  return Math.max(0, Math.ceil((Date.parse(timer.at) - now) / 1000));
}

export function TimersTab({ running = [], enabled = true }: { running?: ComingUpItem[]; enabled?: boolean }) {
  const client = useQueryClient();
  const quickQuery = useQuery({ queryKey: quickKey, queryFn: api.quickTimers, enabled });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [editorOpen, setEditorOpen] = useState(false);
  const [name, setName] = useState("");
  const [minutes, setMinutes] = useState("5");
  const [editing, setEditing] = useState<QuickTimerView | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);

  const timerRows = running;
  const timers = useMemo(() => [...timerRows].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)), [timerRows]);
  const active = timers.find((timer) => timer.id === selectedId) ?? timers[0];
  const quick = Array.isArray(quickQuery.data) ? quickQuery.data : [];
  const preset = quick.find((timer) => timer.id === selectedId) ?? quick[2] ?? quick[0];
  const total = active?.total_seconds ?? (preset?.minutes ?? 25) * 60;
  const remaining = active ? remainingSeconds(active, now) : total;
  const activeLabel = active?.text ?? preset?.name ?? "Timer";
  const selectedPreset = selectedId ? quick.find((timer) => timer.id === selectedId) : null;
  const ringSeconds = active ? remaining : (selectedPreset?.minutes ?? preset?.minutes ?? 25) * 60;

  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [enabled]);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(preference.matches);
    const update = () => setReducedMotion(preference.matches);
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const add = () => {
      if (!enabled) return;
      setName("");
      setMinutes("5");
      setEditing(null);
      setEditorOpen(true);
    };
    window.addEventListener(CLOCK_ADD_EVENT, add);
    return () => window.removeEventListener(CLOCK_ADD_EVENT, add);
  }, [enabled]);

  async function changed() {
    await Promise.all([
      client.invalidateQueries({ queryKey: quickKey }),
      client.invalidateQueries({ queryKey: timersKey }),
    ]);
  }

  async function start() {
    if (!preset) return;
    const result = await api.startTimer(preset.name, preset.minutes);
    setSelectedId(result.id);
    await changed();
  }

  async function reset(timer = active) {
    if (!timer) return;
    await api.doneComingUp(timer.id);
    if (selectedId === timer.id) setSelectedId(null);
    await changed();
  }

  async function extend() {
    if (!active) return;
    await api.extendTimer(active.id);
    await changed();
  }

  async function saveQuick(event: React.FormEvent) {
    event.preventDefault();
    if (editing) {
      await api.updateQuickTimer(editing.id, { name, minutes: Number(minutes) });
    } else {
      await api.createQuickTimer(name, Number(minutes));
    }
    setEditorOpen(false);
    await changed();
  }

  if (!enabled) return null;

  return (
    <section aria-label="Timers" className="grid gap-8 py-6 lg:grid-cols-2">
      <div className="flex flex-col items-center gap-5">
        <ProgressRing
          value={total ? ringSeconds / total : 0}
          size={240}
          strokeWidth={10}
          animated={!reducedMotion}
          label={`${activeLabel}, ${displayTime(ringSeconds)} remaining`}
        >
          <div className="grid justify-items-center">
            <output aria-live="off" className="text-5xl tabular-nums">{displayTime(ringSeconds)}</output>
            <span className="mt-2 text-sm uppercase tracking-wider text-muted-foreground">{activeLabel}</span>
          </div>
        </ProgressRing>
        <div className="flex flex-wrap justify-center gap-3">
          <Button type="button" onClick={() => void start()}>Start</Button>
          {active ? <Button type="button" onClick={() => void extend()}>+1 min</Button> : null}
          <Button type="button" variant="outline" onClick={() => void reset()}>Reset</Button>
        </div>
        {timers.length > 1 ? <ul aria-label="Other running timers" className="flex flex-wrap justify-center gap-3">
          {timers.filter((timer) => timer.id !== active?.id).map((timer) => {
            const left = remainingSeconds(timer, now);
            const duration = timer.total_seconds ?? left;
            return <li key={timer.id} className="grid justify-items-center gap-2">
              <Button type="button" variant="ghost" aria-label={`Select ${timer.text}, ${displayTime(left)} remaining`} onClick={() => setSelectedId(timer.id)}>
                <ProgressRing value={duration ? left / duration : 0} size={72} strokeWidth={5} animated={!reducedMotion} label={`${timer.text}, ${displayTime(left)} remaining`}>
                  <span className="text-sm tabular-nums">{displayTime(left)}</span>
                </ProgressRing>
              </Button>
              <Button type="button" variant="outline" onClick={() => void reset(timer)} aria-label={`Reset ${timer.text}`}>Reset</Button>
            </li>;
          })}
        </ul> : null}
      </div>
      {timers.length ? <ul className="m-0 list-none p-0 lg:col-span-2">
        {timers.map((timer) => <ComingUpRow key={timer.id} item={timer} onChanged={() => void changed()} />)}
      </ul> : null}
      <div>
        <h2 className="mb-3 text-lg font-semibold">Quick timers</h2>
        {quickQuery.isError ? <p role="alert">Could not load quick timers.</p> : null}
        <ul className="m-0 list-none p-0">
          {quick.map((timer) => <li key={timer.id} className="flex items-center justify-between gap-3 border-b py-3">
            <Button type="button" variant="ghost" align="start" width="full" aria-label={`Select ${timer.name}, ${timer.minutes} min`} onClick={() => setSelectedId(timer.id)}>
              <span>{timer.name}</span><span className="text-muted-foreground">{timer.minutes} min</span>
            </Button>
            <Button type="button" variant="ghost" aria-label={`Rename ${timer.name}`} onClick={() => { setEditing(timer); setName(timer.name); setMinutes(String(timer.minutes)); setEditorOpen(true); }}>Rename</Button>
            <Button type="button" variant="ghost" aria-label={`Delete ${timer.name}`} onClick={() => void api.deleteQuickTimer(timer.id).then(changed)}>Delete</Button>
          </li>)}
        </ul>
      </div>
      <Sheet open={editorOpen} onOpenChange={setEditorOpen}>
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>{editing ? "Rename quick timer" : "Add quick timer"}</SheetTitle>
            <SheetDescription>Choose a name and duration.</SheetDescription>
          </SheetHeader>
          <form className="grid gap-4 px-4" onSubmit={(event) => void saveQuick(event)}>
            <div className="grid gap-2"><Label htmlFor="quick-name">Name</Label><Input id="quick-name" value={name} onChange={(event) => setName(event.target.value)} required /></div>
            <div className="grid gap-2"><Label htmlFor="quick-minutes">Minutes</Label><Input id="quick-minutes" type="number" min={1} max={1440} value={minutes} onChange={(event) => setMinutes(event.target.value)} required /></div>
            <Button type="submit">Save</Button>
          </form>
        </SheetContent>
      </Sheet>
    </section>
  );
}
