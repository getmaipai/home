import { i18n } from "@lingui/core";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ProgressRing } from "@maipai/ui/src/ui/progress-ring";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { Label } from "@maipai/ui/src/ui/label";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@maipai/ui/src/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@maipai/ui/src/ui/sheet";
import { api, type ComingUpItem, type QuickTimerView } from "@/lib/api";
import { ComingUpRow } from "@/apps/reminders/ComingUpRow";
import { CLOCK_ADD_EVENT } from "@/apps/clock/clockHeader";
import { DestructiveConfirm } from "@maipai/ui/src/primitives/DestructiveConfirm";
import { useHubMutation } from "@/lib/useHubMutation";

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
  const [deleting, setDeleting] = useState<QuickTimerView | null>(null);
  const timerAction = useHubMutation({ verb: "change the timer", mutationFn: async ({ kind, timerId }: { kind: "start" | "done" | "extend"; timerId?: string }) => {
    if (kind === "start") { if (!preset) return null; return api.startTimer(preset.name, preset.minutes); }
    if (!timerId) return null;
    if (kind === "done") await api.doneComingUp(timerId); else await api.extendTimer(timerId);
    return null;
  }, onSuccess: async (result, { kind, timerId }) => { if (kind === "start" && result) setSelectedId(result.id); if (kind === "done" && selectedId === timerId) setSelectedId(null); await changed(); } });
  const quickAction = useHubMutation({ verb: "save the quick timer", mutationFn: async () => { if (editing) await api.updateQuickTimer(editing.id, { name, minutes: Number(minutes) }); else await api.createQuickTimer(name, Number(minutes)); }, onSuccess: async () => { setEditorOpen(false); await changed(); } });
  const deleteAction = useHubMutation({ verb: "delete the quick timer", mutationFn: (timer: QuickTimerView) => api.deleteQuickTimer(timer.id), onSuccess: async () => { setDeleting(null); await changed(); } });

  const timerRows = running;
  const timers = useMemo(() => [...timerRows].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)), [timerRows]);
  const active = timers.find((timer) => timer.id === selectedId) ?? timers[0];
  const quick = Array.isArray(quickQuery.data) ? quickQuery.data : [];
  const preset = quick.find((timer) => timer.id === selectedId) ?? quick[2] ?? quick[0];
  const total = active?.total_seconds ?? (preset?.minutes ?? 25) * 60;
  const remaining = active ? remainingSeconds(active, now) : total;
  const activeLabel = active?.text ?? preset?.name ?? i18n._({ id: "Timer", message: "Timer" });
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

  function start() { void timerAction.run({ kind: "start" }); }

  function reset(timer = active) { if (timer) void timerAction.run({ kind: "done", timerId: timer.id }); }

  function extend() { if (active) void timerAction.run({ kind: "extend", timerId: active.id }); }

  function saveQuick(event: React.FormEvent) {
    event.preventDefault();
    void quickAction.run();
  }

  if (!enabled) return null;

  return (
    <section aria-label={i18n._({ id: "Timers", message: "Timers" })} className="grid gap-8 py-6 lg:grid-cols-2">
      <div className="flex flex-col items-center gap-5">
        <ProgressRing
          value={total ? ringSeconds / total : 0}
          size={240}
          strokeWidth={10}
          animated={!reducedMotion}
          label={i18n._({ id: "{activeLabel}, {displayTime} remaining", message: "{activeLabel}, {displayTime} remaining", values: { activeLabel, displayTime: displayTime(ringSeconds) } })}
        >
          <div className="grid justify-items-center">
            <output aria-live="off" className="text-5xl tabular-nums">{displayTime(ringSeconds)}</output>
            <span className="mt-2 text-sm uppercase tracking-wider text-muted-foreground">{activeLabel}</span>
          </div>
        </ProgressRing>
        <div className="flex flex-wrap justify-center gap-3">
          <Button type="button" disabled={!preset || timerAction.busy} onClick={start}>{i18n._({ id: "Start", message: "Start" })}</Button>
          {active ? <Button type="button" disabled={timerAction.busy} onClick={extend}>{i18n._({ id: "+1 min", message: "+1 min" })}</Button> : null}
          <Button type="button" variant="outline" disabled={!active || timerAction.busy} onClick={() => reset()}>{i18n._({ id: "Reset", message: "Reset" })}</Button>
        </div>
        {timers.length > 1 ? <ul aria-label={i18n._({ id: "Other running timers", message: "Other running timers" })} className="flex flex-wrap justify-center gap-3">
          {timers.filter((timer) => timer.id !== active?.id).map((timer) => {
            const left = remainingSeconds(timer, now);
            const duration = timer.total_seconds ?? left;
            return <li key={timer.id} className="grid justify-items-center gap-2">
              <Button type="button" variant="ghost" aria-label={i18n._({ id: "Select {text}, {displayTime} remaining", message: "Select {text}, {displayTime} remaining", values: { text: timer.text, displayTime: displayTime(left) } })} onClick={() => setSelectedId(timer.id)}>
                <ProgressRing value={duration ? left / duration : 0} size={72} strokeWidth={5} animated={!reducedMotion} label={i18n._({ id: "{text}, {displayTime} remaining", message: "{text}, {displayTime} remaining", values: { text: timer.text, displayTime: displayTime(left) } })}>
                  <span className="text-sm tabular-nums">{displayTime(left)}</span>
                </ProgressRing>
              </Button>
              <Button type="button" variant="outline" onClick={() => void reset(timer)} aria-label={i18n._({ id: "Reset {text}", message: "Reset {text}", values: { text: timer.text } })}>{i18n._({ id: "Reset", message: "Reset" })}</Button>
            </li>;
          })}
        </ul> : null}
      </div>
      {timers.length ? <ul className="m-0 list-none p-0 lg:col-span-2">
        {timers.map((timer) => <ComingUpRow key={timer.id} item={timer} onChanged={() => void changed()} />)}
      </ul> : null}
      <div>
        <h2 className="mb-3 text-lg font-semibold">{i18n._({ id: "Quick timers", message: "Quick timers" })}</h2>
        {quickQuery.isError ? <div role="alert"><p>{i18n._({ id: "Could not load quick timers. Check your connection and try again.", message: "Could not load quick timers. Check your connection and try again." })}</p><Button variant="outline" onClick={() => void quickQuery.refetch()}>{i18n._({ id: "Retry", message: "Retry" })}</Button></div> : null}
        <ul className="m-0 list-none p-0">
          {quick.map((timer) => <li key={timer.id} className="flex items-center justify-between gap-3 border-b py-3">
            <div className="min-w-0 flex-1">
              <Button type="button" variant="ghost" align="start" width="full" aria-label={i18n._({ id: "Select {name}, {minutes} min", message: "Select {name}, {minutes} min", values: { name: timer.name, minutes: timer.minutes } })} onClick={() => setSelectedId(timer.id)}>
                <span className="flex w-full items-center justify-between gap-3">
                  <span>{timer.name}</span>
                  <span className="text-muted-foreground">{i18n._({ id: "{minutes} min", message: "{minutes} min", values: { minutes: timer.minutes } })}</span>
                </span>
              </Button>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" aria-label={i18n._({ id: "More options for {name}", message: "More options for {name}", values: { name: timer.name } })}>{i18n._({ id: "More", message: "More" })}</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => { setEditing(timer); setName(timer.name); setMinutes(String(timer.minutes)); setEditorOpen(true); }}>{i18n._({ id: "Rename", message: "Rename" })}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDeleting(timer)}>{i18n._({ id: "Delete", message: "Delete" })}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>)}
        </ul>
      </div>
      <Sheet open={editorOpen} onOpenChange={setEditorOpen}>
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>{editing ? i18n._({ id: "Rename quick timer", message: "Rename quick timer" }) : i18n._({ id: "Add quick timer", message: "Add quick timer" })}</SheetTitle>
            <SheetDescription>{i18n._({ id: "Choose a name and duration.", message: "Choose a name and duration." })}</SheetDescription>
          </SheetHeader>
          <form className="grid gap-4 px-4" onSubmit={(event) => void saveQuick(event)}>
            <div className="grid gap-2"><Label htmlFor="quick-name">{i18n._({ id: "Name", message: "Name" })}</Label><Input id="quick-name" value={name} onChange={(event) => setName(event.target.value)} required /></div>
            <div className="grid gap-2"><Label htmlFor="quick-minutes">{i18n._({ id: "Minutes", message: "Minutes" })}</Label><Input id="quick-minutes" type="number" min={1} max={1440} value={minutes} onChange={(event) => setMinutes(event.target.value)} required /></div>
            <Button type="submit" disabled={quickAction.busy}>{quickAction.busy ? i18n._({ id: "Saving…", message: "Saving…" }) : i18n._({ id: "Save", message: "Save" })}</Button>
          </form>
        </SheetContent>
      </Sheet>
      {deleting ? <DestructiveConfirm message={i18n._({ id: "Delete {name}?", message: "Delete {name}?", values: { name: deleting.name } })} confirmLabel={i18n._({ id: "Delete timer", message: "Delete timer" })} busyLabel={i18n._({ id: "Deleting", message: "Deleting" })} busy={deleteAction.busy} onConfirm={() => { void deleteAction.run(deleting); }} onCancel={() => setDeleting(null)} /> : null}
    </section>
  );
}
