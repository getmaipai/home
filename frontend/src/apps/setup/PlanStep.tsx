import { useEffect, useState } from "react";
import { getIcon } from "@maipai/ui/src/icons";
import { Alert, AlertDescription } from "@maipai/ui/src/ui/alert";
import { Button } from "@maipai/ui/src/ui/button";
import { Card, CardContent } from "@maipai/ui/src/dashboard/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@maipai/ui/src/dashboard/components/ui/radio-group";
import { Field, FieldContent, FieldLabel } from "@maipai/ui/src/dashboard/components/ui/field";
import { api, ApiError, type InstallStatusView, type PlanWording } from "@/lib/api";

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
  readPlan?: (vramGb?: number) => Promise<{ wording: PlanWording }>;
  start?: (vramGb?: number) => Promise<unknown>;
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
  const [wording, setWording] = useState<PlanWording | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [engine, setEngine] = useState<InstallStatusView | null>(null);

  useEffect(() => {
    let active = true;
    setFailed(false);
    readPlan(vram).then((result) => { if (active) setWording(result.wording); }).catch(() => { if (active) setFailed(true); });
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
  const canRecheck = !!wording && !wording.needsMemoryAnswer && (wording.level === "unknown" || !!wording.diskLine);
  const canInstall = !!wording && (wording.level === "recommended" || wording.level === "moderate" || wording.level === "minimal") && !wording.diskLine;
  // Continue stays blocked while the plan is still being read and while the
  // Install button is the way forward; it opens only when Home cannot
  // install from here (engine unreachable, below minimal, disk short), so
  // the person is never able to step past a working install by accident.
  const loading = !failed && wording === null;
  const blockContinue = loading || canInstall;
  useEffect(() => { onReady?.(blockContinue); }, [blockContinue, onReady]);

  async function install() {
    setBusy(true); setError(null);
    try { await start(vram); onInstalled(); }
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
        {wording.sizeLine ? <p>{wording.sizeLine}</p> : null}
        {wording.diskLine ? <Alert variant="destructive"><ErrorIcon /><AlertDescription>{wording.diskLine}</AlertDescription></Alert> : null}
        {error ? <Alert variant="destructive"><ErrorIcon /><AlertDescription>{error}</AlertDescription></Alert> : null}
        {canRecheck ? <Button type="button" variant="secondary" onClick={() => { setWording(null); setAttempt((n) => n + 1); }}>Check again</Button> : null}
        {canInstall ? <Button type="button" size="lg" disabled={busy} onClick={() => void install()}>{actionLabel}</Button> : null}
        </div>
      </CardContent>
    </Card>
    </>
  );
}
