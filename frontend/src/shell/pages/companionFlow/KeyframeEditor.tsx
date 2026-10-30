import { useEffect, useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@maipai/ui/src/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogSection, DialogTitle } from "@maipai/ui/src/ui/dialog";
import { Input } from "@maipai/ui/src/ui/input";
import { Textarea } from "@maipai/ui/src/ui/textarea";
import { getIcon } from "@maipai/ui/src/icons";
import { api, type CompanionLookJob, type CompanionStateRow } from "@/lib/api";
import { companionStatesKey } from "@/shell/pages/useCompanionStates";
import { flowErrorText } from "@/shell/pages/companionFlow/errors";
import { DEFAULT_FRAME, PreviewControls, type PictureFrame } from "@/shell/pages/companionFlow/PreviewControls";
import { useMakingAvailability } from "@/apps/chat/useMakingAvailability";

const running = (job: CompanionLookJob | undefined, jobId: string | null) => jobId !== null && (job === undefined || job.state === "queued" || job.state === "running");

/** Edit keyframe: the three actions of screen 1 (describe a change, upload a replacement, zoom and position or remove the background) on one animation's still. */
export function KeyframeEditor({ companionId, row, open, onOpenChange }: {
  companionId: string; row: CompanionStateRow; open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const client = useQueryClient();
  const making = useMakingAvailability("image");
  const reasonId = useId();
  const [instruction, setInstruction] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [frame, setFrame] = useState<PictureFrame>(DEFAULT_FRAME);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const Sparkles = getIcon("sparkles");
  const jobQuery = useQuery<CompanionLookJob>({
    queryKey: [...companionStatesKey(companionId), "keyframe-job", jobId], queryFn: () => api.companionLookJob(companionId, jobId!), enabled: jobId !== null, retry: false,
    refetchInterval: (q) => document.hidden ? false : running(q.state.data, jobId) ? 1500 : false,
  });
  const job = jobQuery.data;
  const working = running(job, jobId) || busy;
  const refresh = () => client.invalidateQueries({ queryKey: companionStatesKey(companionId) });
  useEffect(() => {
    if (!job || !jobId) return;
    if (job.state === "done") { setJobId(null); setInstruction(""); setFrame(DEFAULT_FRAME); void refresh(); }
    else if (job.state === "failed") { setError(job.error ?? "The picture could not be made. Change the description and try again."); setJobId(null); void refresh(); }
    else if (job.state === "cancelled") setJobId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job, jobId]);

  async function attempt(action: () => Promise<void>) {
    setError(""); setBusy(true);
    try { await action(); } catch (e) { setError(flowErrorText(e)); } finally { setBusy(false); }
  }
  const make = () => attempt(async () => setJobId((await api.generateCompanionKeyframe(companionId, row.id)).job));
  const change = () => attempt(async () => setJobId((await api.editCompanionKeyframe(companionId, row.id, instruction.trim())).job));
  const replace = () => attempt(async () => {
    const body = new FormData(); body.append("image", file!);
    await api.uploadCompanionKeyframe(companionId, row.id, body); setFile(null); setFrame(DEFAULT_FRAME); await refresh();
  });
  // The background is always removed; only the placement changes.
  const prepare = (nextFrame: PictureFrame) => {
    const before = frame;
    setFrame(nextFrame);
    if (nextFrame.zoom === 1 && nextFrame.x === DEFAULT_FRAME.x && nextFrame.y === DEFAULT_FRAME.y) return Promise.resolve();
    return attempt(async () => {
      try {
        await api.prepareCompanionKeyframe(companionId, row.id, { remove_background: true, frame: nextFrame });
        await refresh();
      } catch (e) { setFrame(before); throw e; }
    });
  };
  const keyframe = row.keyframe;
  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent scroll="viewport">
        <DialogHeader>
          <DialogTitle>{`Edit keyframe: ${row.label}`}</DialogTitle>
          <DialogDescription>The still picture this animation starts from. Changing it marks the animation out of date.</DialogDescription>
        </DialogHeader>
        {keyframe
          ? <img src={`${keyframe.url}${keyframe.edited_at ? `?v=${encodeURIComponent(keyframe.edited_at)}` : ""}`} alt={`${row.label} keyframe`} draggable={false} className="aspect-square w-full rounded-2xl bg-muted object-contain" />
          : <p className="text-sm text-muted-foreground">This animation has no picture yet. Make one to start from.</p>}
        {working ? <p className="text-sm text-muted-foreground">{job?.label ?? "Working on the picture"}</p> : null}
        {making.reason ? <p id={reasonId} role="status" className="text-sm text-muted-foreground">{making.reason}</p> : null}
        {keyframe ? <>
          <DialogSection title="Describe a change">
            <Textarea aria-label="Describe a change" shape="rounded" placeholder="For example, make the smile bigger" maxLength={500} value={instruction} disabled={working} onChange={(e) => setInstruction(e.target.value)} />
            <Button shape="pill" disabled={working || making.disabled || instruction.trim().length === 0} aria-describedby={making.reason ? reasonId : undefined} title={making.reason ?? undefined} onClick={() => void change()}><Sparkles aria-hidden="true" />Change picture</Button>
          </DialogSection>
          <DialogSection title="Upload a replacement">
            <Input aria-label="Replacement picture" type="file" shape="pill" accept="image/png,image/jpeg,image/webp" disabled={working} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <Button variant="outline" shape="pill" disabled={working || file === null} onClick={() => void replace()}>Use this picture</Button>
          </DialogSection>
          <PreviewControls idPrefix="keyframe" position frame={frame} disabled={working}
            onFrameChange={setFrame} onFrameCommit={(next) => void prepare(next)} />
        </> : <Button shape="pill" disabled={working || making.disabled} aria-describedby={making.reason ? reasonId : undefined} title={making.reason ?? undefined} onClick={() => void make()}><Sparkles aria-hidden="true" />Make picture</Button>}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" shape="pill" onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
