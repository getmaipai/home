import { useContext } from "react";
import { useAuiState } from "@assistant-ui/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { MemoryChip } from "@maipai/ui/src/elements/memory-chips";
import { api, type MemoryRecord } from "@/lib/api";
import { forgetOneMemory } from "@/apps/chat/chatMemoryActions";
import { useMemoryState } from "@/apps/chat/chatMemoryState";
import { ChatAgeBandContext, TemporaryChatContext } from "@/apps/chat/chatThreadContexts";

/** The memory area's own list query (PersonMemories.tsx OwnMemories): the
 * same route and key, so a chip shows only what the memory area would show
 * this person, under the same visibility and audience rules. */
export const OWN_MEMORIES_KEY = ["memory-list", "me"] as const;

/** Adults and teens see what a reply saved (CHAT-UI-SPEC "Memory saved");
 * a child does not, and Incognito never remembers. */
export function memoryChipsAllowed(band: "child" | "teen" | "adult", temporary: boolean): boolean {
  return band !== "child" && !temporary;
}

/** ELEMENTS-ADOPT-02: the data and the forget handler for the kit's
 * memory-chips under one reply: the memories whose provenance is this
 * turn (the per-turn `memory_ids` and the live poll in chatMemoryState),
 * or null when there are none to show. The Element is rendered as it ships
 * by the message footer slot (chatThreadSlots.tsx). */
export function useReplyMemoryChips(): { chips: MemoryChip[]; onForget: (id: string) => void } | null {
  const band = useContext(ChatAgeBandContext);
  const temporary = useContext(TemporaryChatContext).on;
  const allowed = memoryChipsAllowed(band, temporary);
  const turnId = useAuiState((s) => s.message.metadata?.custom?.turnId as string | undefined);
  const conversationId = useAuiState((s) => s.message.metadata?.custom?.conversationId as string | undefined);
  const source = useAuiState((s) => s.message.metadata?.custom?.source as string | undefined);
  const judgeStatus = useAuiState((s) => s.message.metadata?.custom?.judgeStatus as string | null | undefined);
  const rowMemoryIds = useAuiState((s) => s.message.metadata?.custom?.memoryIds as string[] | undefined);
  const state = useMemoryState(
    allowed ? turnId : undefined,
    turnId && conversationId && source !== undefined ? { conversationId, source, judgeStatus, memoryIds: rowMemoryIds ?? [] } : undefined,
  );
  const ids = state?.memoryIds ?? [];
  const queryClient = useQueryClient();
  const memories = useQuery<MemoryRecord[]>({ queryKey: OWN_MEMORIES_KEY, queryFn: () => api.memories(), enabled: allowed && ids.length > 0 });
  if (!allowed || !turnId || ids.length === 0 || !memories.data) return null;
  const fresh = new Set(state?.fresh ?? []);
  const chips = ids.flatMap((id): MemoryChip[] => {
    const record = memories.data.find((memory) => memory.id === id);
    return record ? [{ id, text: record.text, change: fresh.has(id) ? "added" : "existing" }] : [];
  });
  if (chips.length === 0) return null;
  return {
    chips,
    onForget: (id) => {
      forgetOneMemory(turnId, id)
        .then(() => queryClient.invalidateQueries({ queryKey: OWN_MEMORIES_KEY }))
        .catch(() => toast.error("Couldn't forget that - try again."));
    },
  };
}
