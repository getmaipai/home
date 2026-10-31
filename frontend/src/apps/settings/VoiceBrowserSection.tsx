import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { Select } from "@maipai/ui/src/primitives/Select";
import { Progress } from "@maipai/ui/src/primitives/Progress";
import { Button } from "@maipai/ui/src/ui/button";
import { api, type PersonRosterEntry, type ResolvedSetting, type Roster } from "@/lib/api";
import { playableVoices, previewIdFor, voiceChoices, voiceTargets } from "@/lib/voice/voiceBrowserRows";
import { voicePreviewPlayer, type VoicePreviewState } from "@/lib/voice/voicePreviewPlayer";

/** "Choose a voice for <who>": ONE dropdown bound to tts.voice_id, a Test button beside it. */
export function VoiceBrowserSection({ person }: { person: Roster }) {
  const queryClient = useQueryClient();
  const voicesQuery = useQuery({ queryKey: ["stack-voices"], queryFn: api.stackVoices });
  const isGuardian = person.role === "owner" || person.role === "admin";
  const rosterQuery = useQuery<PersonRosterEntry[]>({ queryKey: ["people"], queryFn: api.people, enabled: isGuardian });
  const targets = useMemo(() => voiceTargets(rosterQuery.data ?? [], person), [rosterQuery.data, person]);
  const [targetId, setTargetId] = useState(person.id);
  const target = targets.find((entry) => entry.id === targetId) ?? person;
  const registryQuery = useQuery({ queryKey: ["settings-registry"], queryFn: api.settingsRegistry, staleTime: Infinity });
  const valuesQuery = useQuery<ResolvedSetting[]>({ queryKey: ["settings-values", `person:${target.id}`], queryFn: () => api.settingsValues(`person:${target.id}`) });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // The line shown after a saved voice the engine does not offer was set to the default voice (kept until the person or page changes).
  const [migrated, setMigrated] = useState<{ target: string; line: string } | null>(null);
  const attempted = useRef(new Set<string>());
  const [preview, setPreview] = useState<VoicePreviewState>(voicePreviewPlayer.getState());
  useEffect(() => {
    const unsubscribe = voicePreviewPlayer.subscribe(setPreview);
    return () => { unsubscribe(); voicePreviewPlayer.stop(); };
  }, []);
  const voices = useMemo(() => playableVoices(voicesQuery.data?.voices ?? []), [voicesQuery.data]);
  const setting = valuesQuery.data?.find((v) => v.key === "tts.voice_id");
  const definition = registryQuery.data?.find((v) => v.key === "tts.voice_id");
  const voiceOptions = useMemo(() => definition?.selector === "select" ? definition.range?.options ?? [] : [], [definition]);
  const stored = typeof setting?.value === "string" && setting.value ? setting.value : null;
  const canChoose = target.id === person.id ? person.role !== "child" && !setting?.locked && !setting?.reason : isGuardian && target.role === "child";
  // ResolvedSetting.reason is the backend's own copy for this person; shown as given.
  const settingReason = setting?.reason;
  const failed = voicesQuery.isError || registryQuery.isError || valuesQuery.isError || (isGuardian && rosterQuery.isError);
  const retry = () => { void voicesQuery.refetch(); void registryQuery.refetch(); void valuesQuery.refetch(); if (isGuardian) void rosterQuery.refetch(); };
  const who = target.id === person.id ? "you" : target.display_name;

  async function choose(option: string, line?: string) {
    voicePreviewPlayer.stop();
    setSaving(true); setSaved(false); setSaveError(null);
    try {
      const result = await api.setSetting(`person:${target.id}`, "tts.voice_id", option);
      queryClient.setQueryData<ResolvedSetting[]>(["settings-values", `person:${target.id}`], (old) => (old ?? []).map((item) => item.key === result.key ? result : item));
      setSaved(!line);
      setMigrated(line ? { target: target.id, line } : null);
    } catch { setSaveError("Home could not save that voice. Try again."); } finally { setSaving(false); }
  }

  // The dropdown always lists the voice in use (VOICE-PICK-01); a saved voice this engine does not offer falls back to the default with one line.
  // The first choice is Home's default voice, shown by its own name (owner ruling 2026-10-20).
  const homeVoiceQuery = useQuery<ResolvedSetting[]>({ queryKey: ["settings-values", "household"], queryFn: () => api.settingsValues("household") });
  const homeVoice = homeVoiceQuery.data?.find((v) => v.key === "tts.home_voice")?.value;
  const homeDefault = typeof homeVoice === "string" && homeVoice ? homeVoice : "default";
  const choices = useMemo(() => voiceChoices(voices, stored, voiceOptions, homeDefault), [voices, stored, voiceOptions, homeDefault]);
  const selectedId = choices.selected.id;
  // A saved voice this engine does not offer is moved to the default voice once, so the page and the spoken voice agree.
  useEffect(() => {
    const key = `${target.id}:${stored}`;
    if (!choices.notice || !canChoose || saving || voices.length === 0 || attempted.current.has(key)) return;
    attempted.current.add(key);
    void choose("default", choices.notice);
  });
  const previewId = previewIdFor(choices.selected, voices);
  const testing = previewId !== null && preview.voiceId === previewId;
  const testBusy = testing && preview.busy;
  // An owner or admin can test a voice that is not downloaded yet; it downloads on first play (owner ruling 2026-10-17).
  const downloading = testBusy && voices.find((voice) => voice.id === previewId)?.onDisk === false;
  return <>
    <h2 className="text-base font-medium">Choose a voice for {who}</h2>
    {isGuardian && targets.length > 1 ? <Select aria-label="Choose a voice for" value={target.id} options={targets.map((entry) => entry.id)} getLabel={(id) => id === person.id ? "You" : targets.find((entry) => entry.id === id)?.display_name ?? id} onValueChange={(id) => { voicePreviewPlayer.stop(); setTargetId(id); setSaved(false); setSaveError(null); }} /> : null}
    {target.role === "child" ? <p>Ask a parent to choose your voice.</p> : null}
    {settingReason && target.id === person.id ? <p className="text-sm text-muted-foreground">{settingReason}</p> : null}
    {choices.notice || (migrated?.target === target.id && migrated.line) ? <p role="status" className="text-sm text-muted-foreground">{choices.notice ?? migrated?.line}</p> : null}
    {failed ? <><p role="alert">Home can't reach its voice service. Check Repairs, then come back. <Button type="button" variant="outline" onClick={retry}>Try again</Button></p><Button type="button" variant="outline" disabled>Test</Button></> : <AsyncState data={voicesQuery.data && registryQuery.data && valuesQuery.data ? voices : undefined} isFetching={voicesQuery.isFetching || registryQuery.isFetching || valuesQuery.isFetching || (isGuardian && rosterQuery.isFetching)} onRetry={retry} loadingLabel="Loading voices">
      {(list) => list.length === 0 ? <><p>Voices are still getting ready. This takes a minute after setup.</p><Button type="button" variant="outline" disabled>Test</Button></> : <div className="flex flex-wrap items-center gap-2">
        <Select aria-label={`Voice for ${who}`} value={selectedId} options={choices.options.map((option) => option.id)} getLabel={(id) => choices.options.find((option) => option.id === id)?.label ?? id} disabled={!canChoose || saving} onValueChange={(id) => { const option = choices.options.find((entry) => entry.id === id); if (option && option.id !== selectedId) void choose(option.value); }} />
        {testBusy ? <Progress mode="spinner" label="Preparing the voice test" /> : null}
        <Button type="button" variant="outline" disabled={previewId === null || testBusy} onClick={() => testing ? voicePreviewPlayer.stop() : previewId && void voicePreviewPlayer.start(previewId)}>{testing && !testBusy ? "Stop" : "Test"}</Button>
      </div>}
    </AsyncState>}
    {downloading ? <p role="status" className="text-sm text-muted-foreground">Downloading this voice, one moment.</p> : null}
    {preview.error ? <p role="alert">{preview.error}</p> : null}
    {saveError ? <p role="alert">{saveError}</p> : null}
    <p role="status" className="text-sm text-muted-foreground">{saved ? "Saved." : ""}</p>
  </>;
}
