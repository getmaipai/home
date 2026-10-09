import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { Input } from "@maipai/ui/src/dashboard/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/dashboard/components/ui/select";

type Kind = "smoke" | "carbon_monoxide" | "gas" | "water_leak" | "alarm_panel";
type Mapping = { entityId: string; area: string | null; kind: Kind };
const kinds: { id: Kind; label: string }[] = [
  { id: "smoke", label: "Smoke" },
  { id: "carbon_monoxide", label: "Carbon monoxide" },
  { id: "gas", label: "Gas" },
  { id: "water_leak", label: "Water leak" },
  { id: "alarm_panel", label: "Alarm panel or other" },
];

export function SafetyAlarmMappings() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["safety-alarm-sensors"], queryFn: api.safetyAlarmSensors });
  const [draft, setDraft] = useState<Mapping[]>([]);
  useEffect(() => { if (query.data) setDraft(query.data.mappings); }, [query.data]);
  const save = useMutation({
    mutationFn: (mappings: Mapping[]) => api.saveSafetyAlarmSensors(mappings),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["safety-alarm-sensors"] }); },
  });

  return <section className="rounded-lg border p-4" aria-labelledby="safety-alarm-sensors-title">
    <h3 id="safety-alarm-sensors-title" className="font-medium">Home safety alarm sensors</h3>
    <p className="mt-1 text-sm text-muted-foreground">Mapped Home Assistant sensors raise a fixed alarm after staying on for 10 seconds. The alarm always overrides quiet hours and cannot be turned off.</p>
    {query.isLoading ? <p role="status" className="mt-3 text-sm">Loading Home Assistant sensors…</p> : null}
    {query.isError ? <p role="alert" className="mt-3 text-sm text-destructive">{query.error instanceof Error ? query.error.message : "Could not load Home Assistant sensors."}</p> : null}
    {query.data ? <>
      {draft.map((mapping, index) => <div key={`${mapping.entityId}-${index}`} className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">Sensor
          <Select value={mapping.entityId} onValueChange={(entityId) => {
            const candidate = query.data.candidates.find((item) => item.entityId === entityId);
            setDraft((current) => current.map((item, i) => i === index ? { ...item, entityId, kind: candidate?.suggestedKind ?? item.kind, area: candidate?.area ?? item.area } : item));
          }}>
            <SelectTrigger className="min-h-12" aria-label={`Sensor ${index + 1}`}><SelectValue placeholder="Choose a sensor" /></SelectTrigger>
            <SelectContent>{query.data.candidates.map((candidate) => <SelectItem key={candidate.entityId} value={candidate.entityId}>{candidate.name} · {candidate.entityId}</SelectItem>)}</SelectContent>
          </Select>
          {query.data.candidates.find((item) => item.entityId === mapping.entityId)?.deviceClass ? <span className="text-xs text-muted-foreground">Home Assistant class: {query.data.candidates.find((item) => item.entityId === mapping.entityId)?.deviceClass}</span> : null}
        </label>
        <label className="grid gap-1 text-sm">Alarm kind
          <Select value={mapping.kind} onValueChange={(kind) => setDraft((current) => current.map((item, i) => i === index ? { ...item, kind: kind as Kind } : item))}>
            <SelectTrigger className="min-h-12" aria-label={`Alarm kind ${index + 1}`}><SelectValue /></SelectTrigger>
            <SelectContent>{kinds.map((kind) => <SelectItem key={kind.id} value={kind.id}>{kind.label}</SelectItem>)}</SelectContent>
          </Select>
        </label>
        <label className="grid gap-1 text-sm">Home Assistant area
          <Input className="min-h-12" value={mapping.area ?? ""} onChange={(event) => setDraft((current) => current.map((item, i) => i === index ? { ...item, area: event.target.value || null } : item))} placeholder="For example, Kitchen" aria-label={`Area ${index + 1}`} />
        </label>
        <div className="flex items-end"><Button type="button" variant="outline" className="min-h-12" onClick={() => setDraft((current) => current.filter((_, i) => i !== index))}>Remove sensor</Button></div>
      </div>)}
      {query.data.candidates.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No Home Assistant binary sensors are available.</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" variant="outline" className="min-h-12" disabled={query.data.candidates.length === 0} onClick={() => setDraft((current) => [...current, { entityId: "", area: null, kind: "alarm_panel" }])}>Add sensor</Button>
        <Button type="button" className="min-h-12" disabled={save.isPending || draft.some((item) => !item.entityId)} onClick={() => save.mutate(draft.map((item) => ({ ...item, area: item.area?.trim() || null })))}>{save.isPending ? "Saving…" : "Save sensor mappings"}</Button>
      </div>
      {save.isError ? <p role="alert" className="mt-2 text-sm text-destructive">{save.error instanceof Error ? save.error.message : "Could not save the sensor mappings."}</p> : null}
      {save.isSuccess ? <p role="status" className="mt-2 text-sm">Alarm sensor mappings saved.</p> : null}
    </> : null}
  </section>;
}
