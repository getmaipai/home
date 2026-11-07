import { i18n } from "@lingui/core";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/dashboard/components/ui/alert-dialog";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { api, type ResolvedSetting, type StackVoice } from "@/lib/api";
import { householdVoicesApi, type HouseholdVoice } from "@/lib/householdVoicesApi";
import { playableVoices, presetNameForVoice, voiceDisplayName } from "@/lib/voice/voiceBrowserRows";
import { voicePreviewPlayer, type VoicePreviewState } from "@/lib/voice/voicePreviewPlayer";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@maipai/ui/src/ui/dialog";
import { Input } from "@maipai/ui/src/ui/input";
import { AddVoiceForm } from "@/apps/settings/AddVoiceForm";
import { errorLine } from "@/lib/hubReachability";
import { languageName as formatLanguageName } from "@/lib/format";
import { activeLocale } from "@/lib/activeLocale";

const genderLabel = (gender: StackVoice["gender"]): string => gender === "female" ? i18n._({ id: "Female", message: "Female" }) : gender === "male" ? i18n._({ id: "Male", message: "Male" }) : gender === "neutral" ? i18n._({ id: "Neutral", message: "Neutral" }) : i18n._({ id: "Not stated", message: "Not stated" });
// AUDIT-UI-01: the five columns need about 640 px; the settings content pane is 728 px at most and about 470 px beside the 1024 px column, so
// the table form starts at xl and narrower screens use the stacked row (name, one detail line, actions).
const COLUMNS = "xl:grid-cols-[minmax(10rem,1fr)_4.5rem_5rem_5.5rem_12rem]";
const MUTED = "text-sm text-muted-foreground";

function languageName(code: string): string {
  if (!code || code === "unknown") return i18n._({ id: "Not stated", message: "Not stated" });
  return formatLanguageName(code, activeLocale());
}
const isEngineVoice = (voice: Pick<StackVoice, "id">) => presetNameForVoice(voice.id, ["default"]) === "default";
const isHomeDefault = (voice: StackVoice, homeDefault: string) => homeDefault === "default" ? isEngineVoice(voice) : voice.id === homeDefault || presetNameForVoice(voice.id, [homeDefault]) === homeDefault;

/** Home settings, Voices (owner and admin): every voice Home can speak with, where it came from, who can hear it, which one is Home's default,
 * and the way to add one made from a recording. A parent or admin sees, listens to and deletes any voice here, a minor's included. */
