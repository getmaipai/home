import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { Select } from "@maipai/ui/src/primitives/Select";
import { Progress } from "@maipai/ui/src/primitives/Progress";
import { Button } from "@maipai/ui/src/ui/button";
import { api, type PersonRosterEntry, type ResolvedSetting, type Roster } from "@/lib/api";
import { playableVoices, presetNameForVoice, storedVoiceName, voiceFriendlyName, voiceTargets } from "@/lib/voice/voiceBrowserRows";
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
  const [preview, setPreview] = useState<VoicePreviewState>(voicePreviewPlayer.getState());
  useEffect(() => {
    const unsubscribe = voicePreviewPlayer.subscribe(setPreview);
    return () => { unsubscribe(); voicePreviewPlayer.stop(); };
  }, []);
  const voices = useMemo(() => playableVoices(voicesQuery.data?.voices ?? []), [voicesQuery.data]);
  const setting = valuesQuery.data?.find((v) => v.key === "tts.voice_id");
  const definition = registryQuery.data?.find((v) => v.key === "tts.voice_id");
  const voiceOptions = definition?.selector === "select" ? definition.range?.options ?? [] : [];
  const stored = typeof setting?.value === "string" && setting.value ? setting.value : null;
  const canChoose = target.id === person.id ? person.role !== "child" && !setting?.locked && !setting?.reason : isGuardian && target.role === "child";
  // ResolvedSetting.reason is the backend's own copy for this person; shown as given.
  const settingReason = setting?.reason;
  const failed = voicesQuery.isError || registryQuery.isError || valuesQuery.isError || (isGuardian && rosterQuery.isError);
  const retry = () => { void voicesQuery.refetch(); void registryQuery.refetch(); void valuesQuery.refetch(); if (isGuardian) void rosterQuery.refetch(); };
  const who = target.id === person.id ? "you" : target.display_name;

  async function choose(option: string) {
    voicePreviewPlayer.stop();
    setSaving(true); setSaved(false); setSaveError(null);
    try {
      const result = await api.setSetting(`person:${target.id}`, "tts.voice_id", option);
      queryClient.setQueryData<ResolvedSetting[]>(["settings-values", `person:${target.id}`], (old) => (old ?? []).map((item) => item.key === result.key ? result : item));
      setSaved(true);
    } catch { setSaveError("Home could not save that voice. Try again."); } finally { setSaving(false); }
  }

  // The dropdown shows the stored value always: a stored voice missing from the list is added with its name and a note.
  const storedVoice = stored ? voices.find((voice) => voice.id === stored || presetNameForVoice(voice.id, [stored]) === stored) : undefined;
  const missingId = stored && !storedVoice && voices.length > 0 ? `stored:${stored}` : null;
  const selectedId = storedVoice?.id ?? missingId ?? (voices.length === 1 ? voices[0]!.id : "");
  const nameOf = (id: string) => id === missingId ? `${storedVoiceName(stored!)} (not on this home's list)` : voiceFriendlyName(voices.find((voice) => voice.id === id)!);
  const optionIds = missingId ? [missingId, ...voices.map((voice) => voice.id)] : voices.map((voice) => voice.id);
  const testing = preview.voiceId === selectedId && selectedId !== "";
  const testBusy = testing && preview.busy;
  const testReason = voices.length === 0 ? null : missingId && selectedId === missingId ? "This voice is not on the list, so it cannot be tested." : null;
  return <>
    <h2 className="text-base font-medium">Choose a voice for {who}</h2>
    {isGuardian && targets.length > 1 ? <Select aria-label="Choose a voice for" value={target.id} options={targets.map((entry) => entry.id)} getLabel={(id) => id === person.id ? "You" : targets.find((entry) => entry.id === id)?.display_name ?? id} onValueChange={(id) => { voicePreviewPlayer.stop(); setTargetId(id); setSaved(false); setSaveError(null); }} /> : null}
    {target.role === "child" ? <p>Ask a parent to choose your voice.</p> : null}
    {settingReason && target.id === person.id ? <p className="text-sm text-muted-foreground">{settingReason}</p> : null}
    {failed ? <><p role="alert">Home can't reach its voice service. Check Repairs, then come back. <Button type="button" variant="outline" onClick={retry}>Try again</Button></p><Button type="button" variant="outline" disabled>Test</Button></> : <AsyncState data={voicesQuery.data && registryQuery.data && valuesQuery.data ? voices : undefined} isFetching={voicesQuery.isFetching || registryQuery.isFetching || valuesQuery.isFetching || (isGuardian && rosterQuery.isFetching)} onRetry={retry} loadingLabel="Loading voices">
      {(list) => list.length === 0 ? <><p>Voices are still getting ready. This takes a minute after setup.</p><Button type="button" variant="outline" disabled>Test</Button></> : <div className="flex flex-wrap items-center gap-2">
        <Select aria-label={`Voice for ${who}`} value={selectedId} options={optionIds} getLabel={nameOf} disabled={!canChoose || saving || list.every((voice) => !presetNameForVoice(voice.id, voiceOptions))} onValueChange={(id) => { const option = presetNameForVoice(id, voiceOptions); if (option && option !== stored) void choose(option); }} />
        {testBusy ? <Progress mode="spinner" label="Preparing the voice test" /> : null}
        <Button type="button" variant="outline" disabled={testReason !== null || testBusy} onClick={() => testing ? voicePreviewPlayer.stop() : void voicePreviewPlayer.start(selectedId)}>{testing && !testBusy ? "Stop" : "Test"}</Button>
      </div>}
    </AsyncState>}
    {testReason ? <p className="text-sm text-muted-foreground">{testReason}</p> : null}
    {preview.error ? <p role="alert">{preview.error}</p> : null}
    {saveError ? <p role="alert">{saveError}</p> : null}
    <p role="status" className="text-sm text-muted-foreground">{saved ? "Saved." : ""}</p>
  </>;
}
