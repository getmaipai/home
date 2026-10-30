// READER-14: Settings, Offline data (view `home.reference_library`). One row per offline book with a switch, and Minimum, Moderate
// and Full as one parent choice that sets the rows. Choices are staged in the page and written only by Apply, with the same
// storage bar and action bar as AI and models (AiGlance).
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/dashboard/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@maipai/ui/src/ui/alert";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { Chip } from "@maipai/ui/src/primitives/Chip";
import { Progress } from "@maipai/ui/src/ui/progress";
import { Switch } from "@maipai/ui/src/ui/switch";
import { StorageBar } from "@maipai/ui/src/primitives/StorageBar";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import presetsData from "@maipai/spec/vocab/reference-presets.json";
import { api, ApiError, type ReferenceCatalogSet, type ReferenceJob } from "@/lib/api";
import { sizeGb } from "../../../../shared/diskPlanMath";

const presets = presetsData.presets;
const duration = (n: number | null) => n === null ? "Time estimate unavailable" : n < 60 ? `About ${n} seconds` : n < 3600 ? `About ${Math.ceil(n / 60)} minutes` : `About ${Math.ceil(n / 3600)} hours`;
const signed = (bytes: number) => `${bytes < 0 ? "-" : "+"}${sizeGb(Math.abs(bytes))}`;
const messageOf = (error: unknown, fallback: string) => (error instanceof ApiError ? error.message : fallback);

