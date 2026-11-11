import { i18n } from "@lingui/core";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@maipai/ui/src/ui/button";
import { CharacterTile } from "@maipai/ui/src/primitives/CharacterTile";
import { DialogSection } from "@maipai/ui/src/ui/dialog";
import { Progress } from "@maipai/ui/src/primitives/Progress";
import { StackedAlphaVideo } from "@maipai/ui/src/elements/stacked-alpha-video";
import { CompanionPackPlayer, type CompanionPackData } from "@maipai/ui/src/elements/companion-pack";
import { StatusCard } from "@maipai/ui/src/elements/status-card";
import { api, ApiError, request, type CompanionPackJob, type CompanionPackStageName } from "@/lib/api";
import { useMakingAvailability } from "@/apps/chat/useMakingAvailability";
import { flowErrorText } from "@/shell/pages/companionFlow/errors";

const stageWord = (name: string | null): string => {
  switch (name as CompanionPackStageName | null) {
    case "source": return i18n._({ id: "Making the picture", message: "Making the picture" });
    case "clips": return i18n._({ id: "Making the clips", message: "Making the clips" });
    case "track": return i18n._({ id: "Tracking the head", message: "Tracking the head" });
    case "shapes": return i18n._({ id: "Making the mouth shapes", message: "Making the mouth shapes" });
    case "emotion": return i18n._({ id: "Making the expressions", message: "Making the expressions" });
    case "assemble": return i18n._({ id: "Putting it together", message: "Putting it together" });
    case "validate": return i18n._({ id: "Checking it", message: "Checking it" });
    case "install": return i18n._({ id: "Installing", message: "Installing" });
    default: return i18n._({ id: "Getting started", message: "Getting started" });
  }
};
const clipWord = (state: string) => state[0]!.toUpperCase() + state.slice(1);
const packKey = (id: string) => ["companions", id, "pack-job"] as const;

/** How far a job is: finished stages out of all of them. Home sends no percent, so this counts the steps. */
export function packPercent(job: CompanionPackJob): number {
  const total = job.stages.length || 8;
  return Math.round((job.stages.filter((s) => s.status === "done").length / total) * 100);
}

