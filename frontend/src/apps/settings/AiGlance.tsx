// AIMODELS-GLANCE-2026-10-26: Settings, AI and models, Overview: one bird's-eye page (view `ai.glance`). Header, the "not on this
// device" and "staged" banners, the Memory and Storage bars with their after-apply projection, seven rows, and the footer.
// Choices are staged in the page and written only by Apply. All words are the spec card's `copy` (rule S5); progress rides
// InstallStrip (rule S6); kit Elements as shipped (rule 9). Variants the kit lacks are listed in the design note.
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@maipai/ui/src/ui/alert";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { Progress } from "@maipai/ui/src/ui/progress";
import { RouteSkeleton } from "@maipai/ui/src/primitives/RouteSkeleton";
import { Switch } from "@maipai/ui/src/ui/switch";
import { StorageBar } from "@maipai/ui/src/primitives/StorageBar";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/dashboard/components/ui/alert-dialog";
import { getIcon } from "@maipai/ui/src/icons";
import { Link } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { aiChoicesApi } from "@/lib/aiChoicesApi";
import { StagedApplyBar } from "@/apps/settings/StagedApplyBar";
import { InstallStrip } from "@/shell/InstallStrip";
import { FreeUpSpaceDialog } from "@/apps/settings/FreeUpSpaceDialog";
import { Dialog, DialogContent } from "@maipai/ui/src/ui/dialog";
import { AiModelChoices } from "@/apps/settings/AiModelDialog";
import { AiSlotChoices } from "@/apps/settings/AiSlotDialog";
import { TIERED_JOBS, configurableTiers, draftOf, sameDraft, slotKey, toStored, levelsLine, type SlotDrafts } from "@/apps/settings/aiTierSlots";
import { useAiChoices } from "@/apps/settings/useAiChoices";
import { ENGINE_ROLE, JOB_ICONS, JOB_ORDER, OFF, buildRows, counts, fill, missingRows, project, stageFor, type GlanceRow, type StagedMap } from "@/apps/settings/aiGlanceRows";
import { sizeGb } from "../../../../shared/diskPlanMath";
import type { AiJobId } from "../../../../shared/aiChoices";
import type { SettingsViewProps } from "@/shell/pages/settings/settingsViews";

const GB = 1_000_000_000;
const messageOf = (error: unknown, fallback: string) => (error instanceof ApiError ? error.message : fallback);
const delta = (bytes: number) => `${bytes < 0 ? "-" : "+"}${sizeGb(Math.abs(bytes))}`;

function whenText(updatedAt: number): string {
  const minutes = Math.floor((Date.now() - updatedAt) / 60_000);
  return minutes < 1 ? "just now" : minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
}

