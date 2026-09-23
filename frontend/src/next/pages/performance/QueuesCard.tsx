import { getIcon } from "@maipai/ui/src/icons";
import { Card, CardHeader, CardContent, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import type { PerformanceQueues } from "@/lib/api";

const InboxIcon = getIcon("inbox");

/** ADMIN-PERF-01: the memory judge queue, the embedding retry queue and
 * CHAT-06's ingestion queue - three existing point-in-time counts
 * (`judgeQueueStats()`, `pending_embeddings`, `pending_memory_work`),
 * no new "per day" history. A plain stat row per queue rather than a
 * table - three numbers don't need columns. */
export function QueuesCard({ queues }: { queues: PerformanceQueues }) {
  const rows: Array<{ label: string; value: number; detail?: string }> = [
    { label: "Memory judge", value: queues.judge.pending, detail: queues.judge.oldest_created_at ? `oldest since ${new Date(queues.judge.oldest_created_at).toLocaleString()}` : undefined },
    { label: "Embedding retry", value: queues.embedding.pending },
    { label: "Ingestion", value: queues.ingestion.pending, detail: queues.ingestion.by_reason.map((r) => `${r.reason}: ${r.count}`).join(", ") || undefined },
  ];
  return (
    <Card className="flex flex-col gap-0!">
      <CardHeader className="border-b border-border">
        <CardTitle className="flex items-center gap-2">
          <InboxIcon size={16} className="text-muted-foreground" />
          Queues
        </CardTitle>
      </CardHeader>
      <CardContent className="p-5 flex flex-col gap-4">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-0.5">
              <p className="text-sm font-medium text-foreground">{row.label}</p>
              {row.detail && <p className="text-xs text-muted-foreground">{row.detail}</p>}
            </div>
            <p className="text-2xl font-semibold">{row.value}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
