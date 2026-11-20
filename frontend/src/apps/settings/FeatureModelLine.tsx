// One model on a feature row of Settings, AI and models, Features (owner design, 2026-11-17). The name, the size and the state are the
// Stack's, passed in as given (rule E1). Priority shows by style: the first is normal weight with a small Primary tag, the second is
// muted with Secondary; a model that is not ready is muted too, so it is never styled like one that is. One control per state: a missing
// model has only "Install <size>" (the size is the status), a ready one has a green dot and no button, a failed one has "Try again".
import { i18n } from "@lingui/core";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { STATUS_TONE_BG, type StatusTone } from "@maipai/ui/src/ui/status-colors";
import type { AiFeatureModel } from "@/lib/api";
import { sizeGb } from "../../../../shared/diskPlanMath";

export const Dot = ({ tone }: { tone: StatusTone }) => <span aria-hidden="true" className={`inline-block size-2 shrink-0 rounded-full ${STATUS_TONE_BG[tone]}`} />;

/** The words of a model's priority: only the first two of an order carry a tag. */
export const priorityTag = (rank: number): string | null => rank === 1 ? i18n._({ id: "Primary", message: "Primary" }) : rank === 2 ? i18n._({ id: "Secondary", message: "Secondary" }) : null;

export interface FeatureModelLineProps { model: AiFeatureModel; tagged: boolean; busy: boolean; onInstall: (id: string) => void }

export function FeatureModelLine({ model, tagged, busy, onInstall }: FeatureModelLineProps) {
  const ready = model.state === "ready";
  // WAN-DEFAULT-01: the children's video model is not part of the adult order, so it carries who it is for instead of a priority.
  const tag = model.for_minors ? i18n._({ id: "For children and teens", message: "For children and teens" }) : tagged ? priorityTag(model.rank) : null;
  const muted = !ready || model.rank !== 1;
  const bytes = model.download_bytes || model.size_bytes;
  const control = (() => {
    if (model.state === "missing") return <Button type="button" variant="outline" size="sm" disabled={busy || model.install_block !== null} onClick={() => onInstall(model.id)}>{bytes > 0 ? i18n._({ id: "Install {size}", message: "Install {size}", values: { size: sizeGb(bytes) } }) : i18n._({ id: "Install", message: "Install" })}</Button>;
    if (model.state === "failed") return <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onInstall(model.id)}>{i18n._({ id: "Try again", message: "Try again" })}</Button>;
    if (model.state === "installing" || model.state === "updating") return <span className="text-supporting text-muted-foreground">{model.percent !== null ? i18n._({ id: "Installing {percent}%", message: "Installing {percent}%", values: { percent: Math.round(model.percent) } }) : i18n._({ id: "Installing", message: "Installing" })}</span>;
    if (model.state === "unsupported") return <span className="text-supporting text-muted-foreground">{model.install_block ?? i18n._({ id: "Not on this computer", message: "Not on this computer" })}</span>;
    return <Dot tone="ok" />;
  })();
  return <li className="flex items-center justify-between gap-3 py-1.5" data-testid="ai-model-line" data-state={model.state} data-rank={model.rank}>
    <span className={`flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 ${muted ? "text-muted-foreground" : ""}`}>
      <span className="break-words" data-testid="ai-model-name">{model.label}</span>
      {tag ? <Badge variant="secondary">{tag}</Badge> : null}
    </span>
    <span className="flex shrink-0 items-center" data-testid="ai-model-control">{control}</span>
  </li>;
}
