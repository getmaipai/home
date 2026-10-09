import type { SuggestionAdapter } from "@assistant-ui/react";
import { api } from "@/lib/api";

// ELEMENTS-ADOPT-02 slice 3 (CHAT-FOLLOWUPS-01): assistant-ui asks this
// adapter for suggestions once a reply has finished (never during it, so a
// follow-up never delays the reply), and the kit Thread draws them with its
// own follow-up-suggestions row. The hub writes them from the visible turn
// only, for an adult's written chat; anything else, or any failure, is no
// follow-ups. The page passes this adapter for an adult only; `incognito`
// is read at the moment of asking, so a turn in Incognito never asks.
export function createChatFollowUpAdapter(incognito: () => boolean): SuggestionAdapter {
  return {
    async generate({ messages }) {
      if (incognito()) return [];
      const last = messages.at(-1);
      if (!last || last.role !== "assistant" || last.status?.type !== "complete") return [];
      const turnId = last.metadata?.custom?.turnId as string | undefined;
      if (!turnId) return [];
      try {
        const { follow_ups } = await api.followUps(turnId);
        return follow_ups.map((prompt) => ({ prompt }));
      } catch {
        return [];
      }
    },
  };
}