const TOPICS: Array<{ topic: string; sources: string[] }> = [
  { topic: "Encyclopedia", sources: ["wikipedia-en", "wikipedia-simple", "vikidia"] },
  { topic: "Dictionaries", sources: ["wiktionary-simple", "wiktionary-en"] },
  { topic: "Health and medicine", sources: ["medlineplus"] },
  { topic: "Travel and the world", sources: ["wikivoyage", "world-factbook"] },
  { topic: "Books and how-to", sources: ["wikibooks", "stackexchange"] },
];
const SOURCE_BLURB: Record<string, string> = {
  "wikipedia-en": "The English Wikipedia.",
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
const FLAVOUR_LABEL: Record<string, string> = { maxi: "Everything, with pictures", nopic: "Everything, no pictures", mini: "Short introductions only" };
const FLAVOUR_ORDER = ["maxi", "nopic", "mini"];
const SOURCE_LABEL: Record<string, string> = {
  "wikipedia-en": "Wikipedia", "wikipedia-simple": "Simple English Wikipedia", vikidia: "Vikidia", "wiktionary-simple": "Simple English Wiktionary", "wiktionary-en": "Wiktionary",
  medlineplus: "MedlinePlus", wikivoyage: "Wikivoyage", "world-factbook": "CIA World Factbook", wikibooks: "Wikibooks", stackexchange: "Stack Exchange",
};
/** A plain name for a row: the source's own name, and for a source with several versions which version it is. The catalogue's raw book name is only the fallback. */
const titleOf = (set: { source: string; flavour: string; name: string }) => {
  const label = SOURCE_LABEL[set.source];
  if (!label) return set.name;
  const flavour = FLAVOUR_LABEL[set.flavour];
  return flavour ? `${label}: ${flavour.charAt(0).toLowerCase()}${flavour.slice(1)}` : label;
};

function topicGroups<T extends { source: string; flavour: string }>(sets: T[]): Array<{ topic: string; sets: T[] }> {
  const known = new Set(TOPICS.flatMap((t) => t.sources));
  const order = (set: T) => { const at = FLAVOUR_ORDER.indexOf(set.flavour); return at < 0 ? 99 : at; };
  const groups = TOPICS.map((t) => ({ topic: t.topic, sets: sets.filter((set) => t.sources.includes(set.source)).sort((a, b) => order(a) - order(b)) }));
  groups.push({ topic: "Other", sets: sets.filter((set) => !known.has(set.source)) });
  return groups.filter((group) => group.sets.length > 0);
}

const presetIds = (id: string): Set<string> => new Set((presets.find((p) => p.id === id)?.members ?? []).map((m) => `${m.source}:${m.flavour}`));

export function ReferenceLibrarySettings() {
  const client = useQueryClient();
  const state = useQuery({ queryKey: ["reference-state"], queryFn: api.referenceState, refetchInterval: (query) => query.state.data?.jobs.length ? 1500 : false });
  const catalog = useQuery({ queryKey: ["reference-catalog"], queryFn: api.referenceCatalog, refetchInterval: () => state.data?.jobs.length ? 5000 : false });
  const hardware = useQuery({ queryKey: ["host", "hardware"], queryFn: () => api.hardware(), staleTime: 300_000 });
  // The wanted state of a book, only where it differs from what is installed now.
  const [staged, setStaged] = useState<Record<string, boolean>>({});
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>(null);

  const sets = useMemo(() => (catalog.data ?? []).filter((set) => set.available || set.installed), [catalog.data]);
  const wants = (set: ReferenceCatalogSet) => staged[set.id] ?? set.installed;
  const additions = sets.filter((set) => wants(set) && !set.installed);
  const removals = sets.filter((set) => !wants(set) && set.installed);
  const stagedCount = additions.length + removals.length;
  const installedBytes = sets.filter((set) => set.installed).reduce((sum, set) => sum + set.sizeBytes, 0);
  const addBytes = additions.reduce((sum, set) => sum + set.sizeBytes, 0);
  const freedBytes = removals.reduce((sum, set) => sum + set.sizeBytes, 0);
  const jobFor = (set: ReferenceCatalogSet): ReferenceJob | undefined => state.data?.jobs.find((job) => job.setId === set.id);

  const stage = (set: ReferenceCatalogSet, on: boolean) => setStaged((previous) => {
    const next = { ...previous };
    if (on === set.installed) delete next[set.id]; else next[set.id] = on;
    return next;
  });
  // A parent choice sets every row: the books in it are on, the others off. Nothing is written until Apply.
  const choosePreset = (id: string) => {
    const members = presetIds(id);
    const next: Record<string, boolean> = {};
    for (const set of sets) if (members.has(set.id) !== set.installed) next[set.id] = members.has(set.id);
    setStaged(next);
    setError(null);
  };
  const activePreset = presets.find((preset) => {
    const members = presetIds(preset.id);
    return sets.length > 0 && sets.every((set) => wants(set) === members.has(set.id));
  })?.id;

  // What the downloads would need, asked of the hub whenever the additions change.
  const planKey = additions.map((set) => set.id).sort().join(",");
  const plan = useQuery({
    queryKey: ["reference-plan", planKey],
    queryFn: () => api.referencePlan("custom", additions.map((set) => ({ source: set.source, flavour: set.flavour as "mini" | "maxi" | "nopic" | "default" }))),
    enabled: additions.length > 0,
    retry: false,
    staleTime: 60_000,
  });

  const apply = useMutation({
    mutationFn: async () => {
      for (const set of removals) { setStep(`Removing ${titleOf(set)}…`); await api.referenceRemove(set.id); }
      for (const set of additions) { setStep(`Starting ${titleOf(set)}…`); await api.referenceInstall(set.id); }
    },
    onSuccess: async () => { setStep(null); setStaged({}); setError(null); await client.invalidateQueries({ queryKey: ["reference-state"] }); await client.invalidateQueries({ queryKey: ["reference-catalog"] }); },
    onError: async (e) => { setStep(null); setError(messageOf(e, "Home could not change the offline books. Check the drive space and the Home connection, then try again.")); await client.invalidateQueries({ queryKey: ["reference-state"] }); await client.invalidateQueries({ queryKey: ["reference-catalog"] }); },
  });
  const jobAction = useMutation({
    mutationFn: ({ job, action }: { job: ReferenceJob; action: "pause" | "resume" | "cancel" }) => api.referenceJob(job.id, action),
    onSuccess: () => client.invalidateQueries({ queryKey: ["reference-state"] }),
    onError: () => setError("Home could not change this download. Check the Home connection, then try again."),
  });

  const free = plan.data?.freeBytes ?? hardware.data?.freeDiskBytes ?? null;
  const capacity = free !== null ? installedBytes + free : null;
  const segments = [
    { id: "books", label: "Offline books", bytes: installedBytes, hue: "--hue-violet" },
    ...(addBytes > 0 ? [{ id: "pending", label: "Staged", bytes: addBytes, hue: "--hue-orange" }] : []),
  ];
  const refusal = plan.data?.refusal ?? null;
  const planFailed = additions.length > 0 && plan.isError;
  const kidsLose = removals.filter((set) => set.bands.includes("child") || set.bands.includes("teen"));
  const loadFailed = state.isError || catalog.isError;

  return (
    <section aria-label="Offline data" className="flex flex-col gap-4" data-testid="offline-data">
      <p className="text-base text-muted-foreground">Books that live on this Home, like Wikipedia and health information. Each one downloads once, then works with no internet. Children and teens only see the books made for them.</p>
      {loadFailed ? <Alert variant="destructive"><AlertTitle>The page did not load</AlertTitle><AlertDescription>Home could not load the offline books. Check that Home is running, then reload this page.</AlertDescription></Alert> : null}

      <ItemGroup variant="card">
        <Item>
          <ItemContent>
            <ItemTitle>Disk space</ItemTitle>
            <StorageBar segments={segments} capacityBytes={capacity} formatBytes={sizeGb} />
            {stagedCount > 0 ? <ItemDescription clamp={false}>After applying: {sizeGb(installedBytes + addBytes - freedBytes)} of books ({signed(addBytes - freedBytes)}){free !== null ? `, ${sizeGb(Math.max(0, free - addBytes + freedBytes))} free on this computer` : ""}.</ItemDescription> : <ItemDescription clamp={false}>{sizeGb(installedBytes)} of offline books{free !== null ? `, ${sizeGb(free)} free on this computer` : ""}.</ItemDescription>}
          </ItemContent>
        </Item>
      </ItemGroup>

      <section aria-label="Library size" className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">How much to keep</h2>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Library size">
          {presets.map((preset) => <Chip key={preset.id} selected={activePreset === preset.id} onClick={() => choosePreset(preset.id)}>{preset.label}</Chip>)}
          {activePreset === undefined && sets.length > 0 ? <Badge variant="secondary">Custom</Badge> : null}
        </div>
        <p className="text-base text-muted-foreground">{presets.find((preset) => preset.id === activePreset)?.copy ?? "Your own mix. Pick Minimum, Moderate or Full to start from a ready-made set, then switch single books on or off below."}</p>
      </section>

      {catalog.isLoading || state.isLoading ? <p role="status">Loading offline books…</p> : null}
      {topicGroups(sets).map((group) => (
        <section key={group.topic} aria-label={group.topic} className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{group.topic}</h2>
          <ItemGroup variant="card" role="group" aria-label={group.topic}>
            {group.sets.map((set) => rowOf({ set, on: wants(set), job: jobFor(set), onSwitch: (on) => stage(set, on), onJob: (job, action) => jobAction.mutate({ job, action }) }))}
          </ItemGroup>
        </section>
      ))}

      <div className="sticky bottom-0 z-10 flex flex-col gap-2 bg-background pb-2" data-testid="offline-action-bar">
        {error ? <Alert variant="destructive"><AlertTitle>That did not work</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
        {planFailed ? <Alert variant="destructive"><AlertTitle>Home could not check the drive space</AlertTitle><AlertDescription>Check that Home is running and online, then switch a book off and on again to retry.</AlertDescription></Alert> : null}
        {refusal ? <Alert variant="warning"><AlertTitle>There is not enough room</AlertTitle><AlertDescription>{refusal}</AlertDescription></Alert> : null}
        {stagedCount > 0 ? (
          <Alert data-testid="offline-staged">
            <AlertTitle>{stagedCount === 1 ? "1 change is waiting" : `${stagedCount} changes are waiting`}</AlertTitle>
            <AlertDescription>
              <p className="text-base">{additions.length > 0 ? `${additions.length} to download (${sizeGb(addBytes)}${plan.data ? `, ${duration(plan.data.estimatedSeconds)}` : ""}). ` : ""}{removals.length > 0 ? `${removals.length} to remove (frees ${sizeGb(freedBytes)}).` : ""}</p>
              {apply.isPending && step ? <p className="text-base">{step}</p> : null}
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" disabled={apply.isPending} onClick={() => setStaged({})}>Discard</Button>
                <Button type="button" size="sm" disabled={apply.isPending || Boolean(refusal) || (additions.length > 0 && plan.isPending) || planFailed} onClick={() => removals.length > 0 ? setConfirmRemove(true) : apply.mutate()}>{apply.isPending ? "Applying…" : "Apply"}</Button>
              </div>
            </AlertDescription>
          </Alert>
        ) : null}
      </div>

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{removals.length === 1 ? `Remove ${removals[0] ? titleOf(removals[0]) : "this book"}?` : `Remove ${removals.length} books?`}</AlertDialogTitle>
            <AlertDialogDescription>{sizeGb(freedBytes)} will be freed. {kidsLose.length > 0 ? "Children and teens may lose access to " + kidsLose.map((set) => titleOf(set)).join(", ") + "." : "No book for children or teens is removed."} You can download them again later.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => { setConfirmRemove(false); apply.mutate(); }}>Remove and apply</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/** One book as a plain function so no Home component has a kit Item as its root (rule 9). */
function rowOf({ set, on, job, onSwitch, onJob }: { set: ReferenceCatalogSet; on: boolean; job: ReferenceJob | undefined; onSwitch: (on: boolean) => void; onJob: (job: ReferenceJob, action: "pause" | "resume" | "cancel") => void }) {
  const flavour = FLAVOUR_LABEL[set.flavour];
  const forKids = set.bands.includes("child");
  const status = set.installed ? "Installed" : !set.available ? "Unavailable" : "Not installed";
  const pending = on !== set.installed;
  return (
    <Item key={set.id} data-testid={`offline-row-${set.id}`}>
      <ItemContent>
        <ItemTitle>
          {titleOf(set)}
          {forKids ? <Badge variant="secondary">For children</Badge> : null}
          {pending ? <Badge variant="outline">{on ? "Will download" : "Will remove"}</Badge> : null}
        </ItemTitle>
        <ItemDescription clamp={false}>{[SOURCE_BLURB[set.source], flavour ? `${flavour}.` : null].filter(Boolean).join(" ")}</ItemDescription>
        <ItemDescription clamp={false}>{set.language} · {set.available ? sizeGb(set.sizeBytes) : "Size unavailable"} · Snapshot {set.snapshotDate ?? "date not listed"} · {status}{job ? ` · ${job.state}` : ""}{set.message ? ` · ${set.message}` : ""}</ItemDescription>
        {job ? (
          <div className="flex flex-wrap items-center gap-2">
            <Progress value={job.totalBytes ? Math.round(job.completedBytes / job.totalBytes * 100) : 0} aria-label={`${titleOf(set)} download progress`} />
            <span className="text-base">{sizeGb(job.completedBytes)} of {sizeGb(job.totalBytes)}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => onJob(job, job.state === "paused" ? "resume" : "pause")}>{job.state === "paused" ? "Resume" : "Pause"}</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => onJob(job, "cancel")}>Cancel</Button>
          </div>
        ) : null}
      </ItemContent>
      <ItemActions><Switch checked={on} disabled={Boolean(job) || (!set.installed && !set.available)} onCheckedChange={onSwitch} aria-label={`${titleOf(set)}: ${on ? "on" : "off"}`} /></ItemActions>
    </Item>
  );
}
