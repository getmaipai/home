import { i18n } from "@lingui/core";
import type { PerformanceQueues } from "@/lib/api";

/** ADMIN-PERF-01: the memory judge queue, the embedding retry queue and
 * CHAT-06's ingestion queue - three existing point-in-time counts
 * (`judgeQueueStats()`, `pending_embeddings`, `pending_memory_work`),
 * no new "per day" history. A plain stat row per queue rather than a
 * table - three numbers don't need columns. */
export function QueuesBody({ queues }: { queues: PerformanceQueues }) {
  const rows: Array<{ label: string; value: number; detail?: string }> = [
    { label: i18n._({ id: "Memory judge", message: "Memory judge" }), value: queues.judge.pending, detail: queues.judge.oldest_created_at ? i18n._({ id: "oldest since {date}", message: "oldest since {date}", values: { date: new Date(queues.judge.oldest_created_at).toLocaleString() } }) : undefined },
    { label: i18n._({ id: "Embedding retry", message: "Embedding retry" }), value: queues.embedding.pending },
    { label: i18n._({ id: "Ingestion", message: "Ingestion" }), value: queues.ingestion.pending, detail: queues.ingestion.by_reason.map((r) => `${r.reason}: ${r.count}`).join(", ") || undefined },
  ];
  return (
    <div className="flex flex-col gap-4">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-medium text-foreground">{row.label}</p>
            {/* deliberate type-floor exception: compact diagnostic detail */}
            {row.detail && <p className="text-xs text-muted-foreground">{row.detail}</p>}
          </div>
          <p className="text-2xl font-semibold">{row.value}</p>
        </div>
      ))}
    </div>
  );
}
