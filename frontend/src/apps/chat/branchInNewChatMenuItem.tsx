import { ActionBarMorePrimitive, useAuiState } from "@assistant-ui/react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getIcon } from "@maipai/ui/src/icons";
import { api } from "@/lib/api";


const NewChatIcon = getIcon("message-square");

/** Branch in new chat (gap matrix A7): the "..." menu entry that copies this
 * conversation up to this reply into a new chat and opens it. The kit's
 * BranchPicker flips between regenerated or edited answers; this is the
 * other half of "branch", an independent copy. Same menu-item shape as
 * ChatPage's Compare entry (ActionBarMorePrimitive.Item). */
export function BranchInNewChatMenuItem() {
  const turnId = useAuiState((s) => s.message.metadata?.custom?.turnId as string | undefined);
  const [, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const fork = useMutation({
    mutationFn: (id: string) => api.forkConversationTurn(id),
    onSuccess: (conversation) => {
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
      setSearchParams({ conversation: conversation.id });
    },
    onError: () => toast.error("Could not start a new chat from this reply."),
  });
  return (
    <ActionBarMorePrimitive.Item
      className="hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none disabled:pointer-events-none disabled:opacity-50 [@media(pointer:fine)]:min-h-0"
      disabled={!turnId || fork.isPending}
      onSelect={(e) => {
        e.preventDefault();
        if (turnId) fork.mutate(turnId);
      }}
    >
      <NewChatIcon className="size-4" />
      Branch in new chat
    </ActionBarMorePrimitive.Item>
  );
}
