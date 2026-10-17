import { JobProgress } from "@maipai/ui/src/elements/job-progress";
import { Progress } from "@maipai/ui/src/primitives/Progress";
import { modelDownloadProgress } from "@/lib/modelDownloadProgress";
import { plainSize } from "@/shell/installWords";
import type { DockItem } from "@/shell/InstallDock";

/** One running install in the opened dock: the shipped job element (files, speed, Cancel) with a plain
 * name, then why it matters. An install the job list does not carry shows its size and a bar instead. */
export function InstallDockRow({ item, stop }: { item: DockItem; stop: (id: string) => Promise<unknown> }) {
  const job = item.job;
  return (
    <>
      {job ? (
        <JobProgress
          {...modelDownloadProgress(job)}
          title={item.label}
          variant="compact"
          cancelable={job.actions?.includes("stop")}
          onCancel={job.actions?.includes("stop") ? () => { void stop(job.id); } : undefined}
        />
      ) : (
        <>
          <p className="text-sm">{item.label}</p>
          {item.totalBytes > 0 ? <p className="text-sm text-muted-foreground tabular-nums">{plainSize(item.completedBytes)} of {plainSize(item.totalBytes)}</p> : null}
          {item.totalBytes > 0 ? <Progress mode="determinate" value={(item.completedBytes / item.totalBytes) * 100} label={`${item.label} progress`} /> : null}
        </>
      )}
      <p className="text-sm text-muted-foreground">{item.words.benefit}</p>
    </>
  );
}
