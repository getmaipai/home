// AIMODELS-GLANCE-2026-10-26: Settings, AI and models, Overview: one bird's-eye page (view `ai.glance`). Header, the "not on this
// device" and "staged" banners, the Memory and Storage bars with their after-apply projection, seven rows, and the footer.
// Choices are staged in the page and written only by Apply. All words are the spec card's `copy` (rule S5); progress rides
// InstallStrip (rule S6); kit Elements as shipped (rule 9). Variants the kit lacks are listed in the design note.
import { i18n } from "@lingui/core";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@maipai/ui/src/ui/alert";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { JobProgress } from "@maipai/ui/src/elements/job-progress";
import { RouteSkeleton } from "@maipai/ui/src/primitives/RouteSkeleton";
import { Switch } from "@maipai/ui/src/ui/switch";
import { StorageBar } from "@maipai/ui/src/primitives/StorageBar";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@maipai/ui/src/dashboard/components/ui/alert-dialog";
import { getIcon } from "@maipai/ui/src/icons";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { aiChoicesApi } from "@/lib/aiChoicesApi";
import { StagedApplyBar } from "@/apps/settings/StagedApplyBar";
import { InstallStrip } from "@/shell/InstallStrip";
import { FreeUpSpaceDialog } from "@/apps/settings/FreeUpSpaceDialog";
import { Dialog, DialogContent } from "@maipai/ui/src/ui/dialog";
import { AiModelChoices } from "@/apps/settings/AiModelDialog";
import { AiSlotChoices } from "@/apps/settings/AiSlotDialog";
import { AiJobSummary } from "@/apps/settings/AiJobSummary";
import { TIERED_JOBS, configurableTiers, draftOf, sameDraft, slotKey, toStored, type SlotDrafts, type SlotTier } from "@/apps/settings/aiTierSlots";
import { useAiChoices } from "@/apps/settings/useAiChoices";
import { ENGINE_ROLE, HUB_PART_JOBS, JOB_ICONS, JOB_ORDER, OFF, buildRows, counts, fill, missingRows, project, stageFor, type GlanceRow, type StagedMap } from "@/apps/settings/aiGlanceRows";
import { sizeGb } from "../../../../shared/diskPlanMath";
import type { AiJobId } from "../../../../shared/aiChoices";
import type { SettingsViewProps } from "@/shell/pages/settings/settingsViews";
import { downloadProgress } from "@/lib/downloadProgress";
import { errorLine } from "@/lib/hubReachability";
import { StatusCard } from "@maipai/ui/src/elements/status-card";

const GB = 1_000_000_000;
const messageOf = (error: unknown, fallback: string) => (errorLine(error, fallback));
const delta = (bytes: number) => `${bytes < 0 ? "-" : "+"}${sizeGb(Math.abs(bytes))}`;

function whenText(updatedAt: number): string {
  const minutes = Math.floor((Date.now() - updatedAt) / 60_000);
  return minutes < 1 ? i18n._({ id: "just now", message: "just now" }) : i18n._({ id: "{minutes, plural, one {# minute ago} other {# minutes ago}}", message: "{minutes, plural, one {# minute ago} other {# minutes ago}}", values: { minutes } });
}

