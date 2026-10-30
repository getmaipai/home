// READER-14: Settings, Offline data (view `home.reference_library`). One row per source (Wikipedia is one row) with a switch, or a
// version picker when the source comes in several sizes, and Minimum, Moderate and Full as one parent choice that sets the rows. Choices are staged in the page and written only by Apply, with the same
// storage bar and action bar as AI and models (AiGlance).
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/dashboard/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@maipai/ui/src/ui/alert";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { Chip } from "@maipai/ui/src/primitives/Chip";
import { JobProgress } from "@maipai/ui/src/elements/job-progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/ui/select";
import { StagedApplyBar } from "@/apps/settings/StagedApplyBar";
import { Switch } from "@maipai/ui/src/ui/switch";
import { StorageBar } from "@maipai/ui/src/primitives/StorageBar";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import presetsData from "@maipai/spec/vocab/reference-presets.json";
import { api, ApiError, type ReferenceCatalogSet, type ReferenceJob } from "@/lib/api";
import { sizeGb } from "../../../../shared/diskPlanMath";
import { downloadProgress, useByteRates, type DownloadSnapshot } from "@/lib/downloadProgress";

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
/** A plain name for a version or a book: the source's own name, then which version when the source has several. */
const titleOf = (set: { source: string; flavour: string; name: string }) => {
  const label = SOURCE_LABEL[set.source];
  if (!label) return set.name;
  const flavour = FLAVOUR_LABEL[set.flavour];
  return flavour ? `${label}: ${flavour.charAt(0).toLowerCase()}${flavour.slice(1)}` : label;
};
const versionLabel = (set: { flavour: string }) => FLAVOUR_LABEL[set.flavour] ?? "Standard";

/** One entry per source, with its versions biggest first. A source with one version has just that one. */
interface SourceRow { source: string; label: string; versions: ReferenceCatalogSet[] }
function sourceRows(sets: ReferenceCatalogSet[]): Array<{ topic: string; rows: SourceRow[] }> {
  const order = (set: ReferenceCatalogSet) => { const at = FLAVOUR_ORDER.indexOf(set.flavour); return at < 0 ? 99 : at; };
  const rowFor = (source: string): SourceRow | null => {
    const versions = sets.filter((set) => set.source === source).sort((a, b) => order(a) - order(b));
    return versions.length ? { source, label: SOURCE_LABEL[source] ?? versions[0]!.name, versions } : null;
  };
  const known = new Set(TOPICS.flatMap((t) => t.sources));
  const groups = TOPICS.map((t) => ({ topic: t.topic, rows: t.sources.map(rowFor).filter((row): row is SourceRow => row !== null) }));
  const others = [...new Set(sets.filter((set) => !known.has(set.source)).map((set) => set.source))].map(rowFor).filter((row): row is SourceRow => row !== null);
  return [...groups, { topic: "Other", rows: others }].filter((group) => group.rows.length > 0);
}

/** A book download in the shared progress card's words. Waiting for the nightly window reads as queued with the reason. */
export function referenceDownload(job: ReferenceJob, title: string, bytesPerSecond?: number): DownloadSnapshot {
  const state = job.state === "downloading" ? "running" : job.state === "waiting_window" ? "queued" : job.state;
  const status = job.state === "waiting_window" ? "Waits for the nightly download window"
    : job.state === "queued" ? "Starting soon"
      : job.state === "paused" ? "Paused"
        : job.state === "failed" ? job.message ?? "The download failed. Cancel it, then switch the book on again to retry."
          : job.state === "downloading" ? "Downloading" : job.message ?? "";
  return { title, state, status, completedBytes: job.completedBytes, totalBytes: job.totalBytes, ...(bytesPerSecond !== undefined && job.state === "downloading" ? { bytesPerSecond } : {}) };
}

const presetIds = (id: string): Set<string> => new Set((presets.find((p) => p.id === id)?.members ?? []).map((m) => `${m.source}:${m.flavour}`));

