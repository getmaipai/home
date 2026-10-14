import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { ErrorState } from "@maipai/ui/src/elements/error-state";
import { DataTable, type DataTableColumn } from "@maipai/ui/src/elements/data-table";
import { Select } from "@maipai/ui/src/primitives/Select";
import { Button } from "@maipai/ui/src/ui/button";
import { Progress } from "@maipai/ui/src/primitives/Progress";
import { Chip } from "@maipai/ui/src/primitives/Chip";
import { Input } from "@maipai/ui/src/ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { api, ApiError, type PersonRosterEntry, type ResolvedSetting, type Roster, type StackVoice } from "@/lib/api";
import { useDataTableControls } from "@/shell/pages/dataTableControls";
import { applyVoiceFilters, distinctFilterValues, listForTarget, presetNameForVoice, toVoiceRow, voiceTargets, type VoiceFilters, type VoiceRow } from "@/lib/voice/voiceBrowserRows";
import { voicePreviewPlayer, type VoicePreviewState } from "@/lib/voice/voicePreviewPlayer";

const columns: readonly DataTableColumn<VoiceRow>[] = [
  { id: "id", header: "ID", minWidth: 100 },
  { id: "name", header: "Name", minWidth: 90 }, { id: "description", header: "Description", minWidth: 100 },
  { id: "languageCountry", header: "Language / country", minWidth: 160 }, { id: "gender", header: "Gender", minWidth: 85 },
  { id: "source", header: "Source", minWidth: 75 }, { id: "installed", header: "Installed", minWidth: 80 },
];
const all = "__all";

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
  const [filters, setFilters] = useState<VoiceFilters>({ language: all, country: all, gender: all, source: all });
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<VoicePreviewState>(voicePreviewPlayer.getState());
  useEffect(() => {
    const unsubscribe = voicePreviewPlayer.subscribe(setPreview);
    return () => { unsubscribe(); voicePreviewPlayer.stop(); };
  }, []);
  const targetVoices = useMemo(() => listForTarget(voicesQuery.data?.voices ?? [], target), [voicesQuery.data, target]);
  const source = useMemo(() => targetVoices.map(toVoiceRow), [targetVoices]);
  const options = distinctFilterValues(source);
  const filtered = useMemo(() => applyVoiceFilters(source, filters), [source, filters]);
  const table = useDataTableControls(filtered, columns, "No voices available.", ["name"]);
  const setting = valuesQuery.data?.find((v) => v.key === "tts.voice_id");
  const definition = registryQuery.data?.find((v) => v.key === "tts.voice_id");
  const voiceOptions = definition?.selector === "select" ? definition.range?.options ?? [] : [];
  const current = presetNameForVoice(setting?.value, voiceOptions);
  const canChoose = target.id === person.id ? person.role !== "child" && !setting?.locked && !setting?.reason : isGuardian && target.role === "child";
  // ResolvedSetting.reason is the backend's describeSetting result for
  // this person; pass that copy through verbatim rather than inventing a
  // second reason line in the page.
  const settingReason = setting?.reason;
  const error = voicesQuery.isError || registryQuery.isError || valuesQuery.isError || (isGuardian && rosterQuery.isError);
  const failed = voicesQuery.error ?? registryQuery.error ?? valuesQuery.error ?? rosterQuery.error;
  const retry = () => { void voicesQuery.refetch(); void registryQuery.refetch(); void valuesQuery.refetch(); if (isGuardian) void rosterQuery.refetch(); };

  async function choose(option: string) {
    setSaving(true);
    try {
      const result = await api.setSetting(`person:${target.id}`, "tts.voice_id", option);
      queryClient.setQueryData<ResolvedSetting[]>(["settings-values", `person:${target.id}`], (old) => (old ?? []).map((item) => item.key === result.key ? result : item));
    } finally { setSaving(false); }
  }

  const toolbar = <div className="flex flex-col gap-3">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <Input type="search" aria-label="Search voice names" placeholder="Search by name" value={table.search} onChange={(event) => table.onSearchChange(event.target.value)} />
    </div>
    <div className="flex flex-wrap gap-2">
      {(["language", "country", "gender", "source"] as const).map((key) => <Select key={key} aria-label={`Filter by ${key}`} value={filters[key]} options={[all, ...options[key]]} getLabel={(value) => value === all ? "All" : value} onValueChange={(value) => setFilters((old) => ({ ...old, [key]: value }))} />)}
    </div>
  </div>;

  const displayRows: VoiceRow[] = table.rows.map((row) => row);
  const topChoices = source.slice(0, 6).map((row) => ({ row, voice: targetVoices.find((voice) => voice.id === row.id)! }));
  return <>
    <h2 className="text-base font-medium">Browse voices</h2>
    {isGuardian && targets.length ? <><p>Choosing a voice for</p><Select aria-label="Choosing a voice for" value={target.id} options={targets.map((entry) => entry.id)} getLabel={(id) => id === person.id ? "You" : targets.find((entry) => entry.id === id)?.display_name ?? id} onValueChange={setTargetId} /></> : null}
    {target.role === "child" ? <p>Ask a parent to choose your voice.</p> : null}
    {settingReason && target.id === person.id ? <p className="text-sm text-muted-foreground">{settingReason}</p> : null}
    {topChoices.length ? <ItemGroup aria-label="Top voice choices">{topChoices.map(({ row, voice }) => {
      const option = voice.source === "preset" ? presetNameForVoice(voice.id, voiceOptions) : null;
      return <Item key={voice.id} variant="outline">
        <ItemContent><ItemTitle>{row.name}</ItemTitle><ItemDescription>{row.description} · {row.languageCountry}</ItemDescription></ItemContent>
        <ItemActions>
          {preview.voiceId === voice.id && preview.busy ? <Progress mode="spinner" label="Preparing this voice preview" /> : <Button type="button" variant="outline" onClick={() => preview.voiceId === voice.id ? voicePreviewPlayer.stop() : void voicePreviewPlayer.start(voice.id)}>{preview.voiceId === voice.id ? "Stop" : "Play"}</Button>}
          {option && voice.onDisk && canChoose ? current === option ? <Chip selected>Current voice</Chip> : <Button type="button" variant="outline" disabled={saving} onClick={() => void choose(option)}>Use this voice</Button> : null}
        </ItemActions>
      </Item>;
    })}</ItemGroup> : null}
    {preview.error ? <p role="alert">{preview.error}</p> : null}
    {error ? <><ErrorState layout="inline" title={failed instanceof ApiError ? failed.message : failed instanceof Error ? failed.message : "Could not load voices. Check your connection and try again."} retrying={false} /><Button type="button" variant="outline" onClick={retry}>Try again</Button></> : <AsyncState data={voicesQuery.data && registryQuery.data && valuesQuery.data ? voicesQuery.data.voices : undefined} isFetching={voicesQuery.isFetching || registryQuery.isFetching || valuesQuery.isFetching || (isGuardian && rosterQuery.isFetching)} onRetry={retry} loadingLabel="Loading voices">
      {() => <DataTable rows={displayRows} columns={table.columns} getRowId={(row) => row.id} caption="Available voices" sort={table.sort} onSortChange={table.onSortChange} toolbar={toolbar} emptyLabel={table.emptyLabel} rowActionsLabel="Voice actions" rowActions={(row) => {
        const voice = (voicesQuery.data?.voices ?? []).find((v: StackVoice) => v.id === row.id);
        const option = voice?.source === "preset" ? presetNameForVoice(voice.id, voiceOptions) : null;
        const selectAction = option && voice?.onDisk && canChoose ? current === option ? <Chip selected>Current voice</Chip> : <Button type="button" variant="outline" disabled={saving} onClick={() => void choose(option)}>Use this voice</Button> : null;
        const busy = preview.voiceId === row.id && preview.busy;
        const playing = preview.voiceId === row.id && !preview.busy;
        if (!voice) return null;
        if (busy) return <><Progress mode="spinner" label={voice.onDisk ? "Preparing this voice preview" : "Downloading this voice"} /><Button type="button" variant="outline" disabled>{voice.onDisk ? "Starting" : "Downloading"}</Button>{selectAction}</>;
        if (voice.onDisk) return <><Button type="button" variant="outline" onClick={() => playing ? voicePreviewPlayer.stop() : void voicePreviewPlayer.start(row.id)}>{playing ? "Stop" : "Play"}</Button>{selectAction}</>;
        if (target.role === "child" || !["owner", "admin"].includes(person.role) || voice.source !== "preset") return <><span>Not installed. This voice is not on this home yet. Ask the person who manages Home to add it.</span>{selectAction}</>;
        return <><Button type="button" variant="outline" disabled={saving} onClick={() => void voicePreviewPlayer.start(row.id, () => { void queryClient.invalidateQueries({ queryKey: ["stack-voices"] }); })}>Download</Button>{selectAction}</>;
      }} />}
    </AsyncState>}
  </>;
}
