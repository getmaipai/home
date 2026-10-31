import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/dashboard/components/ui/alert-dialog";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { ApiError, api, type ResolvedSetting, type StackVoice } from "@/lib/api";
import { householdVoicesApi, type HouseholdVoice } from "@/lib/householdVoicesApi";
import { playableVoices, presetNameForVoice, voiceDisplayName } from "@/lib/voice/voiceBrowserRows";
import { voicePreviewPlayer, type VoicePreviewState } from "@/lib/voice/voicePreviewPlayer";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@maipai/ui/src/ui/dialog";
import { Input } from "@maipai/ui/src/ui/input";
import { AddVoiceForm } from "@/apps/settings/AddVoiceForm";

const GENDER: Record<StackVoice["gender"], string> = { female: "Female", male: "Male", neutral: "Neutral", unknown: "Not stated" };
const COLUMNS = "md:grid-cols-[minmax(0,1fr)_5.5rem_6rem_6.5rem_20rem]";
const MUTED = "text-sm text-muted-foreground";

function languageName(code: string): string {
  if (!code || code === "unknown") return "Not stated";
  try { return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code; } catch { return code; }
}
const isEngineVoice = (voice: Pick<StackVoice, "id">) => presetNameForVoice(voice.id, ["default"]) === "default";
const isHomeDefault = (voice: StackVoice, homeDefault: string) => homeDefault === "default" ? isEngineVoice(voice) : voice.id === homeDefault || presetNameForVoice(voice.id, [homeDefault]) === homeDefault;

