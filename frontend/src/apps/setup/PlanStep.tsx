import { useEffect, useMemo, useState } from "react";
import { getIcon } from "@maipai/ui/src/icons";
import { Alert, AlertDescription } from "@maipai/ui/src/ui/alert";
import { Button } from "@maipai/ui/src/ui/button";
import { Card, CardContent } from "@maipai/ui/src/dashboard/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@maipai/ui/src/dashboard/components/ui/radio-group";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@maipai/ui/src/dashboard/components/ui/field";
import { Switch } from "@maipai/ui/src/ui/switch";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import { api, ApiError, type InstallStatusView, type PlanRead } from "@/lib/api";
import { Checkbox } from "@maipai/ui/src/ui/checkbox";
import type { PlanLicence } from "../../../../shared/licensedRows";
import { sizeGb } from "../../../../shared/diskPlanMath";
import { JOB_ICONS } from "@/apps/settings/aiGlanceRows";
import { liveVerdict, PlanDiskSummary } from "./PlanDiskSummary";
import { defaultPicks, selectedRows, settingsFor, setupJobs, type Picks, type SetupJob } from "./planChoices";

/** Total graphics memory choices when Home cannot read it (GB). */
const ErrorIcon = getIcon("circle-alert");

export const VRAM_CHOICES = [8, 12, 16, 24, 32, 48, 64, 96, 128] as const;

export interface PlanStepProps {
  /** Called once the install has started; the wizard then moves on. */
  onInstalled: () => void;
  /** Reports whether the wizard's own Continue should be blocked: true while
   * the plan loads and while Install is available, false once Home cannot
   * install from this screen and the person may go on without it. */
  onReady?: (ready: boolean) => void;
  /** Wizard uses the setup routes; Home settings uses the signed-in ones. */
  readPlan?: (vramGb?: number) => Promise<PlanRead>;
  start?: (vramGb?: number, components?: string[], acceptedLicences?: string[], settings?: Record<string, string | boolean>) => Promise<unknown>;
  /** What the AI engine install is doing; the plan waits on it when this computer is installing the engine. */
  readInstall?: () => Promise<InstallStatusView>;
  /** Try the AI engine install again after it failed. */
  retryEngine?: () => Promise<unknown>;
  actionLabel?: string;
}

/** Page B: say what this computer can run, ask for graphics memory only when
 * it cannot be read, then start the downloads and go on at once. */