export function AiGlance({ card }: SettingsViewProps) {
  const copy = ((card as { copy?: Record<string, string> } | undefined)?.copy) ?? {};
  const { query, refresh } = useAiChoices();
  const hardware = useQuery({ queryKey: ["host", "hardware"], queryFn: () => api.hardware(), staleTime: 300_000 });
  const settings = useQuery({ queryKey: ["settings", "household", "engines"], queryFn: () => api.settingsValues("household") });
  const [staged, setStaged] = useState<StagedMap>({});
  const [editing, setEditing] = useState<GlanceRow | null>(null);
  const [resetting, setResetting] = useState<GlanceRow | null>(null);
  const maxWindow = useQuery({ queryKey: ["ai", "tier-window"], queryFn: () => aiChoicesApi.tierWindow(), refetchInterval: 10_000, retry: false });
  const stopWindow = useMutation({ mutationFn: () => aiChoicesApi.stopTierWindow(), onSettled: () => { void maxWindow.refetch(); } });
  const [levels, setLevels] = useState<GlanceRow | null>(null);
  const [levelTier, setLevelTier] = useState<SlotTier | null>(null);
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
  const tierPicks = useQuery({ queryKey: ["ai", "tiers", levels?.job], queryFn: () => aiChoicesApi.tiers(levels!.job), enabled: levels !== null, staleTime: 60_000, retry: false });
  const saveLevels = useMutation({
    mutationFn: async ({ row, drafts }: { row: GlanceRow; drafts: SlotDrafts }) => {
      const before = slotDrafts(row);
      const role = TIERED_JOBS[row.job]!.role;
      for (const tier of configurableTiers(row.job)) if (!sameDraft(before[tier], drafts[tier])) await api.setSetting("household", slotKey(role, tier), toStored(drafts[tier], tier));
    },
    onSuccess: () => { setLevelTier(null); setLevelsError(null); void settings.refetch(); refresh(); },
    onError: (e) => setLevelsError(messageOf(e, i18n._({ id: "Could not save the levels. Check that Home is running, then try again.", message: "Could not save the levels. Check that Home is running, then try again." }))),
  });

  const download = useMutation({
    mutationFn: async (targets: GlanceRow[]) => { for (const row of targets) if (row.live) await aiChoicesApi.choose(row.job, row.live.id); },
    onSuccess: refresh,
    onError: (e) => setError(messageOf(e, i18n._({ id: "Could not start the downloads. Check that the engine is running, then try again.", message: "Could not start the downloads. Check that the engine is running, then try again." }))),
  });

  const apply = useMutation({
    mutationFn: async () => {
      for (const row of rows.filter((entry) => entry.staged)) {
        setStep(row.shownEnabled ? i18n._({ id: "Setting up {title}…", message: "Setting up {title}…", values: { title: row.title } }) : i18n._({ id: "Turning off {title}…", message: "Turning off {title}…", values: { title: row.title } }));
        const role = ENGINE_ROLE[row.job];
        const single = row.options.length === 1 && row.options[0]!.kind === "switch" ? row.options[0]! : null;
        if (!row.shownEnabled) {
          if (single?.setting) {
            // A picture slot (Boost) is not a plain on/off key: the hub's choose route turns the switch off and keeps the slot's options.
            if (single.setting.key.includes(".tier.")) { if (row.liveEnabled) await aiChoicesApi.choose(row.job, single.id); }
            else await api.setSetting("household", single.setting.key, false, true);
          }
          else if (row.job === "stems") { /* Stems has no On/Off setting: the parts are installed or not, and nothing else to turn off. */ }
          else if (HUB_PART_JOBS.has(row.job)) { if (single && row.liveEnabled) await aiChoicesApi.choose(row.job, single.id); }
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
    onError: (e) => { setStep(null); setError(messageOf(e, i18n._({ id: "Could not apply the changes. Check that the engine is running, then try again.", message: "Could not apply the changes. Check that the engine is running, then try again." }))); refresh(); void settings.refetch(); },
  });

  if (query.isLoading) return <RouteSkeleton label={i18n._({ id: "Loading your AI setup", message: "Loading your AI setup" })} />;
  if (query.isError || !data) return <section><Alert variant="destructive"><AlertTitle>{i18n._({ id: "The page did not load", message: "The page did not load" })}</AlertTitle><AlertDescription>{messageOf(query.error, i18n._({ id: "Check that Home is running, then reload this page.", message: "Check that Home is running, then reload this page." }))}</AlertDescription></Alert></section>;

  const totalRam = (hardware.data?.totalRamGb ?? 0) * GB;
  const installed = data.installed_bytes;
  const freeDisk = data.free_disk_bytes ?? hardware.data?.freeDiskBytes ?? null;
  // What the computer reports as not free, less Home's own models: an estimate, shown only when the hub could read it.
  const alwaysBytes = Math.min(projection.alwaysNow, projection.alwaysAfter);
  const whenUsedBytes = Math.max(0, Math.min(projection.ramNow, projection.ramAfter) - alwaysBytes);
  const otherApps = totalRam > 0 && data.memory_available_bytes != null ? Math.max(0, totalRam - data.memory_available_bytes - projection.ramNow) : 0;
  const memorySegments = [
    { id: "home", label: i18n._({ id: "Always loaded", message: "Always loaded" }), bytes: alwaysBytes, hue: "--hue-violet" },
    ...(whenUsedBytes > 0 ? [{ id: "when-used", label: i18n._({ id: "Loads when used", message: "Loads when used" }), bytes: whenUsedBytes, hue: "--hue-blue" }] : []),
    ...(otherApps > 0 ? [{ id: "other", label: i18n._({ id: "Other apps", message: "Other apps" }), bytes: otherApps, hue: "--hue-teal" }] : []),
    ...(projection.ramAfter > projection.ramNow ? [{ id: "pending", label: copy.staged_label ?? i18n._({ id: "Staged", message: "Staged" }), bytes: projection.ramAfter - projection.ramNow, hue: "--hue-orange" }] : []),
  ];
  const storageSegments = [
    { id: "models", label: i18n._({ id: "Models", message: "Models" }), bytes: installed, hue: "--hue-violet" },
    ...(projection.downloadBytes > 0 ? [{ id: "pending", label: copy.staged_label ?? i18n._({ id: "Staged", message: "Staged" }), bytes: projection.downloadBytes, hue: "--hue-orange" }] : []),
  ];
  const storageCapacity = freeDisk !== null ? installed + freeDisk : null;
  const device = hardware.data?.computerName ?? i18n._({ id: "this computer", message: "this computer" });

  return (
    <section aria-label={copy.title} className="flex flex-col gap-4" data-testid="ai-glance">
      <InstallStrip detailsHref={null} />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-base text-muted-foreground">{copy.subtitle}</p>
        </div>
        {missing.length > 0 ? <Button type="button" disabled={download.isPending || data.stack === "unreachable"} onClick={() => download.mutate(missing)}>{fill(copy.download_missing ?? "", { count: missing.length })}</Button> : null}
      </header>
      {data.stack === "unreachable" ? <p className="text-sm text-muted-foreground">{i18n._({ id: "The AI is waiting for its helper to start. The Status page shows what is happening.", message: "The AI is waiting for its helper to start. The Status page shows what is happening." })}</p> : null}
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

      {maxWindow.data && (maxWindow.data.open || maxWindow.data.profile || (maxWindow.data.closed_apps?.length ?? 0) > 0) ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-base" role="status" data-testid="max-window-line">
          <div className="space-y-1">
            {maxWindow.data.open ? <p>{maxWindow.data.line}{maxWindow.data.minutes_left !== null ? ` ${i18n._({ id: "About {count, plural, one {# minute} other {# minutes}} left.", message: "About {count, plural, one {# minute} other {# minutes}} left.", values: { count: maxWindow.data.minutes_left } })}` : ""}</p> : null}
            {maxWindow.data.profile ? <p data-testid="profile-line">{maxWindow.data.profile}</p> : null}
            {(maxWindow.data.closed_apps ?? []).map((line) => <p key={line} className="text-muted-foreground" data-testid="closed-apps-line">{line}</p>)}
          </div>
          {maxWindow.data.open ? <Button type="button" variant="outline" disabled={stopWindow.isPending} onClick={() => stopWindow.mutate()}>{i18n._({ id: "Stop the Max job", message: "Stop the Max job" })}</Button> : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{copy.glance}</h2>
        <p className="text-base text-muted-foreground" data-testid="ai-counter">{fill(copy.counter ?? "", tally)}</p>
      </div>
      <ItemGroup variant="card" role="group" aria-label={copy.glance}>
        {rows.map((row) => glanceRow({ row, copy, onSwitch: (on) => stage(row, on ? (row.shown?.id ?? row.recommended?.id ?? OFF) : OFF), onEdit: () => { if (TIERED_JOBS[row.job]) { setLevelsError(null); setLevelTier(null); setLevels(row); } else setEditing(row); }, onReset: () => setResetting(row), onDownload: () => download.mutate([row]) }))}
      </ItemGroup>

      <p className="text-base text-muted-foreground">
        {fill(copy.checked ?? "", { when: whenText(query.dataUpdatedAt) })} · {device}{" "}
        <Link to="/settings/ai?tab=engines" className="inline-flex min-h-12 items-center underline">{copy.view_device}</Link>
      </p>

      <Dialog open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent scroll="viewport">{editing ? <AiModelChoices key={editing.job} row={editing} copy={copy} onClose={() => setEditing(null)} onSave={stage} onAdded={refresh} /> : null}</DialogContent>
      </Dialog>
      <Dialog open={levels !== null} onOpenChange={(open) => { if (!open) { setLevels(null); setLevelTier(null); } }}>
        <DialogContent scroll="viewport">{levels && levelTier === null ? <AiJobSummary key={`${levels.job}-summary`} row={levels} drafts={slotDrafts(levels)} picks={tierPicks.data ?? null} copy={copy} onClose={() => setLevels(null)} onEdit={(tier) => { if (tier === "standard") { setLevels(null); setEditing(levels); } else setLevelTier(tier); }} /> : null}{levels && levelTier !== null ? <AiSlotChoices key={`${levels.job}-${levelTier}`} only={levelTier} row={levels} initial={slotDrafts(levels)} picks={tierPicks.data ?? null} copy={copy} saving={saveLevels.isPending} error={levelsError} onClose={() => setLevelTier(null)} onSave={(drafts) => saveLevels.mutate({ row: levels, drafts })} /> : null}</DialogContent>
      </Dialog>
      <StagedApplyBar testId="ai-action-bar" stagedTestId="ai-staged" notices={error ? <Alert variant="destructive"><AlertTitle>{i18n._({ id: "That did not work", message: "That did not work" })}</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null} staged={stagedCount > 0} title={fill(copy.staged ?? "", { count: stagedCount })} step={step} applying={apply.isPending} applyLabel={copy.apply ?? i18n._({ id: "Apply", message: "Apply" })} discardLabel={copy.discard ?? i18n._({ id: "Discard", message: "Discard" })} onApply={() => apply.mutate()} onDiscard={() => setStaged({})} />
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
function glanceRow({ row, copy, onSwitch, onEdit, onReset, onDownload }: { row: GlanceRow; copy: Record<string, string>; onSwitch: (on: boolean) => void; onEdit: () => void; onReset: () => void; onDownload: () => void }) {
  const Icon = getIcon(JOB_ICONS[row.job]);
  const Reset = getIcon("rotate-ccw");
  const Gear = getIcon("settings");
  const Down = getIcon("download");
  const model = row.shown;
  // What the engine is doing for this row right now: a download or install in flight (any of its models), or the chosen model's failure.
  const busy = row.options.find((option) => option.state === "installing") ?? null;
  const installingText = busy ? (copy.installing ? fill(copy.installing, { name: busy.label }) : i18n._({ id: "Downloading and installing {name}", message: "Downloading and installing {name}", values: { name: busy.label } })) : "";
  const progress = busy ? { text: busy.percent !== null ? i18n._({ id: "{text}: {percent}%", message: "{text}: {percent}%", values: { text: installingText, percent: Math.round(busy.percent) } }) : installingText, percent: busy.percent } : null;
  const failed = !busy && model?.state === "failed" ? model : null;
  const line = !row.offered ? (copy.not_offered ?? "") : model?.description ?? row.summary;
  return (
    <Item key={row.job} data-testid={`ai-row-${row.job}`} data-missing={row.missing ? "true" : undefined}>
      <ItemMedia variant="icon"><Icon /></ItemMedia>
      <ItemContent>
        <ItemTitle>
          {row.title}
          {row.offered ? <Badge tone={row.badge === "recommended" ? "success" : undefined} variant={row.badge === "disabled" ? "secondary" : "default"}>{copy[row.badge]}</Badge> : null}
          {row.offered && row.shown?.id === "chat.uncensored" ? <Badge variant="outline" tone="warning">{i18n._({ id: "Uncensored", message: "Uncensored" })}</Badge> : null}
        </ItemTitle>
        <ItemDescription clamp={false}>{model && row.offered ? `${model.label}. ` : ""}{line}</ItemDescription>
        {model && row.offered ? <ItemDescription clamp={false}>{model.details.map((part) => part.name).join(", ")}</ItemDescription> : null}
        {row.job === "wakeword" && row.offered ? <ItemDescription clamp={false}>{copy.wakeword_note}</ItemDescription> : null}
        {progress && busy ? <JobProgress presentation="card" {...downloadProgress({ title: busy.label, state: "running", status: progress.text, percent: progress.percent ?? undefined })} variant="full" /> : null}
        {failed ? <StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={failed.failure ?? failed.stateText} /> : null}
      </ItemContent>
      <ItemActions>
        {model && row.offered && row.shownEnabled ? <span className="text-base text-muted-foreground">{sizeGb(model.installedBytes)} · {fill(copy.ram_estimate ?? "", { size: sizeGb(model.ramBytes) })}</span> : null}
        {row.badge === "custom" && row.recommended ? <Button type="button" variant="ghost" size="icon-sm" aria-label={`${copy.reset_confirm}: ${row.title}`} onClick={onReset}><Reset /></Button> : null}
        {row.missing ? <Button type="button" variant="ghost" size="icon-sm" aria-label={`${copy.download_missing?.replace(" ({count})", "")}: ${row.title}`} onClick={onDownload}><Down /></Button> : null}
        <Switch checked={row.shownEnabled} disabled={!row.offered} onCheckedChange={onSwitch} aria-label={`${row.title}: ${row.shownEnabled ? copy.on : copy.off}`} />
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`${copy.dialog_title}: ${row.title}`} disabled={!row.offered} onClick={onEdit}><Gear /></Button>
      </ItemActions>
    </Item>
  );
}