export function AiGlance({ card }: SettingsViewProps) {
  const copy = ((card as { copy?: Record<string, string> } | undefined)?.copy) ?? {};
  const { query, refresh } = useAiChoices();
  const hardware = useQuery({ queryKey: ["host", "hardware"], queryFn: () => api.hardware(), staleTime: 300_000 });
  const settings = useQuery({ queryKey: ["settings", "household", "engines"], queryFn: () => api.settingsValues("household") });
  const [staged, setStaged] = useState<StagedMap>({});
  const [editing, setEditing] = useState<GlanceRow | null>(null);
  const [resetting, setResetting] = useState<GlanceRow | null>(null);
  const [levels, setLevels] = useState<GlanceRow | null>(null);
  const [levelsError, setLevelsError] = useState<string | null>(null);
  const [cleanup, setCleanup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>(null);

  const data = query.data;
  const offJobs = useMemo(() => {
    const off = new Set<AiJobId>();
    for (const job of JOB_ORDER) {
      const value = settings.data?.find((entry) => entry.key === `engines.${ENGINE_ROLE[job]}.choice`)?.value;
      if (value === "off") off.add(job);
    }
    return off;
  }, [settings.data]);
  const rows = useMemo(() => buildRows(data?.cards ?? [], offJobs, staged), [data, offJobs, staged]);
  const projection = project(rows);
  const tally = counts(rows);
  const missing = missingRows(rows);
  const stagedCount = rows.filter((row) => row.staged).length;
  const missingBytes = missing.reduce((sum, row) => sum + (row.live?.downloadBytes ?? 0), 0);

  const stage = (row: GlanceRow, pick: string) => {
    setStaged((previous) => {
      const next = { ...previous };
      const entry = stageFor(row, pick);
      if (entry) next[row.job] = entry; else delete next[row.job];
      return next;
    });
  };

  const slotDrafts = (row: GlanceRow): SlotDrafts => {
    const role = TIERED_JOBS[row.job]!.role;
    const read = (tier: "reduced" | "standard" | "boost" | "max") => draftOf(settings.data?.find((entry) => entry.key === slotKey(role, tier))?.value, tier);
    return { reduced: read("reduced"), standard: read("standard"), boost: read("boost"), max: read("max") };
  };
  const saveLevels = useMutation({
    mutationFn: async ({ row, drafts }: { row: GlanceRow; drafts: SlotDrafts }) => {
      const before = slotDrafts(row);
      const role = TIERED_JOBS[row.job]!.role;
      for (const tier of configurableTiers(row.job)) if (!sameDraft(before[tier], drafts[tier])) await api.setSetting("household", slotKey(role, tier), toStored(drafts[tier], tier));
    },
    onSuccess: () => { setLevels(null); setLevelsError(null); void settings.refetch(); refresh(); },
    onError: (e) => setLevelsError(messageOf(e, "Could not save the levels. Check that Home is running, then try again.")),
  });

  const download = useMutation({
    mutationFn: async (targets: GlanceRow[]) => { for (const row of targets) if (row.live) await aiChoicesApi.choose(row.job, row.live.id); },
    onSuccess: refresh,
    onError: (e) => setError(messageOf(e, "Could not start the downloads. Check that the engine is running, then try again.")),
  });

  const apply = useMutation({
    mutationFn: async () => {
      for (const row of rows.filter((entry) => entry.staged)) {
        setStep(`${row.shownEnabled ? "Setting up" : "Turning off"} ${row.title}…`);
        const role = ENGINE_ROLE[row.job];
        const single = row.options.length === 1 && row.options[0]!.kind === "switch" ? row.options[0]! : null;
        if (!row.shownEnabled) {
          if (single?.setting) await api.setSetting("household", single.setting.key, false, true);
          else if (row.job === "wakeword") { if (single && row.liveEnabled) await aiChoicesApi.choose(row.job, single.id); }
          else await api.setSetting("household", `engines.${role}.choice`, "off", true);
        } else if (row.shown && (staged[row.job]?.choiceId || single)) {
          await aiChoicesApi.choose(row.job, row.shown.id);
          if (offJobs.has(row.job)) await api.setSetting("household", `engines.${role}.choice`, "auto");
        } else if (offJobs.has(row.job)) {
          await api.setSetting("household", `engines.${role}.choice`, "auto");
        }
      }
    },
    onSuccess: () => { setStep(null); setStaged({}); setError(null); refresh(); void settings.refetch(); },
    onError: (e) => { setStep(null); setError(messageOf(e, "Could not apply the changes. Check that the engine is running, then try again.")); refresh(); void settings.refetch(); },
  });

  if (query.isLoading) return <RouteSkeleton label="Loading your AI setup" />;
  if (query.isError || !data) return <section><Alert variant="destructive"><AlertTitle>The page did not load</AlertTitle><AlertDescription>{messageOf(query.error, "Check that Home is running, then reload this page.")}</AlertDescription></Alert></section>;

  const totalRam = (hardware.data?.totalRamGb ?? 0) * GB;
  const installed = data.installed_bytes;
  const freeDisk = data.free_disk_bytes ?? hardware.data?.freeDiskBytes ?? null;
  // What the computer reports as not free, less Home's own models: an estimate, shown only when the hub could read it.
  const alwaysBytes = Math.min(projection.alwaysNow, projection.alwaysAfter);
  const whenUsedBytes = Math.max(0, Math.min(projection.ramNow, projection.ramAfter) - alwaysBytes);
  const otherApps = totalRam > 0 && data.memory_available_bytes != null ? Math.max(0, totalRam - data.memory_available_bytes - projection.ramNow) : 0;
  const memorySegments = [
    { id: "home", label: "Always loaded", bytes: alwaysBytes, hue: "--hue-violet" },
    ...(whenUsedBytes > 0 ? [{ id: "when-used", label: "Loads when used", bytes: whenUsedBytes, hue: "--hue-blue" }] : []),
    ...(otherApps > 0 ? [{ id: "other", label: "Other apps", bytes: otherApps, hue: "--hue-teal" }] : []),
    ...(projection.ramAfter > projection.ramNow ? [{ id: "pending", label: copy.staged_label ?? "Staged", bytes: projection.ramAfter - projection.ramNow, hue: "--hue-orange" }] : []),
  ];
  const storageSegments = [
    { id: "models", label: "Models", bytes: installed, hue: "--hue-violet" },
    ...(projection.downloadBytes > 0 ? [{ id: "pending", label: copy.staged_label ?? "Staged", bytes: projection.downloadBytes, hue: "--hue-orange" }] : []),
  ];
  const storageCapacity = freeDisk !== null ? installed + freeDisk : null;
  const device = hardware.data?.computerName ?? "this computer";

  return (
    <section aria-label={copy.title} className="flex flex-col gap-4" data-testid="ai-glance">
      <InstallStrip detailsHref={null} />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-base text-muted-foreground">{copy.subtitle}</p>
        </div>
        {missing.length > 0 ? <Button type="button" disabled={download.isPending} onClick={() => download.mutate(missing)}>{fill(copy.download_missing ?? "", { count: missing.length })}</Button> : null}
      </header>
      {data.stack === "unreachable" ? <Alert variant="destructive"><AlertTitle>The AI engine isn't answering</AlertTitle><AlertDescription>{data.message ?? "Check that the engine is running, then try again."}</AlertDescription></Alert> : null}
      {missing.length > 0 ? (
        <Alert variant="warning" data-testid="ai-missing">
          <AlertTitle>{fill(copy.missing_title ?? "", { count: missing.length })}</AlertTitle>
          <AlertDescription>{missing.map((row) => row.live?.label).join(", ")} · {sizeGb(missingBytes)}</AlertDescription>
        </Alert>
      ) : null}

      <ItemGroup variant="card">
        <Item>
          <ItemContent>
            <ItemTitle>{copy.memory}</ItemTitle>
            <StorageBar segments={memorySegments} capacityBytes={totalRam > 0 ? totalRam : null} formatBytes={sizeGb} />
            {stagedCount > 0 ? <ItemDescription clamp={false}>{fill(copy.memory_after ?? "", { delta: delta(projection.ramAfter - projection.ramNow) })}</ItemDescription> : null}
          </ItemContent>
        </Item>
        <Item>
          <ItemContent>
            <ItemTitle>{copy.storage}</ItemTitle>
            <StorageBar segments={storageSegments} capacityBytes={storageCapacity} formatBytes={sizeGb} />
            {data.unused_bytes > 0 ? <Button type="button" variant="link" onClick={() => setCleanup(true)}>{fill(copy.free_up ?? "", { size: sizeGb(data.unused_bytes) })}</Button> : null}
            {projection.downloadBytes > 0 ? <ItemDescription clamp={false}>{fill(copy.storage_after ?? "", { total: sizeGb(installed + projection.downloadBytes), delta: delta(projection.downloadBytes) })}</ItemDescription> : null}
          </ItemContent>
        </Item>
      </ItemGroup>

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{copy.glance}</h2>
        <p className="text-base text-muted-foreground" data-testid="ai-counter">{fill(copy.counter ?? "", tally)}</p>
      </div>
      <ItemGroup variant="card" role="group" aria-label={copy.glance}>
        {rows.map((row) => glanceRow({ row, copy, onSwitch: (on) => stage(row, on ? (row.shown?.id ?? row.recommended?.id ?? OFF) : OFF), onEdit: () => setEditing(row), levelsLine: TIERED_JOBS[row.job] ? levelsLine(slotDrafts(row), row.job, row.options) : null, onLevels: TIERED_JOBS[row.job] ? () => { setLevelsError(null); setLevels(row); } : null, onReset: () => setResetting(row), onDownload: () => download.mutate([row]) }))}
      </ItemGroup>

      <p className="text-base text-muted-foreground">
        {fill(copy.checked ?? "", { when: whenText(query.dataUpdatedAt) })} · {device}{" "}
        <Link to="/settings/ai?tab=engines" className="inline-flex min-h-12 items-center underline">{copy.view_device}</Link>
      </p>

      <Dialog open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent scroll="viewport">{editing ? <AiModelChoices key={editing.job} row={editing} copy={copy} onClose={() => setEditing(null)} onSave={stage} onAdded={refresh} /> : null}</DialogContent>
      </Dialog>
      <Dialog open={levels !== null} onOpenChange={(open) => { if (!open) setLevels(null); }}>
        <DialogContent scroll="viewport">{levels ? <AiSlotChoices key={levels.job} row={levels} initial={slotDrafts(levels)} copy={copy} saving={saveLevels.isPending} error={levelsError} onClose={() => setLevels(null)} onSave={(drafts) => saveLevels.mutate({ row: levels, drafts })} /> : null}</DialogContent>
      </Dialog>
      <StagedApplyBar testId="ai-action-bar" stagedTestId="ai-staged" notices={error ? <Alert variant="destructive"><AlertTitle>That did not work</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null} staged={stagedCount > 0} title={fill(copy.staged ?? "", { count: stagedCount })} step={step} applying={apply.isPending} applyLabel={copy.apply ?? "Apply"} discardLabel={copy.discard ?? "Discard"} onApply={() => apply.mutate()} onDiscard={() => setStaged({})} />
      <AlertDialog open={resetting !== null} onOpenChange={(open) => { if (!open) setResetting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <p className="text-base font-medium uppercase tracking-wide text-muted-foreground">{copy.reset_eyebrow}</p>
            <AlertDialogTitle>{fill(copy.reset_title ?? "", { name: resetting?.title ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>{copy.reset_body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{copy.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (resetting?.recommended) stage(resetting, resetting.recommended.id); setResetting(null); }}>{copy.reset_confirm}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <FreeUpSpaceDialog open={cleanup} onOpenChange={setCleanup} onChanged={refresh} />
    </section>
  );
}

/** One row, drawn by a plain function so no Home component has a kit Item as its root (rule 9). */
function glanceRow({ row, copy, onSwitch, onEdit, onLevels, levelsLine: levels, onReset, onDownload }: { row: GlanceRow; levelsLine: string | null; copy: Record<string, string>; onSwitch: (on: boolean) => void; onEdit: () => void; onLevels: (() => void) | null; onReset: () => void; onDownload: () => void }) {
  const Icon = getIcon(JOB_ICONS[row.job]);
  const Reset = getIcon("rotate-ccw");
  const Gear = getIcon("settings");
  const Down = getIcon("download");
  const model = row.shown;
  // What the engine is doing for this row right now: a download or install in flight (any of its models), or the chosen model's failure.
  const busy = row.options.find((option) => option.state === "installing") ?? null;
  const progress = busy ? { text: busy.percent !== null ? `${fill(copy.installing ?? "Downloading and installing {name}", { name: busy.label })}: ${Math.round(busy.percent)}%` : fill(copy.installing ?? "Downloading and installing {name}", { name: busy.label }), percent: busy.percent } : null;
  const failed = !busy && model?.state === "failed" ? model : null;
  const line = !row.offered ? (copy.not_offered ?? "") : model?.description ?? row.summary;
  return (
    <Item key={row.job} data-testid={`ai-row-${row.job}`} data-missing={row.missing ? "true" : undefined}>
      <ItemMedia variant="icon"><Icon /></ItemMedia>
      <ItemContent>
        <ItemTitle>
          {row.title}
          {row.offered ? <Badge tone={row.badge === "recommended" ? "success" : undefined} variant={row.badge === "disabled" ? "secondary" : "default"}>{copy[row.badge]}</Badge> : null}
          {row.offered && row.shown?.id === "chat.uncensored" ? <Badge variant="outline" tone="warning">Uncensored</Badge> : null}
        </ItemTitle>
        <ItemDescription clamp={false}>{model && row.offered ? `${model.label}. ` : ""}{line}</ItemDescription>
        {levels && row.offered ? <ItemDescription clamp={false} data-testid={`ai-levels-${row.job}`}>{levels}</ItemDescription> : null}
        {model && row.offered ? <ItemDescription clamp={false}>{model.details.map((part) => part.name).join(", ")}</ItemDescription> : null}
        {row.job === "wakeword" && row.offered ? <ItemDescription clamp={false}>{copy.wakeword_note}</ItemDescription> : null}
        {progress ? (
          <div className="flex flex-col gap-1" data-testid={`ai-progress-${row.job}`}>
            <ItemDescription clamp={false}>{progress.text}</ItemDescription>
            {progress.percent !== null ? <Progress value={progress.percent} aria-label={progress.text} /> : null}
          </div>
        ) : null}
        {failed ? <p className="text-base text-destructive">{failed.failure ?? failed.stateText}</p> : null}
      </ItemContent>
      <ItemActions>
        {model && row.offered && row.shownEnabled ? <span className="text-base text-muted-foreground">{sizeGb(model.installedBytes)} · {fill(copy.ram_estimate ?? "", { size: sizeGb(model.ramBytes) })}</span> : null}
        {row.badge === "custom" && row.recommended ? <Button type="button" variant="ghost" size="icon-sm" aria-label={`${copy.reset_confirm}: ${row.title}`} onClick={onReset}><Reset /></Button> : null}
        {row.missing ? <Button type="button" variant="ghost" size="icon-sm" aria-label={`${copy.download_missing?.replace(" ({count})", "")}: ${row.title}`} onClick={onDownload}><Down /></Button> : null}
        <Switch checked={row.shownEnabled} disabled={!row.offered} onCheckedChange={onSwitch} aria-label={`${row.title}: ${row.shownEnabled ? copy.on : copy.off}`} />
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`${copy.dialog_title}: ${row.title}`} disabled={!row.offered} onClick={onEdit}><Gear /></Button>
        {onLevels ? <Button type="button" variant="ghost" size="sm" aria-label={`Levels: ${row.title}`} disabled={!row.offered} onClick={onLevels}>Levels</Button> : null}
      </ItemActions>
    </Item>
  );
}
