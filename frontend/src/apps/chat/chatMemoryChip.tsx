import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuiState } from "@assistant-ui/react";
import { Link } from "react-router-dom";
import { getIcon } from "@/kit/icons";
import { api, type NotificationDeliveryView } from "@/lib/api";
import { NOTIFICATIONS_QUERY_KEY } from "@/shell/NotificationBell";

// session-a-intelligence.md's contract declares a `memory.updated`
// notification (payload `{ conversation_id, turn_id, memory_ids }`, "one
// per judge run that wrote at least one record"), but
// NotificationDeliveryView (backend/src/wire.ts, a file Session A owns)
// has no `payload` field on `main` today - only id/typeId/text/channels/
// timestamps, and the contract doesn't say the delivery view itself
// gains one. This reads a payload field defensively: present once
// Session A's routes actually wire one through (rebase and check),
// absent otherwise - today's honest state, where this chip never shows
// because the notification type doesn't exist yet either.
interface MemoryUpdatedPayload {
  turn_id?: string;
  memory_ids?: string[];
}

function memoryUpdatedPayload(n: NotificationDeliveryView): MemoryUpdatedPayload | undefined {
  if (n.typeId !== "memory.updated") return undefined;
  const payload = (n as NotificationDeliveryView & { payload?: unknown }).payload;
  if (!payload || typeof payload !== "object") return undefined;
  return payload as MemoryUpdatedPayload;
}

/** memory_ids by turn id, from whatever `memory.updated` notifications are
 * currently cached. Reads NotificationBell.tsx's own polled query (same
 * key) rather than fetching a second copy - the shell always mounts the
 * bell alongside every page, so that polling keeps this fresh too.
 * Memoized on the query's own data reference: one `MemoryUpdatedChip`
 * mounts per assistant message, and a code review (2026-09-05) found the
 * un-memoized version rebuilding this same Map from scratch in every one
 * of them on every render (each streamed token, each unrelated re-render
 * the 15s notification poll causes) - wasted work scaling with both
 * thread length and notification volume. */
export function useMemoryUpdatesByTurnId(): ReadonlyMap<string, string[]> {
  const { data } = useQuery<NotificationDeliveryView[]>({
    queryKey: NOTIFICATIONS_QUERY_KEY,
    queryFn: () => api.notifications(),
  });
  return useMemo(() => {
    const map = new Map<string, string[]>();
    for (const n of data ?? []) {
      const payload = memoryUpdatedPayload(n);
      if (payload?.turn_id && payload.memory_ids?.length) map.set(payload.turn_id, payload.memory_ids);
    }
    return map;
  }, [data]);
}

const Brain = getIcon("brain");

/** Rendered per assistant message (thread.aui.tsx); shows only once a
 * `memory.updated` notification names this message's turn. */
export function MemoryUpdatedChip() {
  const turnId = useAuiState((s) => (s.message.metadata?.custom?.turnId as string | undefined) ?? undefined);
  const updates = useMemoryUpdatesByTurnId();
  const memoryIds = turnId ? updates.get(turnId) : undefined;

  if (!memoryIds?.length) return null;

  return (
    <Link
      to={`/memory?ids=${memoryIds.map(encodeURIComponent).join(",")}`}
      className="mt-1 inline-flex w-fit items-center gap-1 self-start rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent"
    >
      <Brain className="size-3" />
      Memory updated
    </Link>
  );
}
