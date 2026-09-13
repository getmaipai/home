import { useState } from "react";
import { useAuiState } from "@assistant-ui/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getIcon } from "@/kit/icons";
import { api, type NotificationDeliveryView } from "@/lib/api";
import { NOTIFICATIONS_QUERY_KEY, POLL_MS } from "@/shell/NotificationBell";

const Brain = getIcon("brain");

// The judge runs after the turn, not during it - even the newest
// (getmaipai/home#60: a live reply's own `metadata.custom.turnId`) message
// has no `memory_ids` at the moment it's yielded. `NotificationBell.tsx`'s
// own 15s poll already fetches memory.updated deliveries (subjectTurnId,
// memoryIds - getmaipai/home#64), so this reads that SAME cached query
// (its own comment: "rather than duplicating the query key") instead of a
// second one, and only while a message's own turn hasn't already reported
// its ids straight off the row (chatHistoryAdapter.ts's reload-path
// metadata) - once a reload happens, the join is real data and this
// never needs to poll for that message again.
function useMemoryUpdatesByTurnId(turnId: string | undefined): string[] | undefined {
  const query = useQuery<NotificationDeliveryView[]>({
    queryKey: NOTIFICATIONS_QUERY_KEY,
    queryFn: () => api.notifications(),
    refetchInterval: POLL_MS,
    enabled: turnId !== undefined,
  });
  if (!turnId) return undefined;
  const delivery = query.data?.find((n) => n.typeId === "memory.updated" && n.subjectTurnId === turnId);
  return delivery?.memoryIds ?? undefined;
}

/** Rendered per assistant message (thread.aui.tsx). Two sources, in
 * order: a reloaded message's own row already carries real `memory_ids`
 * (chatHistoryAdapter.ts's `metadata.custom.memoryIds`) - nothing to wait
 * on, shows immediately. A message from the CURRENT live session has
 * none yet (the judge hasn't run), so it falls back to polling for a
 * matching memory.updated delivery by turn id instead - this is the only
 * way a live reply's chip can ever show without a reload. */
export function MemoryUpdatedChip() {
  const turnId = useAuiState((s) => s.message.metadata?.custom?.turnId as string | undefined);
  const rowMemoryIds = useAuiState((s) => (s.message.metadata?.custom?.memoryIds as string[] | undefined) ?? undefined);
  const liveMemoryIds = useMemoryUpdatesByTurnId(rowMemoryIds?.length ? undefined : turnId);
  // A code review (2026-09-13) caught the chip un-rendering itself: once
  // this message got its ids from the live poll, dismissing that SAME
  // delivery from NotificationBell.tsx optimistically filters it out of
  // the shared NOTIFICATIONS_QUERY_KEY cache this hook reads, so the next
  // render's `find()` misses and the chip that was already showing
  // vanishes - dismissing a toast should never take back something
  // already shown in the transcript. Latched once found; a poll result
  // disappearing later never un-shows it (a reload still gets the real,
  // durable answer straight from the row instead of this latch).
  const [latchedMemoryIds, setLatchedMemoryIds] = useState<string[] | undefined>(undefined);
  if (liveMemoryIds?.length && !latchedMemoryIds) setLatchedMemoryIds(liveMemoryIds);
  const memoryIds = rowMemoryIds?.length ? rowMemoryIds : latchedMemoryIds;

  if (!memoryIds?.length) return null;

  return (
    // Deliberate type-floor exception (docs/UI.md, lane 7 item 3,
    // 2026-09-13): a compact rounded-full chip, the same category as a
    // badge count, not a line of body text.
    <Link
      to={`/memory?ids=${memoryIds.map(encodeURIComponent).join(",")}`}
      className="mt-1 inline-flex w-fit items-center gap-1 self-start rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent"
    >
      <Brain className="size-3" />
      Memory updated
    </Link>
  );
}
