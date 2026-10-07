import type { SuggestionAdapter } from "@assistant-ui/react";
import { api } from "@/lib/api";

/** The shipped ThreadFollowupSuggestions Element owns display and interaction. */
export function createChatSuggestionAdapter(isTemporary: () => boolean = () => false): SuggestionAdapter {
  return {
    async generate({ messages, signal }) {
      if (isTemporary()) return [];
      const last = messages.at(-1);
      if (!last || last.role !== "assistant" || last.status?.type !== "complete") return [];
      const turnId = last.metadata.custom.turnId;
      if (typeof turnId !== "string" || turnId.length === 0) return [];
      try {
        const response = await api.followUpSuggestions(turnId, signal);
        return response.suggestions.map(({ prompt }) => ({ prompt }));
      } catch {
        // Suggestions are optional background work and never make a reply fail.
        return [];
      }
    },
  };
}