export function ReferenceLibrarySettings() {
  const client = useQueryClient();
  const state = useQuery({ queryKey: ["reference-state"], queryFn: api.referenceState, refetchInterval: (query) => query.state.data?.jobs.length ? 1500 : false });
  const catalog = useQuery({ queryKey: ["reference-catalog"], queryFn: api.referenceCatalog, refetchInterval: () => state.data?.jobs.length ? 5000 : false });
  const hardware = useQuery({ queryKey: ["host", "hardware"], queryFn: () => api.hardware(), staleTime: 300_000 });
  // The wanted version of each source, only where it differs from what is installed now: a set id, or null for off.
  const [staged, setStaged] = useState<Record<string, string | null>>({});
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>(null);

  const sets = useMemo(() => (catalog.data ?? []).filter((set) => set.available || set.installed), [catalog.data]);
  const installedFor = (source: string) => sets.find((set) => set.source === source && set.installed)?.id ?? null;
  const wantedFor = (source: string) => source in staged ? staged[source]! : installedFor(source);
  const additions = sets.filter((set) => wantedFor(set.source) === set.id && !set.installed);
  const removals = sets.filter((set) => set.installed && wantedFor(set.source) !== set.id);
  const stagedCount = new Set([...additions, ...removals].map((set) => set.source)).size;
  const installedBytes = sets.filter((set) => set.installed).reduce((sum, set) => sum + set.sizeBytes, 0);
  const addBytes = additions.reduce((sum, set) => sum + set.sizeBytes, 0);
  const freedBytes = removals.reduce((sum, set) => sum + set.sizeBytes, 0);
  const jobFor = (set: ReferenceCatalogSet): ReferenceJob | undefined => state.data?.jobs.find((job) => job.setId === set.id);
  const rates = useByteRates((state.data?.jobs ?? []).map((job) => ({ id: job.id, completedBytes: job.completedBytes, running: job.state === "downloading" })));

  const choose = (source: string, id: string | null) => setStaged((previous) => {
    const next = { ...previous };
    if (id === installedFor(source)) delete next[source]; else next[source] = id;
    return next;
  });
  // A parent choice sets every source: the member's version is on, the others off. Nothing is written until Apply.
  const choosePreset = (id: string) => {
    const members = presetIds(id);
    const next: Record<string, string | null> = {};
    for (const source of new Set(sets.map((set) => set.source))) {
      const pick = sets.find((set) => set.source === source && members.has(set.id))?.id ?? null;
      if (pick !== installedFor(source)) next[source] = pick;
    }
    setStaged(next);
    setError(null);
  };
  const activePreset = presets.find((preset) => {
    const members = presetIds(preset.id);
    return sets.length > 0 && [...new Set(sets.map((set) => set.source))].every((source) => {
      const wanted = wantedFor(source);
      const member = sets.find((set) => set.source === source && members.has(set.id))?.id ?? null;
      return wanted === member;
    });
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

  const drive = useQuery({ queryKey: ["reference-disk"], queryFn: api.referenceDisk, refetchInterval: () => state.data?.jobs.length ? 5000 : false });
  const total = drive.data && drive.data.totalBytes > 0 ? drive.data.totalBytes : null;
  const free = drive.data?.freeBytes ?? plan.data?.freeBytes ?? hardware.data?.freeDiskBytes ?? null;
  const capacity = total ?? (free !== null ? installedBytes + free : null);
  // Everything else on the drive is the part that is neither free nor an offline book.
  const otherBytes = total !== null && free !== null ? Math.max(0, total - free - installedBytes) : 0;
  const segments = [
    ...(otherBytes > 0 ? [{ id: "other", label: "Everything else", bytes: otherBytes, hue: "--hue-blue" }] : []),
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
            <ItemDescription clamp={false}>{total !== null ? `${sizeGb(total)} drive` : "This computer"}{free !== null ? ` · ${sizeGb(free)} free` : ""} · {sizeGb(installedBytes)} of offline books.</ItemDescription>
            {stagedCount > 0 ? <ItemDescription clamp={false}>After applying: {sizeGb(installedBytes + addBytes - freedBytes)} of books ({signed(addBytes - freedBytes)}){free !== null ? `, ${sizeGb(Math.max(0, free - addBytes + freedBytes))} free` : ""}.</ItemDescription> : null}
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
      {sourceRows(sets).map((group) => (
        <section key={group.topic} aria-label={group.topic} className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{group.topic}</h2>
          <ItemGroup variant="card" role="group" aria-label={group.topic}>
            {group.rows.map((row) => rowOf({ row, wanted: wantedFor(row.source), installed: installedFor(row.source), jobFor, rates, onChoose: (id) => choose(row.source, id), onJob: (job, action) => jobAction.mutate({ job, action }) }))}
          </ItemGroup>
        </section>
      ))}

      <StagedApplyBar
        testId="offline-action-bar" stagedTestId="offline-staged"
        notices={<>
          {error ? <Alert variant="destructive"><AlertTitle>That did not work</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
          {planFailed ? <Alert variant="destructive"><AlertTitle>Home could not check the drive space</AlertTitle><AlertDescription>Check that Home is running and online, then switch a book off and on again to retry.</AlertDescription></Alert> : null}
          {refusal ? <Alert variant="warning"><AlertTitle>There is not enough room</AlertTitle><AlertDescription>{refusal}</AlertDescription></Alert> : null}
        </>}
        staged={stagedCount > 0} title={stagedCount === 1 ? "1 change is waiting" : `${stagedCount} changes are waiting`}
        summary={<p className="text-base">{additions.length > 0 ? `${additions.length} to download (${sizeGb(addBytes)}${plan.data ? `, ${duration(plan.data.estimatedSeconds)}` : ""}). ` : ""}{removals.length > 0 ? `${removals.length} to remove (frees ${sizeGb(freedBytes)}).` : ""}</p>}
        step={step} applying={apply.isPending} applyDisabled={Boolean(refusal) || (additions.length > 0 && plan.isPending) || planFailed}
        applyLabel="Apply" discardLabel="Discard" onApply={() => removals.length > 0 ? setConfirmRemove(true) : apply.mutate()} onDiscard={() => setStaged({})}
      />

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

/** One source as a plain function so no Home component has a kit Item as its root (rule 9). A source with one version gets a switch;
 * one with several gets a picker (Off, then each version with its size). */
function rowOf({ row, wanted, installed, jobFor, rates, onChoose, onJob }: { row: SourceRow; wanted: string | null; installed: string | null; jobFor: (set: ReferenceCatalogSet) => ReferenceJob | undefined; rates: Record<string, number | undefined>; onChoose: (id: string | null) => void; onJob: (job: ReferenceJob, action: "pause" | "resume" | "cancel") => void }) {
  const multi = row.versions.length > 1;
  const current = row.versions.find((set) => set.id === wanted) ?? null;
  const shown = current ?? row.versions.find((set) => set.id === installed) ?? row.versions[0]!;
  const job = row.versions.map(jobFor).find(Boolean);
  const forKids = row.versions.some((set) => set.child);
  const pending = wanted !== installed;
  const jobSet = job ? row.versions.find((set) => set.id === job.setId) : undefined;
  const download = job ? referenceDownload(job, jobSet ? titleOf(jobSet) : row.label, rates[job.id]) : undefined;
  const status = installed ? "Installed" : download ? download.status : "Not installed";
  const blocked = Boolean(job) || row.versions.every((set) => !set.installed && !set.available);
  return (
    <Item key={row.source} data-testid={`offline-row-${row.source}`}>
      <ItemContent>
        <ItemTitle>
          {row.label}
          {forKids ? <Badge variant="secondary">For children</Badge> : null}
          {pending ? <Badge variant="outline">{wanted ? "Will download" : "Will remove"}</Badge> : null}
        </ItemTitle>
        <ItemDescription clamp={false}>{SOURCE_BLURB[row.source]}</ItemDescription>
        <ItemDescription clamp={false}>{multi ? (current ? `${versionLabel(current)} · ${sizeGb(current.sizeBytes)}` : "Off") : sizeGb(shown.sizeBytes)} · Snapshot {shown.snapshotDate ?? "date not listed"} · {status}{shown.message ? ` · ${shown.message}` : ""}</ItemDescription>
        {job && download ? (
          <>
            <JobProgress {...downloadProgress(download)} variant="full" cancelLabel={`Cancel the ${row.label} download`} onCancel={() => onJob(job, "cancel")} {...(job.state === "paused" ? { onResume: () => onJob(job, "resume") } : {})} />
            {job.state === "downloading" ? <div><Button type="button" variant="outline" size="sm" onClick={() => onJob(job, "pause")}>Pause</Button></div> : null}
            {job.state === "waiting_window" ? <div><Button type="button" variant="outline" size="sm" onClick={() => onJob(job, "resume")}>Start now</Button></div> : null}
          </>
        ) : null}
      </ItemContent>
      <ItemActions>
        {multi ? (
          <Select value={wanted ?? "off"} disabled={blocked} onValueChange={(value) => onChoose(value === "off" ? null : value)}>
            <SelectTrigger aria-label={`${row.label} version`}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="off">Off</SelectItem>
              {row.versions.map((set) => <SelectItem key={set.id} value={set.id}>{versionLabel(set)} · {sizeGb(set.sizeBytes)}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : <Switch checked={wanted !== null} disabled={blocked} onCheckedChange={(on) => onChoose(on ? row.versions[0]!.id : null)} aria-label={`${row.label}: ${wanted ? "on" : "off"}`} />}
      </ItemActions>
    </Item>
  );
}
