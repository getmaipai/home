import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type EnginesOverview, type ResolvedSetting, type Roster } from "@/lib/api";
import { engineImpact, type EngineImpactProposal } from "@maipai/home-backend/src/lib/engineImpact";
import { roleNames } from "@/lib/fitPanel";

const ROLE_ORDER = ["chat", "router", "embed", "rerank", "vision", "image", "video", "music", "coding", "judge", "tts", "stt", "wakeword"] as const;
const GIB = 1024 ** 3;
const formatMemory = (bytes: number) => `${(bytes / GIB).toFixed(1)} GB`;
const ROLE_DETAILS: Record<string, string> = {
  chat: "Writes replies. Turning it off stops chat answers.", router: "Chooses the right tool for a request.", embed: "Finds relevant memories and documents.", rerank: "Sorts search results by relevance.",
  vision: "Understands photos sent in chat.", image: "Creates pictures.", video: "Creates or understands video.", music: "Creates or understands music.", coding: "Helps with coding tasks.", judge: "Checks answers for safety.", tts: "Reads replies aloud.", stt: "Turns speech into text.", wakeword: "Listens for the wake word.",
};

export function SizingPanel({ person, onRemoval }: { person: Roster; onRemoval: (message: string, confirm: () => void) => void }) {
  const queryClient = useQueryClient();
  const overview = useQuery<EnginesOverview>({ queryKey: ["engines"], queryFn: () => api.engines(), enabled: person.role === "owner" || person.role === "admin" });
  const values = useQuery<ResolvedSetting[]>({ queryKey: ["settings-values", "household"], queryFn: () => api.settingsValues("household"), enabled: person.role === "owner" || person.role === "admin" });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const data = overview.data;
  const settings = values.data;
  const roles = useMemo(() => ROLE_ORDER.flatMap((id) => {
    const role = data?.roles.find((candidate) => candidate.id === id);
    if (!role) return [];
    const key = `engines.${id}.choice`;
    const saved = settings?.find((item) => item.key === key)?.value;
    const current = draft[id] ?? (typeof saved === "string" ? saved : role.model?.id ?? "auto");
    const model = role.model;
    const hasMeasured = model?.measuredFootprintBytes !== null && model?.measuredFootprintBytes !== undefined && !model.estimated;
    const currentId = current;
    const measuredChoice = model && hasMeasured ? [{ id: model.id, label: model.id, memoryBytes: model.measuredFootprintBytes!, speed: "not measured" as const }] : [];
    const choices = currentId === "off" ? [] : currentId === "auto" ? measuredChoice : currentId === model?.id ? measuredChoice : [];
    const proposalRole = { role: id, label: roleNames[id] ?? role.label, proposed: currentId === "auto" ? model?.id ?? "auto" : currentId, choices };
    return [{ id, key, label: roleNames[id] ?? role.label, current, currentId, model, hasMeasured, proposalRole }];
  }), [data, settings, draft]);
  const proposal: EngineImpactProposal = {
    hardware: { unifiedMemory: false, systemMemoryBytes: null, graphicsMemoryBytes: null },
    roles: roles.map((role) => role.proposalRole),
    choices: Object.fromEntries(roles.map((role) => [role.id, (draft[role.id] ?? role.currentId) === "auto" ? role.model?.id ?? "auto" : draft[role.id] ?? role.currentId])),
  };
  const impact = engineImpact(proposal);

  async function save(key: string, role: string, value: string, confirmRemoval = false) {
    setPending(role); setError(null);
    try {
      const updated = await api.setSetting("household", key, value, confirmRemoval);
      queryClient.setQueryData<ResolvedSetting[]>(["settings-values", "household"], (old) => (old ?? []).map((item) => item.key === updated.key ? updated : item));
      setDraft((old) => ({ ...old, [role]: value }));
    } catch (e) {
      if (e instanceof ApiError && value === "off" && e.message.includes("users will lose access") && !confirmRemoval) onRemoval(e.message, () => void save(key, role, value, true));
      else setError(e instanceof ApiError ? e.message : "Could not save that engine choice.");
    } finally { setPending(null); }
  }

  if (person.role !== "owner" && person.role !== "admin") return null;
  return <>
        <h2 className="text-lg font-semibold">Memory and model choices</h2>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {overview.isLoading || values.isLoading ? <p role="status">Loading engine choices.</p> : null}
      {!data?.configured ? <p className="text-sm text-muted-foreground">Connect this computer to MaiPai Stack to see model memory measurements.</p> : null}
      {roles.map((role) => {
        const selected = draft[role.id] ?? role.currentId;
        const impactRole = impact.roles.find((item) => item.role === role.id);
        const stepDown = role.currentId === "off" ? undefined : "off";
        return <section key={role.id} className="flex flex-col gap-2 border-b border-border pb-4" aria-label={`${role.label} sizing`}>
          <h3 className="font-medium">{role.label}</h3>
          <p className="text-sm">Current choice: {role.current === "auto" ? `Auto (${role.model?.id ?? "model not selected"})` : role.current}</p>
          <p className="text-sm text-muted-foreground">{role.hasMeasured ? `Keeps ${formatMemory(role.model!.measuredFootprintBytes!)} memory.` : "Memory kept back: not measured yet."} {ROLE_DETAILS[role.id]}</p>
          {impactRole ? <p className="text-sm text-muted-foreground">{impactRole.impact}</p> : null}
          <div className="flex flex-wrap items-center gap-2">
            {stepDown ? <button type="button" className="min-h-12 min-w-12 px-3 py-2" disabled={pending === role.id} onClick={() => void save(role.key, role.id, "off")}>Turn off</button> : null}
            {role.currentId !== "off" && selected === "off" ? <button type="button" className="min-h-12 min-w-12 px-3 py-2" disabled={pending === role.id} onClick={() => void save(role.key, role.id, role.currentId)}>Keep current choice</button> : null}
            {selected !== role.currentId ? <button type="button" className="min-h-12 min-w-12 px-3 py-2" disabled={pending === role.id} onClick={() => void save(role.key, role.id, selected)}>Save choice</button> : null}
          </div>
        </section>;
      })}
      {impact.trade ? <p className="text-sm">{impact.trade}</p> : null}
      {impact.refusal ? <p className="text-sm text-muted-foreground">{impact.refusal}</p> : null}
      {impact.memoryQuestion ? <p className="text-sm text-muted-foreground">{impact.memoryQuestion}</p> : null}
    </>;
}
