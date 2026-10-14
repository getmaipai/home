import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { DataTable, type DataTableColumn } from "@maipai/ui/src/elements/data-table";
import { Select } from "@maipai/ui/src/primitives/Select";
import { Button } from "@maipai/ui/src/ui/button";
import { Progress } from "@maipai/ui/src/primitives/Progress";
import { Input } from "@maipai/ui/src/ui/input";
import { api, ApiError, type ResolvedSetting, type Roster, type StackVoice } from "@/lib/api";
import { useDataTableControls } from "@/shell/pages/dataTableControls";
import { applyVoiceFilters, distinctFilterValues, presetNameForVoice, toVoiceRow, type VoiceFilters, type VoiceRow } from "@/lib/voice/voiceBrowserRows";
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
  const registryQuery = useQuery({ queryKey: ["settings-registry"], queryFn: api.settingsRegistry, staleTime: Infinity });
  const valuesQuery = useQuery<ResolvedSetting[]>({ queryKey: ["settings-values", `person:${person.id}`], queryFn: () => api.settingsValues(`person:${person.id}`) });
  const [filters, setFilters] = useState<VoiceFilters>({ language: all, country: all, gender: all, source: all });
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<VoicePreviewState>(voicePreviewPlayer.getState());
  useEffect(() => {
    const unsubscribe = voicePreviewPlayer.subscribe(setPreview);
    return () => { unsubscribe(); voicePreviewPlayer.stop(); };
  }, []);
  const source = useMemo(() => (voicesQuery.data?.voices ?? []).filter((v) => person.role !== "child" || v.source === "preset").map(toVoiceRow), [voicesQuery.data, person.role]);
  const options = distinctFilterValues(source);
  const filtered = useMemo(() => applyVoiceFilters(source, filters), [source, filters]);
  const table = useDataTableControls(filtered, columns, "No voices available.", ["name"]);
  const setting = valuesQuery.data?.find((v) => v.key === "tts.voice_id");
  const definition = registryQuery.data?.find((v) => v.key === "tts.voice_id");
  const voiceOptions = definition?.selector === "select" ? definition.range?.options ?? [] : [];
  const current = presetNameForVoice(setting?.value, voiceOptions);
  const canChoose = !setting?.locked && !setting?.reason;
  // ResolvedSetting.reason is the backend's describeSetting result for
  // this person; pass that copy through verbatim rather than inventing a
  // second reason line in the page.
  const settingReason = setting?.reason;
  const error = voicesQuery.isError || registryQuery.isError || valuesQuery.isError;
  const failed = voicesQuery.error ?? registryQuery.error ?? valuesQuery.error;

  async function choose(option: string) {
    setSaving(true);
    try {
      const result = await api.setSetting(`person:${person.id}`, "tts.voice_id", option);
      queryClient.setQueryData<ResolvedSetting[]>(["settings-values", `person:${person.id}`], (old) => (old ?? []).map((item) => item.key === result.key ? result : item));
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
  return <>
    <h2 className="text-base font-medium">Browse voices</h2>
    {settingReason ? <p className="text-sm text-muted-foreground">{settingReason}</p> : null}
    {preview.error ? <p role="alert">{preview.error}</p> : null}
    <AsyncState data={voicesQuery.data && registryQuery.data && valuesQuery.data ? voicesQuery.data.voices : undefined} error={error} isFetching={voicesQuery.isFetching || registryQuery.isFetching || valuesQuery.isFetching} onRetry={() => { void voicesQuery.refetch(); void registryQuery.refetch(); void valuesQuery.refetch(); }} errorMessage={failed instanceof ApiError ? failed.message : failed instanceof Error ? failed.message : "Could not load voices. Check your connection and try again."} loadingLabel="Loading voices">
      {() => <DataTable rows={displayRows} columns={table.columns} getRowId={(row) => row.id} caption="Available voices" sort={table.sort} onSortChange={table.onSortChange} toolbar={toolbar} emptyLabel={table.emptyLabel} rowActionsLabel="Voice actions" rowActions={(row) => {
        const voice = (voicesQuery.data?.voices ?? []).find((v: StackVoice) => v.id === row.id);
        const option = voice && voice.source === "preset" ? presetNameForVoice(voice.id, voiceOptions) : null;
        const selectAction = option && canChoose ? <Button type="button" variant="outline" disabled={saving} onClick={() => void choose(option)}>{current === option ? "Current voice" : "Use this voice"}</Button> : null;
        const busy = preview.voiceId === row.id && preview.busy;
        const playing = preview.voiceId === row.id && !preview.busy;
        if (!voice) return null;
        if (busy) return <><Progress mode="spinner" label={voice.onDisk ? "Preparing this voice preview" : "Downloading this voice"} /><Button type="button" variant="outline" disabled>{voice.onDisk ? "Starting" : "Downloading"}</Button>{selectAction}</>;
        if (voice.onDisk) return <><Button type="button" variant="outline" onClick={() => playing ? voicePreviewPlayer.stop() : void voicePreviewPlayer.start(row.id)}>{playing ? "Stop" : "Play"}</Button>{selectAction}</>;
        if (person.role === "child" || !["owner", "admin"].includes(person.role) || voice.source !== "preset") return <><span>Not installed. This voice is not on this home yet. Ask the person who manages Home to add it.</span>{selectAction}</>;
        return <><Button type="button" variant="outline" disabled={saving} onClick={() => void voicePreviewPlayer.start(row.id, () => { void queryClient.invalidateQueries({ queryKey: ["stack-voices"] }); })}>Download</Button>{selectAction}</>;
      }} />}
    </AsyncState>
  </>;
}