export function VoiceManagerSection() {
  const queryClient = useQueryClient();
  const voicesQuery = useQuery({ queryKey: ["stack-voices"], queryFn: api.stackVoices });
  const madeQuery = useQuery({ queryKey: ["household-voices"], queryFn: householdVoicesApi.list });
  const homeQuery = useQuery<ResolvedSetting[]>({ queryKey: ["settings-values", "household"], queryFn: () => api.settingsValues("household") });
  const [preview, setPreview] = useState<VoicePreviewState>(voicePreviewPlayer.getState());
  const [adding, setAdding] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [removing, setRemoving] = useState<StackVoice | null>(null);
  const [renaming, setRenaming] = useState<StackVoice | null>(null);
  const [newName, setNewName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = voicePreviewPlayer.subscribe(setPreview);
    return () => { unsubscribe(); voicePreviewPlayer.stop(); };
  }, []);

  const voices = useMemo(() => playableVoices(voicesQuery.data?.voices ?? []), [voicesQuery.data]);
  const made = useMemo(() => new Map((madeQuery.data?.voices ?? []).map((voice: HouseholdVoice) => [voice.id, voice])), [madeQuery.data]);
  const homeValue = homeQuery.data?.find((entry) => entry.key === "tts.home_voice")?.value;
  const homeDefault = typeof homeValue === "string" && homeValue ? homeValue : "default";
  const failed = voicesQuery.isError || madeQuery.isError || homeQuery.isError;
  const retry = () => { void voicesQuery.refetch(); void madeQuery.refetch(); void homeQuery.refetch(); };

  async function setDefault(voice: StackVoice) {
    setError(null); setNotice(null); setBusyId(voice.id);
    try {
      const result = await api.setSetting("household", "tts.home_voice", isEngineVoice(voice) ? "default" : voice.id);
      queryClient.setQueryData<ResolvedSetting[]>(["settings-values", "household"], (old) => (old ?? []).some((item) => item.key === result.key) ? (old ?? []).map((item) => item.key === result.key ? result : item) : [...(old ?? []), result]);
      setNotice(i18n._({ id: "{name} is now Home's default voice.", message: "{name} is now Home's default voice.", values: { name: voiceDisplayName(voice) } }));
    } catch (cause) { setError(errorLine(cause, i18n._({ id: "Could not save Home's default voice. Try again.", message: "Could not save Home's default voice. Try again." }))); }
    finally { setBusyId(null); }
  }

  async function rename(voice: StackVoice, label: string) {
    setRenaming(null); setError(null); setNotice(null); setBusyId(voice.id);
    try {
      const result = await householdVoicesApi.rename(voice.id, label);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["household-voices"] }), queryClient.invalidateQueries({ queryKey: ["stack-voices"] })]);
      setNotice(i18n._({ id: "The voice is now called {label}.", message: "The voice is now called {label}.", values: { label: result.label } }));
    } catch (cause) { setError(errorLine(cause, i18n._({ id: "Could not rename this voice. Try again.", message: "Could not rename this voice. Try again." }))); }
    finally { setBusyId(null); }
  }

  async function remove(voice: StackVoice) {
    setRemoving(null); setError(null); setNotice(null); setBusyId(voice.id);
    try {
      voicePreviewPlayer.stop();
      await householdVoicesApi.remove(voice.id);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["household-voices"] }), queryClient.invalidateQueries({ queryKey: ["stack-voices"] }), queryClient.invalidateQueries({ queryKey: ["settings-values"] })]);
      setNotice(i18n._({ id: "{name} was deleted.", message: "{name} was deleted.", values: { name: voiceDisplayName(voice) } }));
    } catch (cause) { setError(errorLine(cause, i18n._({ id: "Could not delete this voice. Try again.", message: "Could not delete this voice. Try again." }))); }
    finally { setBusyId(null); }
  }

  return <section className="flex flex-col gap-4">
    <div className="flex items-start justify-between gap-4">
      <p className="min-w-0 flex-1 text-base text-muted-foreground">{i18n._({ id: "Every voice Home can speak with. Home's default voice is used by anyone, and any robot, with no voice of their own.", message: "Every voice Home can speak with. Home's default voice is used by anyone, and any robot, with no voice of their own." })}</p>
      <div className="shrink-0"><Button type="button" onClick={() => { setNotice(null); setAdding(true); }}>{i18n._({ id: "Add voice", message: "Add voice" })}</Button></div>
    </div>
    {notice ? <p role="status" className="text-base text-primary">{notice}</p> : null}
    {error ? <p role="alert" className="text-base text-destructive">{error}</p> : null}
    {preview.error ? <p role="alert" className="text-base text-destructive">{preview.error}</p> : null}
    {failed ? <p role="alert" className="text-base">{i18n._({ id: "Home can't reach its voice service. Check Repairs, then come back.", message: "Home can't reach its voice service. Check Repairs, then come back." })} <Button type="button" variant="outline" onClick={retry}>{i18n._({ id: "Try again", message: "Try again" })}</Button></p>
      : <AsyncState data={voicesQuery.data && madeQuery.data && homeQuery.data ? voices : undefined} isFetching={voicesQuery.isFetching || madeQuery.isFetching || homeQuery.isFetching} onRetry={retry} loadingLabel={i18n._({ id: "Loading voices", message: "Loading voices" })}>
        {(list) => list.length === 0 ? <p className="text-base text-muted-foreground">{i18n._({ id: "Voices are still getting ready. This takes a minute after setup.", message: "Voices are still getting ready. This takes a minute after setup." })}</p> : <div className="flex flex-col">
          <div className={`hidden gap-3 border-b border-border pb-2 xl:grid ${COLUMNS} ${MUTED}`}><span>{i18n._({ id: "Voice", message: "Voice" })}</span><span>{i18n._({ id: "Source", message: "Source" })}</span><span>{i18n._({ id: "Gender", message: "Gender" })}</span><span>{i18n._({ id: "Language", message: "Language" })}</span><span className="text-right">{i18n._({ id: "Actions", message: "Actions" })}</span></div>
          <ul className="flex flex-col divide-y divide-[var(--border)]">{list.map((voice) => {
            const custom = voice.source === "cloned";
            const home = isHomeDefault(voice, homeDefault);
            const record = made.get(voice.id);
            const testing = preview.voiceId === voice.id;
            const detail = [custom ? i18n._({ id: "Custom", message: "Custom" }) : i18n._({ id: "Built in", message: "Built in" }), genderLabel(voice.gender), languageName(voice.language)].join(" · ");
            return <li key={voice.id} className={`grid items-center gap-x-3 gap-y-2 py-3 ${COLUMNS}`}>
              <div className="flex min-w-0 flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-2"><span className="truncate text-base font-medium">{voiceDisplayName(voice)}</span>{home ? <Badge variant="secondary">{i18n._({ id: "Home's default", message: "Home's default" })}</Badge> : null}</div>
                <span className={MUTED}>{record ? [i18n._({ id: "Made by {name}", message: "Made by {name}", values: { name: record.creatorName } }), ...(record.temperature !== undefined ? [i18n._({ id: "Liveliness {value}", message: "Liveliness {value}", values: { value: record.temperature } })] : []), ...(record.pitchSemitones ? [i18n._({ id: "Pitch {value}", message: "Pitch {value}", values: { value: `${record.pitchSemitones > 0 ? "+" : ""}${record.pitchSemitones}` } })] : [])].join(" · ") : isEngineVoice(voice) ? i18n._({ id: "The voice built into Home's speech engine.", message: "The voice built into Home's speech engine." }) : i18n._({ id: "Comes with Home.", message: "Comes with Home." })}</span>
                <span className={`${MUTED} xl:hidden`}>{detail}</span>
              </div>
              <span className="hidden text-base xl:block">{custom ? i18n._({ id: "Custom", message: "Custom" }) : i18n._({ id: "Built in", message: "Built in" })}</span>
              <span className="hidden text-base xl:block">{genderLabel(voice.gender)}</span>
              <span className="hidden text-base xl:block">{languageName(voice.language)}</span>
              <div className="flex flex-wrap gap-2 xl:justify-end">
                <Button type="button" variant="outline" onClick={() => testing ? voicePreviewPlayer.stop() : void voicePreviewPlayer.start(voice.id)}>{testing && !preview.busy ? i18n._({ id: "Stop", message: "Stop" }) : i18n._({ id: "Test", message: "Test" })}</Button>
                {home ? null : <Button type="button" variant="outline" disabled={busyId === voice.id} onClick={() => void setDefault(voice)}>{i18n._({ id: "Set as default", message: "Set as default" })}</Button>}
                {custom ? <Button type="button" variant="outline" disabled={busyId === voice.id} onClick={() => { setNewName(record?.label ?? voiceDisplayName(voice)); setRenaming(voice); }}>{i18n._({ id: "Rename", message: "Rename" })}</Button> : null}
                {custom ? <Button type="button" variant="outline" disabled={busyId === voice.id} onClick={() => setRemoving(voice)}>{i18n._({ id: "Delete", message: "Delete" })}</Button> : null}
              </div>
            </li>;
          })}</ul>
        </div>}
      </AsyncState>}
    <Dialog open={adding} onOpenChange={(open) => { if (!addBusy) setAdding(open); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{i18n._({ id: "Add a voice", message: "Add a voice" })}</DialogTitle>
          <DialogDescription>{i18n._({ id: "Make a voice from a WAV, MP3 or FLAC recording of 6 to 30 seconds. Everyone in the home can pick it, and so can a robot.", message: "Make a voice from a WAV, MP3 or FLAC recording of 6 to 30 seconds. Everyone in the home can pick it, and so can a robot." })}</DialogDescription>
        </DialogHeader>
        <AddVoiceForm onBusyChange={setAddBusy} onCancel={() => setAdding(false)} onMade={(name) => { setAdding(false); setNotice(i18n._({ id: "{name} is ready. Test it here, then pick it for a person or a robot.", message: "{name} is ready. Test it here, then pick it for a person or a robot.", values: { name } })); }} />
      </DialogContent>
    </Dialog>
    <Dialog open={renaming !== null} onOpenChange={(open) => { if (!open) setRenaming(null); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{i18n._({ id: "Rename {value}", message: "Rename {value}", values: { value: renaming ? voiceDisplayName(renaming) : i18n._({ id: "this voice", message: "this voice" }) } })}</DialogTitle>
          <DialogDescription>{i18n._({ id: "Only the name changes. The recording stays the same, and everyone and every robot using this voice keeps it.", message: "Only the name changes. The recording stays the same, and everyone and every robot using this voice keeps it." })}</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); if (renaming && newName.trim()) void rename(renaming, newName); }}>
          <Input aria-label={i18n._({ id: "Voice name", message: "Voice name" })} value={newName} maxLength={40} onChange={(event) => setNewName(event.target.value)} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setRenaming(null)}>{i18n._({ id: "Cancel", message: "Cancel" })}</Button>
            <Button type="submit" disabled={!newName.trim()}>{i18n._({ id: "Save name", message: "Save name" })}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
    <AlertDialog open={removing !== null} onOpenChange={(open) => { if (!open) setRemoving(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{i18n._({ id: "Delete {value}?", message: "Delete {value}?", values: { value: removing ? voiceDisplayName(removing) : i18n._({ id: "this voice", message: "this voice" }) } })}</AlertDialogTitle>
          <AlertDialogDescription>{i18n._({ id: "Anyone, and any robot, using it goes back to Home's default voice. The recording is deleted from Home.", message: "Anyone, and any robot, using it goes back to Home's default voice. The recording is deleted from Home." })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{i18n._({ id: "Cancel", message: "Cancel" })}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => removing && void remove(removing)}>{i18n._({ id: "Delete voice", message: "Delete voice" })}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}