/** The Talking character section of the Animate screen: make a talking pack from the approved look, with the owner's two checks along the way. */
export function PackSection({ companionId, stillId, reasonId }: { companionId: string; stillId: string | null; reasonId?: string }) {
  const client = useQueryClient();
  const pictures = useMakingAvailability("image"), clips = useMakingAvailability("video");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(false);
  const query = useQuery<CompanionPackJob | null>({
    queryKey: packKey(companionId), retry: false, staleTime: 0, refetchOnMount: "always",
    queryFn: async () => { try { return await api.companionPackJob(companionId); } catch (e) { if (e instanceof ApiError && e.status === 404) return null; throw e; } },
    refetchInterval: (q) => q.state.data?.status === "running" ? 2000 : false,
  });
  const job = query.data ?? null;
  const previewUrl = job?.status === "waiting_approval" && job.waiting_for === "C" ? job.preview?.pack_json_url ?? null : null;
  const manifest = useQuery({ queryKey: ["pack-preview", previewUrl], queryFn: () => request<Record<string, unknown>>(previewUrl!), enabled: previewUrl !== null, retry: false });
  const apply = (next: CompanionPackJob) => client.setQueryData(packKey(companionId), next);
  const act = async (run: () => Promise<CompanionPackJob>) => {
    setError(""); setBusy(true);
    try { apply(await run()); } catch (e) { setError(flowErrorText(e)); } finally { setBusy(false); }
  };
  const reason = pictures.reason ?? clips.reason;
  const blocked = pictures.disabled || clips.disabled;
  const make = (restart: boolean) => { if (stillId) void act(() => api.startCompanionPackJob(companionId, { still_id: stillId, restart })); };
  const open = started || (job !== null && job.status !== "cancelled");
  const waiting = job?.status === "waiting_approval" ? job.waiting_for : null;
  const percent = job ? packPercent(job) : 0;
  const problem = error || (job?.status === "failed" ? (job.error ?? i18n._({ id: "The talking character could not be made. Try again.", message: "The talking character could not be made. Try again." })) : "");

  return (
    <>
    <DialogSection title={i18n._({ id: "Talking character", message: "Talking character" })}>
      <p className="text-body text-muted-foreground">{i18n._({ id: "Make a character that moves its mouth and face when it talks. It starts from your approved picture, shown above.", message: "Make a character that moves its mouth and face when it talks. It starts from your approved picture, shown above." })}</p>
      <p className="text-body text-muted-foreground">{i18n._({ id: "A talking character is a headshot: the clips show the head to the upper chest, never hands or the body, and your own wording is not used for these clips.", message: "A talking character is a headshot: the clips show the head to the upper chest, never hands or the body, and your own wording is not used for these clips." })}</p>
      {problem ? <StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={problem} /> : null}
      {!open || job === null || job.status === "cancelled" ? (
        <>
          <Button shape="pill" disabled={busy || blocked || !stillId} aria-describedby={reason ? reasonId : undefined} title={reason ?? undefined} onClick={() => { setStarted(true); make(false); }}>{i18n._({ id: "Make a talking character", message: "Make a talking character" })}</Button>
          {!stillId && !reason ? <p className="text-body text-muted-foreground">{i18n._({ id: "Approve a picture on the first screen before making a talking character.", message: "Approve a picture on the first screen before making a talking character." })}</p> : null}
        </>
      ) : job.status === "running" ? (
        <div role="status" className="flex flex-col gap-2">
          <p className="text-body text-foreground">{`${stageWord(job.stage)}... ${percent}%`}</p>
          <Progress mode="determinate" value={percent} label={stageWord(job.stage)} />
          <Button variant="outline" shape="pill" disabled={busy} onClick={() => void act(() => api.cancelCompanionPackJob(companionId))}>{i18n._({ id: "Stop", message: "Stop" })}</Button>
        </div>
      ) : waiting === "B" ? (
        <div className="flex flex-col gap-3">
          <p className="text-body text-foreground">{i18n._({ id: "Here are the short clips it will move with. Do they look right?", message: "Here are the short clips it will move with. Do they look right?" })}</p>
          <div className="grid grid-cols-2 gap-3">
            {(job.clips ?? []).map((clip) => (
              <CharacterTile key={clip.take} variant="animation" name={clipWord(clip.state)} media={<StackedAlphaVideo src={clip.url} loop label={i18n._({ id: "{label} clip", message: "{label} clip", values: { label: clipWord(clip.state) } })} />} onSelect={() => undefined} />
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            <Button shape="pill" disabled={busy} onClick={() => void act(() => api.approveCompanionPackStage(companionId, "B"))}>{i18n._({ id: "Looks good, continue", message: "Looks good, continue" })}</Button>
            <Button variant="outline" shape="pill" disabled={busy || blocked} title={reason ?? undefined} onClick={() => make(true)}>{i18n._({ id: "Make it again", message: "Make it again" })}</Button>
          </div>
        </div>
      ) : waiting === "C" ? (
        <div className="flex flex-col gap-3">
          <p className="text-body text-foreground">{i18n._({ id: "Your talking character is ready. Watch it move, then decide.", message: "Your talking character is ready. Watch it move, then decide." })}</p>
          {job.preview && manifest.data ? <CompanionPackPlayer pack={manifest.data as unknown as CompanionPackData} baseUrl={job.preview.pack_url_base} state="idle" tier="auto" /> : null}
          {manifest.isError ? <p role="status" className="text-body text-muted-foreground">{i18n._({ id: "The finished character could not be shown yet. Wait a moment and reload this page.", message: "The finished character could not be shown yet. Wait a moment and reload this page." })}</p> : null}
          <div className="flex flex-wrap gap-3">
            <Button shape="pill" disabled={busy} onClick={() => void act(() => api.approveCompanionPackStage(companionId, "C"))}>{i18n._({ id: "Use this character", message: "Use this character" })}</Button>
            <Button variant="outline" shape="pill" disabled={busy} onClick={() => void act(() => api.cancelCompanionPackJob(companionId))}>{i18n._({ id: "Not yet", message: "Not yet" })}</Button>
          </div>
        </div>
      ) : job.status === "failed" ? (
        <Button variant="outline" shape="pill" disabled={busy || blocked} title={reason ?? undefined} onClick={() => make(true)}>{i18n._({ id: "Try again", message: "Try again" })}</Button>
      ) : job.status === "done" ? (
        <p role="status" className="text-body text-foreground">{i18n._({ id: "Done. Your talking character is installed and shows in the chat pane.", message: "Done. Your talking character is installed and shows in the chat pane." })}</p>
      ) : null}
    </DialogSection>
    </>
  );
}
