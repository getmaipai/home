import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { JobProgress } from "@maipai/ui/src/elements/job-progress";
import { Progress } from "@maipai/ui/src/primitives/Progress";
import { Button } from "@maipai/ui/src/ui/button";
import { api, ApiError, type InstallStatusView } from "@/lib/api";

// The engine install comes first (fetch, build, start), then the models.
const STAGES = [
  { name: "Fetch", weight: 1 },
  { name: "Build", weight: 3 },
  { name: "Start", weight: 1 },
  { name: "Download", weight: 12 },
] as const;
const ENGINE_STAGE_INDEX: Record<string, number> = { preflight: 0, fetching: 0, building: 1, starting: 2 };

/** The strip's own words for the current install step; Home's ask box reads the same line (one definition). */
export function installTitle(status: Pick<InstallStatusView, "state" | "stageLabel">): string {
  return status.state === "installing_engine" ? (status.stageLabel ?? "Setting up your AI") : status.state === "engine_failed" ? "Setting up your AI stopped" : status.state === "starter_ready" ? "Home can chat now. Better AI is still downloading" : "Downloading your AI";
}

/** One line of install progress: the AI engine installing, then the AI models downloading in the
 * background. It hides itself when nothing is installing or everything
 * has landed. Polls fast while moving, slowly otherwise. */
export function InstallStrip({ detailsHref = "/settings/home/ai", read = api.installStatus, retry = api.installRetry, compact = false }: {
  /** One line (what is installing, percent, a thin bar) for the wizard, instead of the full panel. */
  compact?: boolean;
  /** Where "Details" goes; null hides the link (setup, before anyone can sign in; or the page it points at). */
  detailsHref?: string | null;
  read?: () => Promise<InstallStatusView>;
  /** What the strip's Try again does. Setup before the owner exists restarts the install through the setup route. */
  retry?: () => Promise<unknown>;
}) {
  const [status, setStatus] = useState<InstallStatusView | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      let delay = 15_000;
      try {
        const next = await read();
        if (disposed) return;
        setStatus(next);
        if (next.state === "downloading" || next.state === "starter_ready" || next.state === "installing_engine") delay = 2_000;
      } catch { /* The strip is a courtesy; a missed poll is retried. */ }
      if (!disposed) timer = setTimeout(() => void poll(), delay);
    };
    void poll();
    return () => { disposed = true; if (timer) clearTimeout(timer); };
  }, [read]);

  if (!status || status.state === "none" || status.state === "ready") return null;
  const problem = status.problem;
  const engineStep = status.state === "installing_engine" || status.state === "engine_failed";
  const title = installTitle(status);
  const downloadState = status.state === "stalled" ? "stalled" : status.state === "failed" || status.state === "out_of_space" || status.state === "engine_failed" ? "failed" : "running";
  const onRetry = () => {
    setRetryError(null);
    retry().catch((reason: unknown) => {
      const words = reason instanceof ApiError ? [reason.message, reason.next].filter(Boolean).join(" ") : "";
      setRetryError(words || "Home couldn't restart the install. Check that this computer is online, then press Try again.");
    });
  };
  if (compact) {
    const failed = downloadState === "failed";
    const showPercent = !engineStep && !failed && status.totalBytes > 0;
    return (
      <div data-testid="install-strip" className="flex flex-col gap-1 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate">{failed ? (problem ?? title) : title}</span>
          {showPercent ? <span className="shrink-0 tabular-nums">{Math.round(status.percent)}%</span> : null}
          {failed ? <Button type="button" variant="link" size="sm" onClick={onRetry}>Try again</Button> : null}
        </div>
        {failed ? null : <Progress mode="determinate" value={engineStep ? ((ENGINE_STAGE_INDEX[status.stage ?? "preflight"] ?? 0) + 1) / 4 * 100 : status.percent} label={`${title} progress`} />}
        {retryError ? <p role="alert">{retryError}</p> : null}
      </div>
    );
  }
  return (
    <>
      <JobProgress
        data-testid="install-strip"
        variant="compact"
        title={title}
        stages={STAGES}
        stageIndex={engineStep ? ENGINE_STAGE_INDEX[status.stage ?? "preflight"] ?? 0 : 3}
        stageProgress={engineStep ? 0 : status.percent / 100}
        {...(engineStep ? {} : { completedBytes: status.completedBytes, totalBytes: status.totalBytes })}
        {...(status.bytesPerSecond ? { bytesPerSecond: status.bytesPerSecond } : {})}
        {...(status.etaSeconds ? { etaSeconds: status.etaSeconds } : {})}
        downloadState={downloadState}
        downloadStatus={problem ?? undefined}
        onRetry={onRetry}
      />
      {problem ? <p role="alert">{problem}</p> : null}
      {retryError ? <p role="alert">{retryError}</p> : null}
      {detailsHref ? <Link to={detailsHref} className="text-sm underline">Details</Link> : null}
    </>
  );
}
