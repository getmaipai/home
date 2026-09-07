import { useAuiState } from "@assistant-ui/react";
import { Link } from "react-router-dom";
import { getIcon } from "@/kit/icons";

const Brain = getIcon("brain");

/** Rendered per assistant message (thread.aui.tsx); shows only once this
 * message's own history row carried real `memory_ids`
 * (chatHistoryAdapter.ts's `metadata.custom.memoryIds`, getmaipai/home#64).
 * Reads straight off the rendered message's own metadata, not a
 * `memory.updated` notification: `NotificationDeliveryView` has no
 * `payload` field on `main`, so that path never actually fired - this
 * chip had never shown once before this fix. `memory_ids` is real data
 * (`list()`'s own join in `conversationHistory.ts`), already loaded with
 * the thread, so there is nothing separate to poll. */
export function MemoryUpdatedChip() {
  const memoryIds = useAuiState((s) => (s.message.metadata?.custom?.memoryIds as string[] | undefined) ?? undefined);

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
