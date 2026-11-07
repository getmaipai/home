// READER-14: Settings, Offline data (view `home.reference_library`). One row per source (Wikipedia is one row) with a switch, or a
// version picker when the source comes in several sizes, and Minimum, Moderate and Full as one parent choice that sets the rows. Choices are staged in the page and written only by Apply, with the same
// storage bar and action bar as AI and models (AiGlance).
import { i18n } from "@lingui/core";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/dashboard/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@maipai/ui/src/ui/alert";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { JobProgress } from "@maipai/ui/src/elements/job-progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/ui/select";
import { StagedApplyBar } from "@/apps/settings/StagedApplyBar";
import { Switch } from "@maipai/ui/src/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@maipai/ui/src/ui/toggle-group";
import { StorageBar } from "@maipai/ui/src/primitives/StorageBar";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { RouteSkeleton } from "@maipai/ui/src/primitives/RouteSkeleton";
import presetsData from "@maipai/spec/vocab/reference-presets.json";
import { api, type ReferenceCatalogSet, type ReferenceJob } from "@/lib/api";
import { sizeGb } from "../../../../shared/diskPlanMath";
import { downloadProgress, useByteRates, type DownloadSnapshot } from "@/lib/downloadProgress";
import { errorLine } from "@/lib/hubReachability";

const presets = presetsData.presets;
const duration = (n: number | null) => {
  if (n === null) return i18n._({ id: "Time estimate unavailable", message: "Time estimate unavailable" });
  if (n < 60) return i18n._({ id: "About {count, plural, one {# second} other {# seconds}}", message: "About {count, plural, one {# second} other {# seconds}}", values: { count: n } });
  if (n < 3600) return i18n._({ id: "About {count, plural, one {# minute} other {# minutes}}", message: "About {count, plural, one {# minute} other {# minutes}}", values: { count: Math.ceil(n / 60) } });
  return i18n._({ id: "About {count, plural, one {# hour} other {# hours}}", message: "About {count, plural, one {# hour} other {# hours}}", values: { count: Math.ceil(n / 3600) } });
};
const signed = (bytes: number) => `${bytes < 0 ? "-" : "+"}${sizeGb(Math.abs(bytes))}`;
const messageOf = (error: unknown, fallback: string) => (errorLine(error, fallback));

const topics = (): Array<{ topic: string; sources: string[] }> => [
  { topic: i18n._({ id: "Encyclopedia", message: "Encyclopedia" }), sources: ["wikipedia-en", "wikipedia-simple", "vikidia"] },
  { topic: i18n._({ id: "Dictionaries", message: "Dictionaries" }), sources: ["wiktionary-simple", "wiktionary-en"] },
  { topic: i18n._({ id: "Health and medicine", message: "Health and medicine" }), sources: ["medlineplus"] },
  { topic: i18n._({ id: "Travel and the world", message: "Travel and the world" }), sources: ["wikivoyage", "world-factbook"] },
  { topic: i18n._({ id: "Books and how-to", message: "Books and how-to" }), sources: ["wikibooks", "stackexchange"] },
];
const sourceBlurb = (source: string): string | undefined => ({
  "wikipedia-en": i18n._({ id: "The English Wikipedia.", message: "The English Wikipedia." }),
  "wikipedia-simple": i18n._({ id: "Wikipedia in plain, simple English.", message: "Wikipedia in plain, simple English." }),
  vikidia: i18n._({ id: "An encyclopedia written for children.", message: "An encyclopedia written for children." }),
  "wiktionary-simple": i18n._({ id: "Word meanings in simple English.", message: "Word meanings in simple English." }),
  "wiktionary-en": i18n._({ id: "Word meanings, origins and translations.", message: "Word meanings, origins and translations." }),
  medlineplus: i18n._({ id: "Plain-language health and medicine pages from the US National Library of Medicine.", message: "Plain-language health and medicine pages from the US National Library of Medicine." }),
  wikivoyage: i18n._({ id: "Travel guides.", message: "Travel guides." }),
  "world-factbook": i18n._({ id: "Facts about every country.", message: "Facts about every country." }),
  wikibooks: i18n._({ id: "Free textbooks and manuals.", message: "Free textbooks and manuals." }),
  stackexchange: i18n._({ id: "Questions and answers on cooking, repairs, gardens and computers.", message: "Questions and answers on cooking, repairs, gardens and computers." }),
} as Record<string, string>)[source];
const flavourLabel = (flavour: string): string | undefined => ({ maxi: i18n._({ id: "Everything, with pictures", message: "Everything, with pictures" }), nopic: i18n._({ id: "Everything, no pictures", message: "Everything, no pictures" }), mini: i18n._({ id: "Short introductions only", message: "Short introductions only" }) } as Record<string, string>)[flavour];
const FLAVOUR_ORDER = ["maxi", "nopic", "mini"];
const SOURCE_LABEL: Record<string, string> = {
  "wikipedia-en": "Wikipedia", "wikipedia-simple": "Simple English Wikipedia", vikidia: "Vikidia", "wiktionary-simple": "Simple English Wiktionary", "wiktionary-en": "Wiktionary",
  medlineplus: "MedlinePlus", wikivoyage: "Wikivoyage", "world-factbook": "CIA World Factbook", wikibooks: "Wikibooks", stackexchange: "Stack Exchange",
};
/** A plain name for a version or a book: the source's own name, then which version when the source has several. */
const titleOf = (set: { source: string; flavour: string; name: string }) => {
  const label = SOURCE_LABEL[set.source];
  if (!label) return set.name;
  const flavour = flavourLabel(set.flavour);
  return flavour ? i18n._({ id: "{label}: {flavour}", message: "{label}: {flavour}", values: { label, flavour: `${flavour.charAt(0).toLowerCase()}${flavour.slice(1)}` } }) : label;
};
const versionLabel = (set: { flavour: string }) => flavourLabel(set.flavour) ?? i18n._({ id: "Standard", message: "Standard" });

