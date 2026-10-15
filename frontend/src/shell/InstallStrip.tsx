import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { JobProgress } from "@maipai/ui/src/elements/job-progress";
import { api, type InstallStatusView } from "@/lib/api";

const STAGES = [{ name: "Download", weight: 1 }] as const;

/** One line of install progress: the AI models downloading in the
 * background. It hides itself when nothing is installing or everything
 * has landed. Polls fast while moving, slowly otherwise. */
export function InstallStrip({ detailsHref = "/settings/ai", read = api.installStatus }: { detailsHref?: string; read?: () => Promise<InstallStatusView> }) {
  const [status, setStatus] = useState<InstallStatusView | null>(null);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      let delay = 15_000;
      try {
        const next = await read();
        if (disposed) return;
        setStatus(next);
        if (next.state === "downloading" || next.state === "starter_ready") delay = 2_000;
      } catch { /* The strip is a courtesy; a missed poll is retried. */ }
      if (!disposed) timer = setTimeout(() => void poll(), delay);
    };
    void poll();
    return () => { disposed = true; if (timer) clearTimeout(timer); };
  }, [read]);

  if (!status || status.state === "none" || status.state === "ready") return null;
  const problem = status.problem;
  const title = status.state === "starter_ready" ? "Home can chat now. Better AI is still downloading" : "Downloading your AI";
  const downloadState = status.state === "stalled" ? "stalled" : status.state === "failed" || status.state === "out_of_space" ? "failed" : "running";
  return (
    <>
      <JobProgress
        data-testid="install-strip"
        variant="compact"
        title={title}
        stages={STAGES}
        stageIndex={0}
        stageProgress={status.percent / 100}
        completedBytes={status.completedBytes}
        totalBytes={status.totalBytes}
        {...(status.bytesPerSecond ? { bytesPerSecond: status.bytesPerSecond } : {})}
        {...(status.etaSeconds ? { etaSeconds: status.etaSeconds } : {})}
        downloadState={downloadState}
        downloadStatus={problem ?? undefined}
        onRetry={() => { void api.installRetry().catch(() => {}); }}
      />
      {problem ? <p role="alert">{problem}</p> : null}
      <Link to={detailsHref}>Details</Link>
    </>
  );
}
