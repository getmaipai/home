import { useAuiState } from "@assistant-ui/react";
import { useNavigate } from "react-router-dom";
import { MemoryChip } from "@maipai/ui/src/blocks/chat/MemoryChip";
import { useMemoryState } from "@/apps/chat/chatMemoryState";
import { forgetMessage } from "@/apps/chat/chatMemoryActions";

/** Rendered per assistant message (thread.aui.tsx). Reads
 * chatMemoryState.ts's own store, the one place a turn's memory ids and
 * status live now (CHAT-20) - seeded once per message, from a loaded
 * row's real `memory_ids`/`judge_status` or a live reply's `source`
 * alone (the judge hasn't run yet), then kept current by
 * `useMemoryStatusPoll` (mounted once at the chat page's own top level)
 * while anything in the open conversation is still pending. Thin over
 * the kit's own MemoryChip (spec.md "Inside a turn") - this file is
 * only the Home-specific data (what happened, what the actions do), not
 * the chip's own shape or popover.
 *
 * "pending"/"stalled"/"not_saved" render nothing (Jesse, 2026-09-13: a
 * person should see this chip only when something actually happened -
 * these are process, not an outcome). "recalled" (an existing memory
 * used, not written) has no data source yet - BACKLOG.md's own item. */
export function MemoryUpdatedChip() {
  const navigate = useNavigate();
  const turnId = useAuiState((s) => s.message.metadata?.custom?.turnId as string | undefined);
  const conversationId = useAuiState((s) => s.message.metadata?.custom?.conversationId as string | undefined);
  const source = useAuiState((s) => s.message.metadata?.custom?.source as string | undefined);
  const judgeStatus = useAuiState((s) => s.message.metadata?.custom?.judgeStatus as string | null | undefined);
  const rowMemoryIds = useAuiState((s) => (s.message.metadata?.custom?.memoryIds as string[] | undefined) ?? undefined);

  const state = useMemoryState(
    turnId,
    turnId && conversationId && source !== undefined ? { conversationId, source, judgeStatus, memoryIds: rowMemoryIds ?? [] } : undefined,
  );

  if (!state || !turnId) return null;

  function openMemory(): void {
    navigate(`/memory${state!.memoryIds.length > 0 ? `?ids=${state!.memoryIds.map(encodeURIComponent).join(",")}` : ""}`);
  }

  if (state.status === "saved") {
    return (
      <MemoryChip
        kind="remembered"
        // Deliberately a no-op, not an unfinished stub: the memory is
        // already saved by the time this popover exists, so "Keep" (the
        // Forget row's antonym) has nothing to write - it exists to let
        // a person explicitly dismiss the choice, the popover's own
        // `runAndClose` already closing it being the only visible effect.
        onKeep={() => {}}
        onEdit={openMemory}
        onForget={() => void forgetMessage(turnId, state.memoryIds)}
      />
    );
  }

  if (state.status === "failed") {
    return <MemoryChip kind="failed" onOpenMemory={openMemory} />;
  }

  return null; // pending, stalled, not_saved: no chip
}