/** One entry per source, with its versions biggest first. A source with one version has just that one. */
interface SourceRow { source: string; label: string; versions: ReferenceCatalogSet[] }
function sourceRows(sets: ReferenceCatalogSet[]): Array<{ topic: string; rows: SourceRow[] }> {
  const order = (set: ReferenceCatalogSet) => { const at = FLAVOUR_ORDER.indexOf(set.flavour); return at < 0 ? 99 : at; };
  const rowFor = (source: string): SourceRow | null => {
    const versions = sets.filter((set) => set.source === source).sort((a, b) => order(a) - order(b));
    return versions.length ? { source, label: SOURCE_LABEL[source] ?? versions[0]!.name, versions } : null;
  };
  const known = new Set(topics().flatMap((t) => t.sources));
  const groups = topics().map((t) => ({ topic: t.topic, rows: t.sources.map(rowFor).filter((row): row is SourceRow => row !== null) }));
  const others = [...new Set(sets.filter((set) => !known.has(set.source)).map((set) => set.source))].map(rowFor).filter((row): row is SourceRow => row !== null);
  return [...groups, { topic: i18n._({ id: "Other", message: "Other" }), rows: others }].filter((group) => group.rows.length > 0);
}

/** A book download in the shared progress card's words. Waiting for the nightly window reads as queued with the reason. */
export function referenceDownload(job: ReferenceJob, title: string, bytesPerSecond?: number): DownloadSnapshot {
  const state = job.state === "downloading" ? "running" : job.state === "waiting_window" ? "queued" : job.state;
  const status = job.state === "waiting_window" ? i18n._({ id: "Waits for the nightly download window", message: "Waits for the nightly download window" })
    : job.state === "queued" ? i18n._({ id: "Starting soon", message: "Starting soon" })
      : job.state === "paused" ? i18n._({ id: "Paused", message: "Paused" })
        : job.state === "failed" ? job.message ?? i18n._({ id: "The download failed. Cancel it, then switch the book on again to retry.", message: "The download failed. Cancel it, then switch the book on again to retry." })
          : job.state === "downloading" ? i18n._({ id: "Downloading", message: "Downloading" }) : job.message ?? "";
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
      for (const set of removals) { setStep(i18n._({ id: "Removing {title}…", message: "Removing {title}…", values: { title: titleOf(set) } })); await api.referenceRemove(set.id); }
      for (const set of additions) { setStep(i18n._({ id: "Starting {title}…", message: "Starting {title}…", values: { title: titleOf(set) } })); await api.referenceInstall(set.id); }
    },
    onSuccess: async () => { setStep(null); setStaged({}); setError(null); await client.invalidateQueries({ queryKey: ["reference-state"] }); await client.invalidateQueries({ queryKey: ["reference-catalog"] }); },
    onError: async (e) => { setStep(null); setError(messageOf(e, i18n._({ id: "Home could not change the offline books. Check the drive space and the Home connection, then try again.", message: "Home could not change the offline books. Check the drive space and the Home connection, then try again." }))); await client.invalidateQueries({ queryKey: ["reference-state"] }); await client.invalidateQueries({ queryKey: ["reference-catalog"] }); },
  });
  const jobAction = useMutation({
    mutationFn: ({ job, action }: { job: ReferenceJob; action: "pause" | "resume" | "cancel" }) => api.referenceJob(job.id, action),
    onSuccess: () => client.invalidateQueries({ queryKey: ["reference-state"] }),
    onError: () => setError(i18n._({ id: "Home could not change this download. Check the Home connection, then try again.", message: "Home could not change this download. Check the Home connection, then try again." })),
  });

  const drive = useQuery({ queryKey: ["reference-disk"], queryFn: api.referenceDisk, refetchInterval: () => state.data?.jobs.length ? 5000 : false });
  const total = drive.data && drive.data.totalBytes > 0 ? drive.data.totalBytes : null;
  const free = drive.data?.freeBytes ?? plan.data?.freeBytes ?? hardware.data?.freeDiskBytes ?? null;
  const capacity = total ?? (free !== null ? installedBytes + free : null);
  // Everything else on the drive is the part that is neither free nor an offline book.
  const otherBytes = total !== null && free !== null ? Math.max(0, total - free - installedBytes) : 0;
  const segments = [
    ...(otherBytes > 0 ? [{ id: "other", label: i18n._({ id: "Everything else", message: "Everything else" }), bytes: otherBytes, hue: "--hue-blue" }] : []),
    { id: "books", label: i18n._({ id: "Offline books", message: "Offline books" }), bytes: installedBytes, hue: "--hue-violet" },
    ...(addBytes > 0 ? [{ id: "pending", label: i18n._({ id: "Staged", message: "Staged" }), bytes: addBytes, hue: "--hue-orange" }] : []),
  ];
  const refusal = plan.data?.refusal ?? null;
  const planFailed = additions.length > 0 && plan.isError;
  const kidsLose = removals.filter((set) => set.bands.includes("child") || set.bands.includes("teen"));
  const loadFailed = state.isError || catalog.isError;

  return (
    <section className="flex flex-col gap-4" data-testid="offline-data">
      <p className="text-base text-muted-foreground">{i18n._({ id: "Books that live on this Home, like Wikipedia and health information. Each one downloads once, then works with no internet. Children and teens only see the books made for them.", message: "Books that live on this Home, like Wikipedia and health information. Each one downloads once, then works with no internet. Children and teens only see the books made for them." })}</p>
      {loadFailed ? <Alert variant="destructive"><AlertTitle>{i18n._({ id: "The page did not load", message: "The page did not load" })}</AlertTitle><AlertDescription>{i18n._({ id: "Home could not load the offline books. Check that Home is running, then reload this page.", message: "Home could not load the offline books. Check that Home is running, then reload this page." })}</AlertDescription></Alert> : null}

      <ItemGroup variant="card">
        <Item>
          <ItemContent>
            <ItemTitle>{i18n._({ id: "Disk space", message: "Disk space" })}</ItemTitle>
            <StorageBar segments={segments} capacityBytes={capacity} formatBytes={sizeGb} />
            <ItemDescription clamp={false}>{i18n._({ id: "{value}{value2} · {sizeGb} of offline books.", message: "{value}{value2} · {sizeGb} of offline books.", values: { value: total !== null ? i18n._({ id: "{size} drive", message: "{size} drive", values: { size: sizeGb(total) } }) : i18n._({ id: "This computer", message: "This computer" }), value2: free !== null ? i18n._({ id: " · {size} free", message: " · {size} free", values: { size: sizeGb(free) } }) : "", sizeGb: sizeGb(installedBytes) } })}</ItemDescription>
            {stagedCount > 0 ? <ItemDescription clamp={false}>{i18n._({ id: "After applying: {sizeGb} of books ({signed}){value}.", message: "After applying: {sizeGb} of books ({signed}){value}.", values: { sizeGb: sizeGb(installedBytes + addBytes - freedBytes), signed: signed(addBytes - freedBytes), value: free !== null ? i18n._({ id: ", {size} free", message: ", {size} free", values: { size: sizeGb(Math.max(0, free - addBytes + freedBytes)) } }) : "" } })}</ItemDescription> : null}
          </ItemContent>
        </Item>
      </ItemGroup>

      <section aria-label={i18n._({ id: "Library size", message: "Library size" })} className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{i18n._({ id: "How much to keep", message: "How much to keep" })}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup type="single" variant="chip" wrap value={activePreset ?? ""} onValueChange={(next) => { if (next) choosePreset(next); }} aria-label={i18n._({ id: "Library size", message: "Library size" })}>
            {presets.map((preset) => <ToggleGroupItem key={preset.id} value={preset.id}>{preset.label}</ToggleGroupItem>)}
          </ToggleGroup>
          {activePreset === undefined && sets.length > 0 ? <Badge variant="secondary">{i18n._({ id: "Custom", message: "Custom" })}</Badge> : null}
        </div>
        <p className="text-base text-muted-foreground">{presets.find((preset) => preset.id === activePreset)?.copy ?? i18n._({ id: "Your own mix. Pick Minimum, Moderate or Full to start from a ready-made set, then switch single books on or off below.", message: "Your own mix. Pick Minimum, Moderate or Full to start from a ready-made set, then switch single books on or off below." })}</p>
      </section>

      {catalog.isLoading || state.isLoading ? <RouteSkeleton label={i18n._({ id: "Loading offline books", message: "Loading offline books" })} /> : null}
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
          {error ? <Alert variant="destructive"><AlertTitle>{i18n._({ id: "That did not work", message: "That did not work" })}</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
          {planFailed ? <Alert variant="destructive"><AlertTitle>{i18n._({ id: "Home could not check the drive space", message: "Home could not check the drive space" })}</AlertTitle><AlertDescription>{i18n._({ id: "Check that Home is running and online, then switch a book off and on again to retry.", message: "Check that Home is running and online, then switch a book off and on again to retry." })}</AlertDescription></Alert> : null}
          {refusal ? <Alert variant="warning"><AlertTitle>{i18n._({ id: "There is not enough room", message: "There is not enough room" })}</AlertTitle><AlertDescription>{refusal}</AlertDescription></Alert> : null}
        </>}
        staged={stagedCount > 0} title={i18n._({ id: "{count, plural, one {# change is waiting} other {# changes are waiting}}", message: "{count, plural, one {# change is waiting} other {# changes are waiting}}", values: { count: stagedCount } })}
        summary={<p className="text-base">{additions.length > 0 ? i18n._({ id: "{count} to download ({size}{time}). ", message: "{count} to download ({size}{time}). ", values: { count: additions.length, size: sizeGb(addBytes), time: plan.data ? `, ${duration(plan.data.estimatedSeconds)}` : "" } }) : ""}{removals.length > 0 ? i18n._({ id: "{count} to remove (frees {size}).", message: "{count} to remove (frees {size}).", values: { count: removals.length, size: sizeGb(freedBytes) } }) : ""}</p>}
        step={step} applying={apply.isPending} applyDisabled={Boolean(refusal) || (additions.length > 0 && plan.isPending) || planFailed}
        applyLabel={i18n._({ id: "Apply", message: "Apply" })} discardLabel={i18n._({ id: "Discard", message: "Discard" })} onApply={() => removals.length > 0 ? setConfirmRemove(true) : apply.mutate()} onDiscard={() => setStaged({})}
      />

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{removals.length === 1 ? i18n._({ id: "Remove {title}?", message: "Remove {title}?", values: { title: removals[0] ? titleOf(removals[0]) : i18n._({ id: "this book", message: "this book" }) } }) : i18n._({ id: "Remove {count} books?", message: "Remove {count} books?", values: { count: removals.length } })}</AlertDialogTitle>
            <AlertDialogDescription>{i18n._({ id: "{sizeGb} will be freed. {value} You can download them again later.", message: "{sizeGb} will be freed. {value} You can download them again later.", values: { sizeGb: sizeGb(freedBytes), value: kidsLose.length > 0 ? i18n._({ id: "Children and teens may lose access to {books}.", message: "Children and teens may lose access to {books}.", values: { books: kidsLose.map((set) => titleOf(set)).join(", ") } }) : i18n._({ id: "No book for children or teens is removed.", message: "No book for children or teens is removed." }) } })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{i18n._({ id: "Cancel", message: "Cancel" })}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => { setConfirmRemove(false); apply.mutate(); }}>{i18n._({ id: "Remove and apply", message: "Remove and apply" })}</AlertDialogAction>
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
  const status = installed ? i18n._({ id: "Installed", message: "Installed" }) : download ? download.status : i18n._({ id: "Not installed", message: "Not installed" });
  const blocked = Boolean(job) || row.versions.every((set) => !set.installed && !set.available);
  return (
    <Item key={row.source} data-testid={`offline-row-${row.source}`}>
      <ItemContent>
        <ItemTitle>
          {row.label}
          {forKids ? <Badge variant="secondary">{i18n._({ id: "For children", message: "For children" })}</Badge> : null}
          {pending ? <Badge variant="outline">{wanted ? i18n._({ id: "Will download", message: "Will download" }) : i18n._({ id: "Will remove", message: "Will remove" })}</Badge> : null}
        </ItemTitle>
        <ItemDescription clamp={false}>{sourceBlurb(row.source)}</ItemDescription>
        <ItemDescription clamp={false}>{i18n._({ id: "{value} · Snapshot {value2} · {status}{value3}", message: "{value} · Snapshot {value2} · {status}{value3}", values: { value: multi ? (current ? `${versionLabel(current)} · ${sizeGb(current.sizeBytes)}` : i18n._({ id: "Off", message: "Off" })) : sizeGb(shown.sizeBytes), value2: shown.snapshotDate ?? i18n._({ id: "date not listed", message: "date not listed" }), status, value3: shown.message ? ` · ${shown.message}` : "" } })}</ItemDescription>
        {job && download ? (
          <>
            <JobProgress {...downloadProgress(download)} variant="full" cancelLabel={i18n._({ id: "Cancel the {label} download", message: "Cancel the {label} download", values: { label: row.label } })} onCancel={() => onJob(job, "cancel")} {...(job.state === "paused" ? { onResume: () => onJob(job, "resume") } : {})} />
            {job.state === "downloading" ? <div><Button type="button" variant="outline" size="sm" onClick={() => onJob(job, "pause")}>{i18n._({ id: "Pause", message: "Pause" })}</Button></div> : null}
            {job.state === "waiting_window" ? <div><Button type="button" variant="outline" size="sm" onClick={() => onJob(job, "resume")}>{i18n._({ id: "Start now", message: "Start now" })}</Button></div> : null}
          </>
        ) : null}
      </ItemContent>
      <ItemActions>
        {multi ? (
          <Select value={wanted ?? "off"} disabled={blocked} onValueChange={(value) => onChoose(value === "off" ? null : value)}>
            <SelectTrigger aria-label={i18n._({ id: "{label} version", message: "{label} version", values: { label: row.label } })}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="off">{i18n._({ id: "Off", message: "Off" })}</SelectItem>
              {row.versions.map((set) => <SelectItem key={set.id} value={set.id}>{versionLabel(set)} · {sizeGb(set.sizeBytes)}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : <Switch checked={wanted !== null} disabled={blocked} onCheckedChange={(on) => onChoose(on ? row.versions[0]!.id : null)} aria-label={wanted ? i18n._({ id: "{label}: on", message: "{label}: on", values: { label: row.label } }) : i18n._({ id: "{label}: off", message: "{label}: off", values: { label: row.label } })} />}
      </ItemActions>
    </Item>
  );
}