/** Home settings, Voices (owner and admin): every voice Home can speak with, where it came from, who can hear it, which one is Home's default,
 * and the way to add one made from a recording. */
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
      setNotice(`${voiceDisplayName(voice)} is now Home's default voice.`);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "Could not save Home's default voice. Try again."); }
    finally { setBusyId(null); }
  }

  async function rename(voice: StackVoice, label: string) {
    setRenaming(null); setError(null); setNotice(null); setBusyId(voice.id);
    try {
      const result = await householdVoicesApi.rename(voice.id, label);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["household-voices"] }), queryClient.invalidateQueries({ queryKey: ["stack-voices"] })]);
      setNotice(`The voice is now called ${result.label}.`);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "Could not rename this voice. Try again."); }
    finally { setBusyId(null); }
  }

  async function remove(voice: StackVoice) {
    setRemoving(null); setError(null); setNotice(null); setBusyId(voice.id);
    try {
      voicePreviewPlayer.stop();
      await householdVoicesApi.remove(voice.id);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["household-voices"] }), queryClient.invalidateQueries({ queryKey: ["stack-voices"] }), queryClient.invalidateQueries({ queryKey: ["settings-values"] })]);
      setNotice(`${voiceDisplayName(voice)} was deleted.`);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "Could not delete this voice. Try again."); }
    finally { setBusyId(null); }
  }

  return <section className="flex flex-col gap-4">
    <div className="flex items-start justify-between gap-4">
      <p className="min-w-0 flex-1 text-base text-muted-foreground">Every voice Home can speak with. Home's default voice is used by anyone, and any robot, with no voice of their own.</p>
      <div className="shrink-0"><Button type="button" onClick={() => { setNotice(null); setAdding(true); }}>Add voice</Button></div>
    </div>
    {notice ? <p role="status" className="text-base text-primary">{notice}</p> : null}
    {error ? <p role="alert" className="text-base text-destructive">{error}</p> : null}
    {preview.error ? <p role="alert" className="text-base text-destructive">{preview.error}</p> : null}
    {failed ? <p role="alert" className="text-base">Home can't reach its voice service. Check Repairs, then come back. <Button type="button" variant="outline" onClick={retry}>Try again</Button></p>
      : <AsyncState data={voicesQuery.data && madeQuery.data && homeQuery.data ? voices : undefined} isFetching={voicesQuery.isFetching || madeQuery.isFetching || homeQuery.isFetching} onRetry={retry} loadingLabel="Loading voices">
        {(list) => list.length === 0 ? <p className="text-base text-muted-foreground">Voices are still getting ready. This takes a minute after setup.</p> : <div className="flex flex-col">
          <div className={`hidden gap-3 border-b border-border pb-2 md:grid ${COLUMNS} ${MUTED}`}><span>Voice</span><span>Source</span><span>Gender</span><span>Language</span><span className="text-right">Actions</span></div>
          <ul className="flex flex-col divide-y divide-[var(--border)]">{list.map((voice) => {
            const custom = voice.source === "cloned";
            const home = isHomeDefault(voice, homeDefault);
            const record = made.get(voice.id);
            const testing = preview.voiceId === voice.id;
            const detail = [custom ? "Custom" : "Built in", GENDER[voice.gender], languageName(voice.language)].join(" · ");
            return <li key={voice.id} className={`grid items-center gap-x-3 gap-y-2 py-3 ${COLUMNS}`}>
              <div className="flex min-w-0 flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-2"><span className="truncate text-base font-medium">{voiceDisplayName(voice)}</span>{home ? <Badge variant="secondary">Home's default</Badge> : null}</div>
                <span className={MUTED}>{record ? `Made by ${record.creatorName}${record.temperature !== undefined ? ` · Liveliness ${record.temperature}` : ""}${record.pitchSemitones ? ` · Pitch ${record.pitchSemitones > 0 ? "+" : ""}${record.pitchSemitones}` : ""}` : isEngineVoice(voice) ? "The voice built into Home's speech engine." : "Comes with Home."}</span>
                <span className={`${MUTED} md:hidden`}>{detail}</span>
              </div>
              <span className="hidden text-base md:block">{custom ? "Custom" : "Built in"}</span>
              <span className="hidden text-base md:block">{GENDER[voice.gender]}</span>
              <span className="hidden text-base md:block">{languageName(voice.language)}</span>
              <div className="flex flex-wrap gap-2 md:flex-nowrap md:justify-end">
                <Button type="button" variant="outline" onClick={() => testing ? voicePreviewPlayer.stop() : void voicePreviewPlayer.start(voice.id)}>{testing && !preview.busy ? "Stop" : "Test"}</Button>
                {home ? null : <Button type="button" variant="outline" disabled={busyId === voice.id} onClick={() => void setDefault(voice)}>Set as default</Button>}
                {custom ? <Button type="button" variant="outline" disabled={busyId === voice.id} onClick={() => { setNewName(record?.label ?? voiceDisplayName(voice)); setRenaming(voice); }}>Rename</Button> : null}
                {custom ? <Button type="button" variant="outline" disabled={busyId === voice.id} onClick={() => setRemoving(voice)}>Delete</Button> : null}
              </div>
            </li>;
          })}</ul>
        </div>}
      </AsyncState>}
    <Dialog open={adding} onOpenChange={(open) => { if (!addBusy) setAdding(open); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a voice</DialogTitle>
          <DialogDescription>Make a voice from a WAV, MP3 or FLAC recording of 6 to 30 seconds. Everyone in the home can pick it, and so can a robot.</DialogDescription>
        </DialogHeader>
        <AddVoiceForm onBusyChange={setAddBusy} onCancel={() => setAdding(false)} onMade={(name) => { setAdding(false); setNotice(`${name} is ready. Test it here, then pick it for a person or a robot.`); }} />
      </DialogContent>
    </Dialog>
    <Dialog open={renaming !== null} onOpenChange={(open) => { if (!open) setRenaming(null); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename {renaming ? voiceDisplayName(renaming) : "this voice"}</DialogTitle>
          <DialogDescription>Only the name changes. The recording stays the same, and everyone and every robot using this voice keeps it.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); if (renaming && newName.trim()) void rename(renaming, newName); }}>
          <Input aria-label="Voice name" value={newName} maxLength={40} onChange={(event) => setNewName(event.target.value)} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setRenaming(null)}>Cancel</Button>
            <Button type="submit" disabled={!newName.trim()}>Save name</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
    <AlertDialog open={removing !== null} onOpenChange={(open) => { if (!open) setRemoving(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {removing ? voiceDisplayName(removing) : "this voice"}?</AlertDialogTitle>
          <AlertDialogDescription>Anyone, and any robot, using it goes back to Home's default voice. The recording is deleted from Home.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => removing && void remove(removing)}>Delete voice</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}
