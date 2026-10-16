import { useEffect, useState } from "react";
import { Button } from "@maipai/ui/src/ui/button";
import { Card, CardContent } from "@maipai/ui/src/dashboard/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@maipai/ui/src/dashboard/components/ui/radio-group";
import { Field, FieldContent, FieldLabel } from "@maipai/ui/src/dashboard/components/ui/field";
import { api, ApiError, type PlanWording } from "@/lib/api";

/** Total graphics memory choices when Home cannot read it (GB). */
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
  actionLabel?: string;
}

/** Page B: say what this computer can run, ask for graphics memory only when
 * it cannot be read, then start the downloads and go on at once. */
export function PlanStep({ onInstalled, onReady, readPlan = api.setupPlan, start = api.setupInstall, actionLabel = "Install and continue" }: PlanStepProps) {
  const [vram, setVram] = useState<number | undefined>();
  const [wording, setWording] = useState<PlanWording | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setFailed(false);
    readPlan(vram).then((result) => { if (active) setWording(result.wording); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [vram, attempt, readPlan]);

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
      setError(reason instanceof ApiError || reason instanceof Error ? reason.message : "Home couldn't start the download. Press Install again.");
    } finally { setBusy(false); }
  }

  if (failed) return <><Card><CardContent><p role="alert">Home couldn't reach the AI engine to build a plan. Wait a minute, then press Check again.</p><Button type="button" variant="secondary" onClick={() => setAttempt((n) => n + 1)}>Check again</Button></CardContent></Card></>;
  if (!wording) return <><Card><CardContent><p>Looking at this computer…</p></CardContent></Card></>;

  return (
    <>
    <Card>
      <CardContent>
        <h3 className="text-lg font-semibold">{wording.headline}</h3>
        <p className="text-muted-foreground">{wording.detail}</p>
        {wording.needsMemoryAnswer ? (
          <RadioGroup value={vram ? String(vram) : ""} onValueChange={(value) => setVram(Number(value))} aria-label="Total graphics memory">
            {VRAM_CHOICES.map((gb) => (
              <Field key={gb} orientation="horizontal"><RadioGroupItem value={String(gb)} id={`vram-${gb}`} /><FieldContent><FieldLabel htmlFor={`vram-${gb}`}>{gb} GB</FieldLabel></FieldContent></Field>
            ))}
          </RadioGroup>
        ) : null}
        {wording.gets.length ? <ul className="list-disc pl-5">{wording.gets.map((line) => <li key={line}>{line}</li>)}</ul> : null}
        {wording.sizeLine ? <p>{wording.sizeLine}</p> : null}
        {wording.diskLine ? <p role="alert">{wording.diskLine}</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        {canInstall ? <Button type="button" size="lg" disabled={busy} onClick={() => void install()}>{actionLabel}</Button> : null}
      </CardContent>
    </Card>
    </>
  );
}
