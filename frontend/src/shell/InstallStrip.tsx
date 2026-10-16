import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { JobProgress } from "@maipai/ui/src/elements/job-progress";
import { api, ApiError, type InstallStatusView } from "@/lib/api";

const STAGES = [{ name: "Download", weight: 1 }] as const;

/** One line of install progress: the AI models downloading in the
 * background. It hides itself when nothing is installing or everything
 * has landed. Polls fast while moving, slowly otherwise. */
export function InstallStrip({ detailsHref = "/settings/home/ai", read = api.installStatus, retry = api.installRetry }: {
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
        onRetry={() => {
          setRetryError(null);
          retry().catch((reason: unknown) => {
            const words = reason instanceof ApiError ? [reason.message, reason.next].filter(Boolean).join(" ") : "";
            setRetryError(words || "Home couldn't restart the download. Check that the AI engine is running, then press Try again.");
          });
        }}
      />
      {problem ? <p role="alert">{problem}</p> : null}
      {retryError ? <p role="alert">{retryError}</p> : null}
      {detailsHref ? <Link to={detailsHref} className="text-sm underline">Details</Link> : null}
    </>
  );
}