export function PlanStep({ onInstalled, onReady, readPlan = api.setupPlan, start = api.setupInstall, readInstall = api.setupInstallStatus, retryEngine = api.setupEngineInstall, actionLabel = "Install and continue" }: PlanStepProps) {
  const [vram, setVram] = useState<number | undefined>();
  const [read, setRead] = useState<PlanRead | null>(null);
  const wording = read?.wording ?? null;
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The answer to the click, said right under the button (the progress bar is at the top of the page, out of sight from here).
  const [notice, setNotice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [engine, setEngine] = useState<InstallStatusView | null>(null);
  // One pick per job card (AIMODELS-SETUP-01): starts at the plan's defaults; the rows to install, the total and the disk check follow it.
  const [picks, setPicks] = useState<Picks>({});
  // MEM-SPACE-05: jobs no tier can ever run on this computer stay off and download nothing.
  const [cannotRun, setCannotRun] = useState<ReadonlySet<string>>(new Set());
  // Licensed rows (Detailed video): the notice is shown plainly and the install waits for the accept; unticking the row drops the need.
  const [licences, setLicences] = useState<PlanLicence[]>([]);
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let active = true;
    setFailed(false);
    readPlan(vram).then((result) => { if (active) { setRead(result); setLicences(result.licences ?? []); const plan = result.wording.disk?.plan; const no = new Set(result.cannot_run ?? []); setCannotRun(no); const base = plan && result.choices ? defaultPicks(setupJobs(result.choices.cards, plan), plan) : {}; setPicks(Object.fromEntries(Object.entries(base).map(([job, pick]) => [job, no.has(job) ? { ...pick, on: false } : pick]))); } }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [vram, attempt, readPlan]);

  // While the plan cannot be read, ask whether it is because the engine is
  // still being installed here. If so, say so and look again on its own.
  useEffect(() => {
    if (!failed) { setEngine(null); return; }
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const look = async () => {
      try {
        const status = await readInstall();
        if (!active) return;
        setEngine(status);
        if (status.state === "installing_engine") timer = setTimeout(() => { if (active) setAttempt((n) => n + 1); }, 4_000);
      } catch { /* The plain "couldn't reach" message below still applies. */ }
    };
    void look();
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [failed, attempt, readInstall]);

  // "Check again" belongs wherever the answer can change without the person
  // choosing anything: the engine was not answering, or the disk was short
  // and they have since freed space. Memory questions re-read on their own.
  const disk = wording?.disk ?? null;
  const jobs = useMemo(() => (disk && read?.choices ? setupJobs(read.choices.cards, disk.plan) : []), [disk, read]);
  const selected = useMemo<ReadonlySet<string>>(() => (disk ? (jobs.length > 0 ? selectedRows(jobs, disk.plan, picks) : new Set(disk.plan.default_selected)) : new Set()), [disk, jobs, picks]);
  // With a disk plan, the check follows the person's choice: turning off an extra can make a red check pass.
  const verdict = disk ? liveVerdict(disk, selected) : null;
  const diskShort = disk ? verdict!.state === "red" : !!wording?.diskLine;
  const canRecheck = !!wording && !wording.needsMemoryAnswer && (wording.level === "unknown" || diskShort || verdict?.state === "amber");
  const owed = licences.filter((licence) => selected.has(licence.row_id) && !licence.accepted_at && !licence.covered);
  // Covered by the wizard's acknowledgement (LICENCE-ACK-01): shown as information, never a gate.
  const known = licences.filter((licence) => selected.has(licence.row_id) && (licence.accepted_at || licence.covered));
  const unaccepted = owed.some((licence) => !accepted.has(licence.id));
  const canInstall = !!wording && (wording.level === "recommended" || wording.level === "moderate" || wording.level === "minimal") && !diskShort;
  // Continue stays blocked while the plan is still being read and while the
  // Install button is the way forward; it opens only when Home cannot
  // install from here (engine unreachable, below minimal, disk short), so
  // the person is never able to step past a working install by accident.
  const loading = !failed && wording === null;
  const blockContinue = loading || canInstall;
  useEffect(() => { onReady?.(blockContinue); }, [blockContinue, onReady]);

  async function install() {
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await (disk ? start(vram, [...selected], owed.map((licence) => licence.id), settingsFor(jobs, picks)) : start(vram));
      const models = typeof result === "object" && result !== null && "models" in result && typeof result.models === "number" ? result.models : null;
      setNotice(models === 0 ? "Nothing to download: everything you ticked is already installed." : "Download started. Watch it in the bar at the top of this page; you can keep using Home while it finishes.");
      onInstalled();
    }
    catch (reason) {
      const next = reason instanceof ApiError ? reason.next : undefined;
      setError(reason instanceof Error ? [reason.message, next].filter(Boolean).join(" ") : "Home couldn't start the download. Press Install again.");
    } finally { setBusy(false); }
  }

  if (failed && engine?.state === "installing_engine") return <><Card><CardContent><p>Home is setting up the AI engine on this computer. Now: {engine.stageLabel ?? "starting"}. This page continues by itself when it is ready.</p></CardContent></Card></>;
  if (failed && engine?.state === "engine_failed") return <><Card><CardContent><Alert variant="destructive"><ErrorIcon /><AlertDescription>{engine.problem ?? "Setting up the AI engine stopped."}</AlertDescription></Alert><Button type="button" variant="secondary" onClick={() => { void retryEngine().catch(() => {}).then(() => setAttempt((n) => n + 1)); }}>Try again</Button></CardContent></Card></>;
  if (failed) return <><Card><CardContent><Alert variant="destructive"><ErrorIcon /><AlertDescription>Home couldn't reach the AI engine to build a plan. Wait a minute, then press Check again.</AlertDescription></Alert><Button type="button" variant="secondary" onClick={() => setAttempt((n) => n + 1)}>Check again</Button></CardContent></Card></>;
  if (!wording) return <><Card><CardContent><p>Looking at this computer…</p></CardContent></Card></>;

  return (
    <>
    <Card>
      <CardContent><div className="flex flex-col gap-3">
        <h3 className="text-lg font-semibold">{wording.headline}</h3>
        <p className="text-muted-foreground">{wording.detail}</p>
        {wording.needsMemoryAnswer ? (
          <RadioGroup value={vram ? String(vram) : ""} onValueChange={(value) => setVram(Number(value))} aria-label="Total graphics memory">
            {VRAM_CHOICES.map((gb) => (
              <Field key={gb} orientation="horizontal"><RadioGroupItem value={String(gb)} id={`vram-${gb}`} /><FieldContent><FieldLabel htmlFor={`vram-${gb}`}>{gb} GB</FieldLabel></FieldContent></Field>
            ))}
          </RadioGroup>
        ) : null}
        {wording.gets.length ? <ul className="list-disc space-y-1 pl-5">{wording.gets.map((line) => <li key={line}>{line}</li>)}</ul> : null}
        {disk ? <>
          {jobs.length > 0 ? <ItemGroup variant="card" role="group" aria-label="What gets installed">{jobs.map((job) => jobItem(job, picks, (pick) => setPicks((current) => ({ ...current, [job.job]: pick })), disk.source === "stack", cannotRun.has(job.job) && !job.required))}</ItemGroup> : null}
          <PlanDiskSummary disk={disk} selected={selected} />
        </> : (
          <>
            {wording.sizeLine ? <p>{wording.sizeLine}</p> : null}
            {wording.diskLine ? <Alert variant="destructive"><ErrorIcon /><AlertDescription>{wording.diskLine}</AlertDescription></Alert> : null}
          </>
        )}
        {owed.map((licence) => (
          <Alert key={licence.id} data-testid="plan-licence">
            <AlertDescription>
              <span className="block font-medium">Before it downloads: the maker's licence ({licence.name})</span>
              <ul className="list-disc space-y-1 pl-5">{licence.summary.map((line) => <li key={line}>{line}</li>)}</ul>
              <span className="block break-all">The full licence: {licence.url}</span>
              <Field orientation="horizontal"><Checkbox id={`licence-${licence.id}`} checked={accepted.has(licence.id)} onCheckedChange={(value) => setAccepted((current) => { const next = new Set(current); if (value === true) next.add(licence.id); else next.delete(licence.id); return next; })} /><FieldContent><FieldLabel htmlFor={`licence-${licence.id}`}>I have read it and I accept it</FieldLabel></FieldContent></Field>
              <span className="block text-muted-foreground">Not for you? Choose Quick videos, or turn Videos off, above and nothing of it downloads.</span>
            </AlertDescription>
          </Alert>
        ))}
        {known.map((licence) => (
          <p key={licence.id} className="text-muted-foreground" data-testid="plan-licence-info">{licence.name} comes with this part. You accepted its licence at the start; the terms are in Models and storage.</p>
        ))}
        {error ? <Alert variant="destructive"><ErrorIcon /><AlertDescription>{error}</AlertDescription></Alert> : null}
        {canRecheck ? <Button type="button" variant="secondary" onClick={() => { setRead(null); setAttempt((n) => n + 1); }}>Check again</Button> : null}
        {canInstall ? <Button type="button" size="lg" disabled={busy || unaccepted} onClick={() => void install()}>{actionLabel}</Button> : null}
        {canInstall && unaccepted ? <p className="text-muted-foreground" data-testid="plan-accept-hint">The button is waiting for you to accept the maker's licence above. Accept it, or untick that row, to go on.</p> : null}
        {notice ? <p role="status">{notice}</p> : null}
        </div>
      </CardContent>
    </Card>
    </>
  );
}

/** One job, drawn by a plain function so no Home component has a kit Item as its root (rule 9). */
function jobItem(job: SetupJob, picks: Picks, onPick: (pick: { on: boolean; choiceId: string }) => void, missingOnly: boolean, cannot: boolean) {
  const Icon = getIcon(JOB_ICONS[job.job]);
  const pick = picks[job.job];
  const chosen = job.options.find((option) => option.id === pick?.choiceId) ?? job.options[0]!;
  const on = pick?.on ?? false;
  const size = (option: SetupJob["options"][number]) => (missingOnly && option.state === "installed" ? "Installed" : sizeGb(option.installedBytes));
  return (
    <Item key={job.job} data-testid={`plan-job-${job.job}`}>
      <ItemMedia variant="icon"><Icon /></ItemMedia>
      <ItemContent>
        <ItemTitle>{job.title}</ItemTitle>
        <ItemDescription clamp={false}>{cannot ? "This computer can't run this, so nothing is downloaded for it." : on ? `${chosen.label}. ${chosen.description}` : job.summary}</ItemDescription>
        {job.options.length > 1 && on ? (
          <RadioGroup value={chosen.id} onValueChange={(value) => onPick({ on: true, choiceId: value })} aria-label={`${job.title}: which one`}>
            {job.options.map((option) => (
              <Field key={option.id} orientation="horizontal"><RadioGroupItem value={option.id} id={`choice-${option.id}`} disabled={option.blockedReason !== null && option.state !== "installed"} /><FieldContent><FieldLabel htmlFor={`choice-${option.id}`}>{option.label}</FieldLabel><FieldDescription>{option.blockedReason ?? `${option.description} ${size(option)}.`}</FieldDescription></FieldContent></Field>
            ))}
          </RadioGroup>
        ) : null}
      </ItemContent>
      <ItemActions>
        {on ? <span className="text-base text-muted-foreground">{size(chosen)}</span> : null}
        <Switch checked={on} disabled={job.required || cannot} onCheckedChange={(next) => onPick({ on: next, choiceId: chosen.id })} aria-label={`${job.title}: ${on ? "on" : "off"}`} />
      </ItemActions>
    </Item>
  );
}
