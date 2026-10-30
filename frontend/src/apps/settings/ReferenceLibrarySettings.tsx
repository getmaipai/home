import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/dashboard/components/ui/alert-dialog";
import { Button } from "@maipai/ui/src/ui/button";
import { Item, ItemContent, ItemDescription, ItemFooter, ItemGroup, ItemSeparator, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { Progress } from "@maipai/ui/src/dashboard/components/ui/progress";
import presetsData from "@maipai/spec/vocab/reference-presets.json";
import { api, type ReferenceJob, type ReferencePlan, type ReferenceSelection, type ReferenceSet } from "@/lib/api";

const presets = presetsData.presets;
const bytes = (n: number) => n >= 1_000_000_000 ? `${(n / 1_000_000_000).toFixed(1)} GB` : `${(n / 1_000_000).toFixed(0)} MB`;
const duration = (n: number | null) => n === null ? "Time estimate unavailable" : n < 60 ? `About ${n} seconds` : `About ${Math.ceil(n / 60)} minutes`;


const TOPICS: Array<{ topic: string; sources: string[] }> = [
  { topic: "Encyclopedia", sources: ["wikipedia-en", "wikipedia-simple", "vikidia"] },
  { topic: "Dictionaries", sources: ["wiktionary-simple", "wiktionary-en"] },
  { topic: "Health and medicine", sources: ["medlineplus"] },
  { topic: "Travel and the world", sources: ["wikivoyage", "world-factbook"] },
  { topic: "Books and how-to", sources: ["wikibooks", "stackexchange"] },
];
const SOURCE_BLURB: Record<string, string> = {
  "wikipedia-en": "The full English Wikipedia.",
  "wikipedia-simple": "Wikipedia in plain, simple English.",
  vikidia: "An encyclopedia written for children.",
  "wiktionary-simple": "Word meanings in simple English.",
  "wiktionary-en": "Word meanings, origins and translations.",
  medlineplus: "Plain-language health and medicine pages from the US National Library of Medicine.",
  wikivoyage: "Travel guides.",
  "world-factbook": "Facts about every country.",
  wikibooks: "Free textbooks and manuals.",
  stackexchange: "Questions and answers on cooking, repairs, gardens and computers.",
};
const FLAVOUR_BLURB: Record<string, string> = { maxi: "Everything, with pictures (largest).", nopic: "Everything, no pictures (smaller).", mini: "Short introductions only (smallest)." };
const plainLine = (set: { source: string; flavour: string }) => [SOURCE_BLURB[set.source], FLAVOUR_BLURB[set.flavour]].filter(Boolean).join(" ");
function topicGroups<T extends { source: string }>(sets: T[]): Array<{ topic: string; sets: T[] }> {
  const known = new Set(TOPICS.flatMap((t) => t.sources));
  const groups = TOPICS.map((t) => ({ topic: t.topic, sets: sets.filter((set) => t.sources.includes(set.source)) }));
  groups.push({ topic: "Other", sets: sets.filter((set) => !known.has(set.source)) });
  return groups.filter((group) => group.sets.length > 0);
}

export function ReferenceLibrarySettings() {
  const client = useQueryClient();
  const state = useQuery({ queryKey: ["reference-state"], queryFn: api.referenceState, refetchInterval: (query) => query.state.data?.jobs.length ? 1500 : false });
  const catalog = useQuery({ queryKey: ["reference-catalog"], queryFn: api.referenceCatalog, refetchInterval: () => state.data?.jobs.length ? 5000 : false });
  const [confirm, setConfirm] = useState<{ kind: "install"; set: ReferenceSet; plan: ReferencePlan } | { kind: "remove"; set: ReferenceSet } | { kind: "preset"; preset: "minimum" | "moderate" | "full"; plan: ReferencePlan } | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function refresh() { await client.invalidateQueries({ queryKey: ["reference-state"] }); }
  async function planSet(set: ReferenceSet) {
    setError(null);
    try { const plan = await api.referencePlan("custom", [{ source: set.source, flavour: set.flavour as ReferenceSelection["flavour"] }]); const planned = plan.sets[0] ?? set; setConfirm({ kind: "install", set: planned, plan }); }
    catch { setError("Home could not check this set's size and drive space. Check the Home connection, then try again."); }
  }
  async function planPreset(preset: "minimum" | "moderate" | "full") {
    setError(null);
    try { setConfirm({ kind: "preset", preset, plan: await api.referencePlan(preset) }); }
    catch { setError("Home could not check this library choice. Check the Home connection, then try again."); }
  }
  async function runConfirm() {
    if (!confirm) return;
    try {
      if (confirm.kind === "remove") { await api.referenceRemove(confirm.set.id); }
      else if (confirm.kind === "install") { await api.referenceInstall(confirm.set.id); }
      else if (confirm.kind === "preset") {
        const existing = new Set(catalog.data?.filter((set) => set.installed).map((set) => set.id) ?? []);
        const additions = confirm.plan.sets.filter((set) => !existing.has(set.id));
        await Promise.all(additions.map((set) => api.referenceInstall(set.id)));
      }
      setConfirm(null); await refresh();
    } catch { setError("Home could not change the reference library. Check drive space and the Home connection, then try again."); }
  }
  async function jobAction(job: ReferenceJob, action: "pause" | "resume" | "cancel") {
    setError(null);
    try { await api.referenceJob(job.id, action); await refresh(); }
    catch { setError(`Home could not ${action} this download. Check the Home connection, then try again.`); }
  }
  const listed = catalog.data ? catalog.data.map((set) => {
    const { id, source, flavour, name, language, installed, sizeBytes, snapshotDate, bands } = set;
    const job = state.data?.jobs.find((j) => j.setId === id);
    return { ...set, id, source, flavour, name, language, installed, sizeBytes, snapshotDate, bands, job };
  }) : [];
  return <>
      <p className="text-sm text-muted-foreground">Offline data. Books that live on this Home, like Wikipedia and health information. Choose what to download, and how much detail. Everything here keeps working with no internet, and children and teens only see the books suited to them.</p>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {state.isError || catalog.isError ? <p role="alert" className="text-sm text-destructive">Home could not load the reference library. Check the Home connection, then reload this page.</p> : null}
      <section aria-label="Library shortcuts"><h2 className="text-sm font-medium">Quick choices</h2><ItemGroup variant="card" aria-label="Library shortcuts">{presets.map((preset) => <Item key={preset.id}><ItemContent><ItemTitle>{preset.label}{state.data?.matchesPresets.includes(preset.id) ? " · Current" : ""}</ItemTitle><ItemDescription clamp={false}>{preset.copy}</ItemDescription></ItemContent><ItemFooter><Button type="button" variant={state.data?.matchesPresets.includes(preset.id) ? "default" : "outline"} onClick={() => void planPreset(preset.id as "minimum" | "moderate" | "full")}>Select</Button></ItemFooter></Item>)}</ItemGroup></section>
      <section aria-label="Reference sets"><h2 className="mb-1 text-sm font-medium">Offline books</h2><p className="mb-3 text-sm text-muted-foreground">Each book downloads once, then works without the internet. Pick the version that fits your drive: with pictures is the biggest, introductions only is the smallest.</p>{catalog.isLoading || state.isLoading ? <p>Loading reference sets…</p> : <div className="flex flex-col gap-5">{topicGroups(listed).map((group) => <section key={group.topic} aria-label={group.topic} className="flex flex-col gap-2"><h3 className="text-sm font-medium">{group.topic}</h3><ItemGroup variant="card" aria-label={group.topic}>{group.sets.map((set, index) => <div key={set.id}>{index ? <ItemSeparator variant="inset" /> : null}<Item>
        <ItemContent><ItemTitle>{set.name}</ItemTitle>{plainLine(set) ? <p className="text-sm">{plainLine(set)}</p> : null}<ItemDescription clamp={false}>{set.language} · {set.available ? bytes(set.sizeBytes) : "Size unavailable"} · Snapshot {set.snapshotDate ?? "date not listed"} · {set.installed ? "Installed" : set.available ? "Not installed" : "Unavailable"}{set.job ? ` · ${set.job.state}` : ""}{set.message ? ` · ${set.message}` : ""}</ItemDescription></ItemContent>
        <ItemFooter>{set.job ? <><Progress value={set.job.totalBytes ? Math.round(set.job.completedBytes / set.job.totalBytes * 100) : 0} aria-label={`${set.name} download progress`} /><span>{bytes(set.job.completedBytes)} of {bytes(set.job.totalBytes)}</span>{set.job.state === "paused" ? <Button variant="outline" size="sm" onClick={() => void jobAction(set.job!, "resume")}>Resume</Button> : <Button variant="outline" size="sm" onClick={() => void jobAction(set.job!, "pause")}>Pause</Button>}<Button variant="outline" size="sm" onClick={() => void jobAction(set.job!, "cancel")}>Cancel</Button></> : <Button type="button" variant="outline" disabled={!set.installed && !set.available} onClick={() => set.installed ? setConfirm({ kind: "remove", set: { ...set, sha256: "" } }) : void planSet({ ...set, sha256: "" })}>{set.installed ? "Remove" : set.available ? "Install" : "Unavailable"}</Button>}</ItemFooter>
      </Item></div>)}</ItemGroup></section>)}</div>}</section>
      {confirm ? <AlertDialog open onOpenChange={(open) => { if (!open) setConfirm(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{confirm.kind === "remove" ? `Remove ${confirm.set.name}?` : confirm.kind === "preset" ? `Install the ${presets.find((preset) => preset.id === confirm.preset)?.label} library?` : `Install ${confirm.set.name}?`}</AlertDialogTitle><AlertDialogDescription>{confirm.kind === "remove" ? `${bytes(confirm.set.sizeBytes)} will be freed. ${catalog.data?.find((set) => set.id === confirm.set.id)?.bands.filter((band) => band === "child" || band === "teen").join(" and ") || "No child or teen"} readers may lose access to this set.` : confirm.plan.refusal ? confirm.plan.refusal : confirm.kind === "preset" ? `${confirm.plan.sets.length} sets are in this choice. Sets you already have stay installed. ${bytes(confirm.plan.totalBytes)} to download, with ${bytes(confirm.plan.freeAfterInstallBytes)} free after install. ${duration(confirm.plan.estimatedSeconds)}.` : `${bytes(confirm.plan.totalBytes)} to download. ${bytes(confirm.plan.freeAfterInstallBytes)} free after install. ${duration(confirm.plan.estimatedSeconds)}.`}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel>{confirm.kind === "remove" ? <AlertDialogAction variant="destructive" onClick={() => void runConfirm()}>Remove set</AlertDialogAction> : confirm.plan.refusal ? <Button variant="outline" disabled>Cannot continue</Button> : <AlertDialogAction onClick={() => void runConfirm()}>{confirm.kind === "preset" ? "Install choice" : "Install set"}</AlertDialogAction>}</AlertDialogFooter></AlertDialogContent></AlertDialog> : null}
  </>;
}
