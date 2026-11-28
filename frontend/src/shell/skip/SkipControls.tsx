import { useEffect, useState } from "react";
import { i18n } from "@lingui/core";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import type { SkipPlan, SkipRange } from "./skipPlan";
import { formatTimeSaved } from "./skipPlan";

const kindStyle: Record<string, string> = { ad: "bg-warning", sponsor: "bg-destructive", bumper: "bg-info", selfpromo: "bg-secondary", intro: "bg-primary", outro: "bg-accent", recap: "bg-muted-foreground" };
const kindLabel = (kind: string) => ({ ad: "Ad", sponsor: "Sponsor", bumper: "Bumper", selfpromo: "Self-promotion", intro: "Intro", outro: "Outro", recap: "Recap" }[kind] ?? kind);

export function SkipRanges({ plan, duration, onSeek }: { plan: SkipPlan | null; duration: number; onSeek: (position: number) => void }) {
  if (!plan || plan.state !== "ready" || !duration) return null;
  return <div aria-label={i18n._({ id: "Skip ranges", message: "Skip ranges" })} className="flex h-2 w-full overflow-hidden rounded-full" data-testid="skip-ranges">
    {plan.ranges.map((range, index) => <button key={`${range.startSec}-${index}`} type="button" aria-label={i18n._({ id: "{kind} from {start} to {end}", message: "{kind} from {start} to {end}", values: { kind: kindLabel(range.kind), start: Math.round(range.startSec), end: Math.round(range.endSec) } })} title={kindLabel(range.kind)} data-status={range.status ?? "auto"} data-mode={range.mode ?? plan.modes?.[range.kind] ?? "skip"} className={`h-full min-w-1 ${kindStyle[range.kind] ?? "bg-muted"}`} style={{ width: `${Math.max(0.5, (range.endSec - range.startSec) / duration * 100)}%` }} onClick={() => onSeek(range.startSec)} />)}
  </div>;
}

export function SkippedPill({ range, onUndo }: { range: SkipRange | null; onUndo: () => void }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => { if (!range) return; setVisible(true); const timer = setTimeout(() => setVisible(false), 7000); return () => clearTimeout(timer); }, [range]);
  if (!range || !visible) return null;
  const mins = Math.max(1, Math.round((range.endSec - range.startSec) / 60));
  return <div role="status" aria-live="polite" className="flex items-center gap-2"><span>{i18n._({ id: "Skipped a break, {saved}", message: "Skipped a break, {saved}", values: { saved: formatTimeSaved(range.endSec - range.startSec) } })}</span><span className="sr-only">{i18n._({ id: "Skipped a {mins} minute break", message: "Skipped a {mins} minute break", values: { mins } })}</span><Button variant="secondary" size="sm" onClick={onUndo}>{i18n._({ id: "Undo", message: "Undo" })}</Button></div>;
}

export function SkipButton({ range, onSkip, onHear }: { range: SkipRange | null; onSkip: () => void; onHear: () => void }) {
  if (!range) return null;
  const label = i18n._({ id: "Skip {kind}", message: "Skip {kind}", values: { kind: kindLabel(range.kind).toLowerCase() } });
  return <span className="inline-flex gap-1"><Button size="sm" onClick={onSkip}>{label}</Button><Button variant="ghost" size="sm" onClick={onHear}>{i18n._({ id: "Hear it anyway", message: "Hear it anyway" })}</Button></span>;
}

export function PlayOriginalButton({ onPlayOriginal }: { onPlayOriginal: () => void }) {
  return <Button variant="ghost" size="sm" onClick={onPlayOriginal}>{i18n._({ id: "Play original", message: "Play original" })}</Button>;
}
